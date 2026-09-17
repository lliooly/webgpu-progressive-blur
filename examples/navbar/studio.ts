import {
  attachProgressiveBlur,
  type BlurPreset,
  type BlurPlacement,
  type ProgressiveBlurEffect,
  type ProgressiveBlurAttachOptions,
} from "@webgpu-progressive-blur/dom";
import {
  generateExample,
  type ExperimentConfig,
  type CodegenFramework,
} from "./codegen";
import { version as packageVersion } from "../../package.json";
const presets: Record<
  BlurPreset,
  {
    label: string;
    description: string;
    placements: BlurPlacement[];
    content: string;
  }
> = {
  navbar: {
    label: "顶部导航",
    description: "页面滚动到导航下方时，让内容柔和退场。",
    placements: ["top"],
    content:
      "<strong>field / notes</strong><div>Explore　 Journal　 About</div><span>↗</span>",
  },
  sidebar: {
    label: "侧边栏",
    description: "适合目录、工作区侧栏与地图工具面板。",
    placements: ["left", "right"],
    content:
      '<strong>Workspace</strong><div class="component-menu"><span>◈　Overview</span><span>▧　Collections</span><span>⌁　Activity</span><span>⚙　Settings</span></div><small>Your space to explore.</small>',
  },
  "bottom-bar": {
    label: "底部操作栏",
    description: "播放器、聊天输入栏和移动端操作区。",
    placements: ["bottom"],
    content:
      "<span>▷</span><div><strong>Sounds of the mountains</strong><small>Alpine collection · 03:42</small></div><span>＋</span>",
  },
  caption: {
    label: "图片标题",
    description: "在照片上放标题和说明，让前景文字保持清晰。",
    placements: ["bottom", "top"],
    content:
      "<div><small>FIELD NOTES / 001</small><strong>Somewhere, slower.</strong><span>A quiet moment in the mountains.</span></div><span>↗</span>",
  },
  edge: {
    label: "内容边缘",
    description: "为列表或阅读区域的单个边缘添加柔和过渡。",
    placements: ["top", "bottom", "left", "right"],
    content: "<small>CONTENT BOUNDARY</small>",
  },
  panel: {
    label: "浮动面板",
    description: "适合工具面板、信息卡片与 Popover 背景。",
    placements: ["top"],
    content:
      '<div><small>YOUR NEXT ESCAPE</small><strong>Take the scenic route.</strong><p>Save a place for a little quiet.</p><span class="component-pill">Add to collection　＋</span></div>',
  },
};
const $ = <T extends HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;

export function createPresetStudio(options: {
  scene: HTMLCanvasElement;
  stage: HTMLElement;
  getRatio: () => number;
  getExperiment: () => ExperimentConfig;
  schedule: () => void;
  status: (message: string, error?: boolean) => void;
}) {
  let selected: BlurPreset | "experiment" = "navbar";
  let placement: BlurPlacement = "top";
  let transition = 48;
  let tab: "install" | "js" | "html" = "install";
  let effect: ProgressiveBlurEffect | undefined;
  let busy = false;
  let pending = false;
  let disposed = false;
  let addAll = false;
  let displayedCode = "";
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  const component = $("#preset-component");
  const select = $<HTMLSelectElement>("#placement");
  const fade = $<HTMLInputElement>("#fade");
  const addAllButton = $<HTMLButtonElement>("#add-all-presets");

  function isActive(): boolean {
    return selected !== "experiment";
  }

  function configuration(): ProgressiveBlurAttachOptions {
    return {
      preset: selected === "experiment" ? "navbar" : selected,
      placement,
      transition: selected === "panel" ? 0 : transition,
      radius: options.getExperiment().radius,
      maxSamples: 32,
    };
  }

  const frameworkSelect = $<HTMLSelectElement>("#code-framework");
  frameworkSelect.addEventListener("change", generateCode);
  addAllButton.addEventListener("click", () => {
    if (selected === "experiment") return;
    addAll = !addAll;
    generateCode();
  });

  function generateCode(): void {
    const config = options.getExperiment();
    const framework = frameworkSelect.value as CodegenFramework;
    const generated = generateExample({
      version: packageVersion,
      framework,
      preset: selected,
      placement,
      radius: config.radius,
      transition,
      maxSamples: 32,
      experiment: config,
      addAll,
    });
    const sourceMode = generated.mode === "source";
    $("#tab-js").textContent = sourceMode ? "02 组件用法" : "02 JavaScript";
    $("#tab-html").textContent = sourceMode ? "03 布局说明" : "03 HTML / CSS";
    displayedCode =
      tab === "install"
        ? generated.install
        : tab === "js"
          ? generated.usage
          : generated.notes;
    $("#generated-code").textContent = displayedCode;
    $("#code-note").textContent = generated.notes;
    addAllButton.textContent = addAll ? "安装全部预设（已选择）" : "添加全部预设";
  }

  function sync(): void {
    const experiment = selected === "experiment";
    addAllButton.hidden = experiment;
    frameworkSelect.disabled = experiment;
    for (const element of document.querySelectorAll<HTMLElement>(
      ".experiment-controls",
    ))
      element.hidden = !experiment;
    $("#preset-settings").hidden = experiment;
    $("#lens").hidden = !experiment;
    component.hidden = experiment;
    document
      .querySelectorAll<HTMLButtonElement>("[data-preset]")
      .forEach((button) => {
        const active = button.dataset.preset === selected;
        button.classList.toggle("selected", active);
        button.setAttribute("aria-pressed", String(active));
      });
    if (selected !== "experiment") {
      component.dataset.kind = selected;
      component.dataset.placement = placement;
      $("#component-content").innerHTML = presets[selected].content;
      $("#preset-description").textContent = presets[selected].description;
      $("#shape-name").textContent = presets[selected].label;
      $("#position").textContent =
        selected === "panel"
          ? "UNIFORM"
          : `${placement.toUpperCase()} / ${transition} PX`;
      $("#preview-hint").textContent = "组件前景保持清晰，背景向内容区渐隐";
      select.replaceChildren(
        ...presets[selected].placements.map((value) => {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = {
            top: "顶部",
            bottom: "底部",
            left: "左侧",
            right: "右侧",
          }[value];
          return option;
        }),
      );
      select.value = placement;
      select.disabled = presets[selected].placements.length === 1;
      fade.disabled = selected === "panel";
    } else {
      $("#preset-description").textContent =
        "用图片与文字测试径向和任意方向的渐变。";
      $("#preview-hint").textContent = "拖动模糊区域，观察图片与文字的变化";
    }
    fade.value = String(transition);
    fade.style.setProperty("--fill", `${(transition / 160) * 100}%`);
    $("#fade-value").textContent =
      `${selected === "panel" ? 0 : transition} px`;
    generateCode();
  }

  async function refresh(): Promise<void> {
    generateCode();
    if (selected === "experiment" || disposed) return;
    if (busy) {
      pending = true;
      return;
    }
    busy = true;
    try {
      if (!effect) {
        const created = await attachProgressiveBlur(component, {
          ...configuration(),
          pixelRatio: options.getRatio(),
          observeResize: false,
          observeTheme: false,
          capture: ({ rect, output, signal }) => {
            if (signal.aborted) return output;
            const bounds = options.stage.getBoundingClientRect();
            const ctx = output.getContext("2d", { alpha: false })!;
            ctx.clearRect(0, 0, output.width, output.height);
            ctx.drawImage(
              options.scene,
              ((rect.left - bounds.left) * options.scene.width) / bounds.width,
              ((rect.top - bounds.top) * options.scene.height) / bounds.height,
              (rect.width * options.scene.width) / bounds.width,
              (rect.height * options.scene.height) / bounds.height,
              0,
              0,
              output.width,
              output.height,
            );
            return output;
          },
        });
        if (disposed) {
          created.destroy();
          return;
        }
        effect = created;
      } else {
        effect.setParameters(configuration());
        await effect.refresh();
      }
      if (isActive()) {
        const ready = effect.status.state === "ready";
        $(".workspace").dataset.ready = String(ready);
        options.status(
          ready
            ? "WebGPU 已就绪 · 预览使用公开预设 API"
            : "WebGPU 不可用 · 保留原始背景",
          !ready,
        );
      }
    } catch (error) {
      options.status(
        `预览失败：${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    } finally {
      busy = false;
      if (pending && !disposed) {
        pending = false;
        void refresh();
      }
    }
  }

  document
    .querySelectorAll<HTMLButtonElement>("[data-preset]")
    .forEach((button) =>
      button.addEventListener("click", () => {
        selected = button.dataset.preset as typeof selected;
        addAll = false;
        if (selected !== "experiment")
          placement = presets[selected].placements[0];
        options.schedule();
        sync();
      }),
    );
  select.addEventListener("change", () => {
    placement = select.value as BlurPlacement;
    sync();
    options.schedule();
  });
  fade.addEventListener("input", () => {
    transition = Number(fade.value);
    sync();
    options.schedule();
  });
  const tabs = [...document.querySelectorAll<HTMLButtonElement>("[data-code]")];
  function selectTab(button: HTMLButtonElement): void {
    tab = button.dataset.code as typeof tab;
    tabs.forEach((item) => {
      item.setAttribute("aria-selected", String(item === button));
      item.tabIndex = item === button ? 0 : -1;
    });
    $("#code-content").setAttribute("aria-labelledby", button.id);
    generateCode();
  }
  tabs.forEach((button, index) => {
    button.addEventListener("click", () => selectTab(button));
    button.addEventListener("keydown", (event) => {
      const next =
        event.key === "ArrowRight"
          ? (index + 1) % tabs.length
          : event.key === "ArrowLeft"
            ? (index + tabs.length - 1) % tabs.length
            : event.key === "Home"
              ? 0
              : event.key === "End"
                ? tabs.length - 1
                : -1;
      if (next < 0) return;
      event.preventDefault();
      selectTab(tabs[next]);
      tabs[next].focus();
    });
  });
  $("#copy-code").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(displayedCode);
      $("#copy-status").textContent = "已复制";
    } catch {
      const range = document.createRange();
      range.selectNodeContents($("#generated-code"));
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      $("#copy-status").textContent =
        "无法访问剪贴板，已选中代码，请手动复制。";
    }
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      $("#copy-status").textContent = "";
    }, 3500);
  });
  sync();
  return {
    isActive: () => selected !== "experiment",
    refresh,
    sync,
    reset: () => {
      selected = "navbar";
      placement = "top";
      transition = 48;
      sync();
    },
    destroy: () => {
      disposed = true;
      effect?.destroy();
      clearTimeout(copyTimer);
    },
  };
}
