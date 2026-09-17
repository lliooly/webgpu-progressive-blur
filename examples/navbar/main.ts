import {
  createProgressiveBlur,
  type ProgressiveBlurRenderer,
} from "@webgpu-progressive-blur";
import mountainUrl from "./assets/mountains.jpg";
import "./style.css";

const $ = <T extends HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
const stage = $<HTMLDivElement>("#stage");
const scene = $<HTMLCanvasElement>("#scene");
const lens = $<HTMLDivElement>("#lens");
const blur = $<HTMLCanvasElement>("#blur");
const workspace = $<HTMLElement>(".workspace");
const compare = $<HTMLButtonElement>("#compare");
const status = $<HTMLElement>("#gpu-status");
const imageMessage = $<HTMLElement>("#image-message");
const source = document.createElement("canvas");
const mask = document.createElement("canvas");
const context = scene.getContext("2d", { alpha: false })!;
const sourceContext = source.getContext("2d", { alpha: false })!;
const maskContext = mask.getContext("2d")!;
const defaults = {
  shape: "circle" as "circle" | "square",
  radius: 24,
  size: 60,
  transition: 80,
  dx: 1,
  dy: 0,
  reverse: false,
  text: true,
  outline: true,
  x: 0.5,
  y: 0.5,
};
let state = { ...defaults };
let renderer: ProgressiveBlurRenderer | undefined;
let picture: HTMLImageElement | undefined;
let defaultPicture: HTMLImageElement | undefined;
let width = 1;
let height = 1;
let dpr = 1;
let diameter = 1;
let left = 0;
let top = 0;
let frame = 0;
let backgroundDirty = true;
let uploadVersion = 0;
let disposed = false;
let pointer: { id: number; x: number; y: number } | undefined;

function setStatus(message: string, error = false): void {
  status.textContent = message;
  workspace.dataset.error = String(error);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片无法读取，请换一张图片。"));
    image.src = url;
  });
}

function drawScene(): void {
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.fillStyle = "#30484d";
  context.fillRect(0, 0, width, height);
  if (picture) {
    const scale = Math.max(
      width / picture.naturalWidth,
      height / picture.naturalHeight,
    );
    const w = picture.naturalWidth * scale;
    const h = picture.naturalHeight * scale;
    context.drawImage(picture, (width - w) / 2, (height - h) / 2, w, h);
  }
  if (!state.text) return;
  const shade = context.createLinearGradient(0, 0, 0, height);
  shade.addColorStop(0, "#122c3038");
  shade.addColorStop(0.5, "#122c3008");
  shade.addColorStop(1, "#102c3a8c");
  context.fillStyle = shade;
  context.fillRect(0, 0, width, height);
  const margin = Math.max(24, width * 0.065);
  context.fillStyle = "#ffffffdc";
  context.font = '10px "DM Sans", sans-serif';
  context.fillText("FIELD NOTES  /  001", margin, 39);
  context.textAlign = "right";
  context.fillText("46°35′ N   10°48′ E", width - margin, 39);
  context.textAlign = "left";
  const fontSize = Math.min(width * 0.15, height * 0.19);
  context.fillStyle = "#f6f6e9";
  context.font = `500 ${fontSize}px "Manrope", sans-serif`;
  context.fillText("Into the", margin, height * 0.43);
  context.fillText("stillness.", margin, height * 0.43 + fontSize * 1.1);
  context.font = `${Math.max(10, Math.min(13, width * 0.018))}px "DM Sans", sans-serif`;
  context.fillStyle = "#ffffffd0";
  context.fillText(
    "A little less detail. A different way to see.",
    margin,
    height * 0.43 + fontSize * 1.1 + 35,
  );
  const bottom = height - 60;
  context.strokeStyle = "#ffffff65";
  context.lineWidth = 0.7;
  context.beginPath();
  context.moveTo(margin, bottom - 22);
  context.lineTo(width - margin, bottom - 22);
  context.stroke();
  context.font = '10px "DM Sans", sans-serif';
  context.fillText("THE ALPINE COLLECTION", margin, bottom);
  context.font = '9px "DM Sans", sans-serif';
  context.fillText(
    "Light, texture & everything in between.",
    margin,
    bottom + 20,
  );
  context.textAlign = "right";
  context.font = "32px Georgia, serif";
  context.fillText("01", width - margin, bottom + 17);
  context.textAlign = "left";
}

function updateGeometry(): void {
  diameter = (Math.min(width, height) * state.size) / 100;
  state.x = Math.max(
    diameter / 2 / width,
    Math.min(1 - diameter / 2 / width, state.x),
  );
  state.y = Math.max(
    diameter / 2 / height,
    Math.min(1 - diameter / 2 / height, state.y),
  );
  left = state.x * width - diameter / 2;
  top = state.y * height - diameter / 2;
  Object.assign(lens.style, {
    width: `${diameter}px`,
    height: `${diameter}px`,
    left: `${left}px`,
    top: `${top}px`,
  });
  $("#position").textContent =
    `${Math.round(state.x * 100)} / ${Math.round(state.y * 100)}`;
}

function drawMask(extent: number, padding: number): void {
  maskContext.setTransform(dpr, 0, 0, dpr, 0, 0);
  maskContext.clearRect(0, 0, extent, extent);
  const center = padding + diameter / 2;
  let gradient: CanvasGradient;
  if (state.shape === "circle") {
    gradient = maskContext.createRadialGradient(
      center,
      center,
      0,
      center,
      center,
      diameter / 2,
    );
  } else {
    // Project the corners onto the direction, so diagonals span the entire square.
    const magnitudeSquared = state.dx ** 2 + state.dy ** 2;
    const reach =
      ((diameter / 2) * (Math.abs(state.dx) + Math.abs(state.dy))) /
      magnitudeSquared;
    gradient = maskContext.createLinearGradient(
      center - state.dx * reach,
      center - state.dy * reach,
      center + state.dx * reach,
      center + state.dy * reach,
    );
  }
  const start = (1 - state.transition / 100) / 2;
  const end = 1 - start;
  const strong = state.reverse ? "rgba(255,255,255,0)" : "rgba(255,255,255,1)";
  const clear = state.reverse ? "rgba(255,255,255,1)" : "rgba(255,255,255,0)";
  gradient.addColorStop(0, strong);
  gradient.addColorStop(start, strong);
  gradient.addColorStop(end, clear);
  gradient.addColorStop(1, clear);
  maskContext.fillStyle = gradient;
  maskContext.fillRect(0, 0, extent, extent);
}

function render(): void {
  frame = 0;
  if (disposed) return;
  if (backgroundDirty) {
    drawScene();
    backgroundDirty = false;
  }
  updateGeometry();
  if (!renderer) return;
  if (renderer.status.state !== "ready") {
    blur.hidden = true;
    workspace.dataset.ready = "false";
    setStatus("WebGPU 连接已断开，请刷新页面重试。", true);
    return;
  }
  try {
    // Render only the lens plus a 3-sigma sampling border; the scene stays static.
    const padding = Math.ceil(state.radius * 3) + 2;
    const extent = diameter + padding * 2;
    const pixels = Math.max(1, Math.round(extent * dpr));
    if (source.width !== pixels || source.height !== pixels) {
      source.width = source.height = pixels;
      mask.width = mask.height = pixels;
    }
    sourceContext.setTransform(dpr, 0, 0, dpr, 0, 0);
    sourceContext.fillStyle = "#30484d";
    sourceContext.fillRect(0, 0, extent, extent);
    sourceContext.drawImage(
      scene,
      0,
      0,
      scene.width,
      scene.height,
      padding - left,
      padding - top,
      width,
      height,
    );
    drawMask(extent, padding);
    Object.assign(blur.style, {
      left: `${-padding}px`,
      top: `${-padding}px`,
      width: `${extent}px`,
      height: `${extent}px`,
    });
    renderer.resize(extent, extent, dpr);
    renderer.setParameters({ radius: state.radius });
    renderer.invalidateMask();
    renderer.render();
    blur.hidden = false;
    setStatus("WebGPU 已就绪 · 实时渐变模糊");
  } catch (error) {
    blur.hidden = true;
    workspace.dataset.ready = "false";
    setStatus(
      `渲染失败：${error instanceof Error ? error.message : String(error)}`,
      true,
    );
  }
}

function schedule(redrawBackground = false): void {
  backgroundDirty ||= redrawBackground;
  if (!frame && !disposed) frame = requestAnimationFrame(render);
}

function syncControls(): void {
  for (const key of ["radius", "size", "transition"] as const) {
    const input = $<HTMLInputElement>(`#${key}`);
    input.value = String(state[key]);
    input.style.setProperty(
      "--fill",
      `${((state[key] - Number(input.min)) / (Number(input.max) - Number(input.min))) * 100}%`,
    );
    $(`#${key}-value`).textContent =
      `${state[key]}${key === "radius" ? " px" : "%"}`;
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-shape]",
  )) {
    const active = button.dataset.shape === state.shape;
    button.classList.toggle("selected", active);
    button.setAttribute("aria-pressed", String(active));
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-direction]",
  )) {
    const active = button.dataset.direction === `${state.dx},${state.dy}`;
    button.classList.toggle("selected", active);
    button.setAttribute("aria-pressed", String(active));
  }
  $("#radial-direction").hidden = state.shape !== "circle";
  $("#linear-direction").hidden = state.shape !== "square";
  $("#radial-direction div").innerHTML = state.reverse
    ? "外围 → 中心<small>从模糊逐渐变清晰</small>"
    : "中心 → 外围<small>从模糊逐渐变清晰</small>";
  $(".direction-caption").textContent = state.reverse
    ? "已反转：清晰 → 模糊"
    : "箭头方向：模糊 → 清晰";
  $<HTMLInputElement>("#reverse").checked = state.reverse;
  $<HTMLInputElement>("#show-text").checked = state.text;
  $<HTMLInputElement>("#show-outline").checked = state.outline;
  lens.dataset.shape = state.shape;
  lens.classList.toggle("no-outline", !state.outline);
  $("#shape-name").textContent =
    state.shape === "circle" ? "圆形渐变" : "方形渐变";
  $("#lens-tag").textContent =
    state.shape === "circle" ? "RADIAL BLUR" : "LINEAR BLUR";
}

for (const key of ["radius", "size", "transition"] as const) {
  $(`#${key}`).addEventListener("input", (event) => {
    state[key] = Number((event.target as HTMLInputElement).value);
    syncControls();
    schedule();
  });
}
for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-shape]",
)) {
  button.addEventListener("click", () => {
    state.shape = button.dataset.shape as typeof state.shape;
    syncControls();
    schedule();
  });
}
for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-direction]",
)) {
  button.addEventListener("click", () => {
    [state.dx, state.dy] = button.dataset.direction!.split(",").map(Number);
    syncControls();
    schedule();
  });
}
for (const [id, key] of [
  ["reverse", "reverse"],
  ["show-text", "text"],
  ["show-outline", "outline"],
] as const) {
  $<HTMLInputElement>(`#${id}`).addEventListener("change", (event) => {
    state[key] = (event.target as HTMLInputElement).checked;
    syncControls();
    schedule(key === "text");
  });
}

lens.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  lens.focus({ preventScroll: true });
  pointer = {
    id: event.pointerId,
    x: event.clientX - left,
    y: event.clientY - top,
  };
  lens.setPointerCapture(event.pointerId);
});
lens.addEventListener("pointermove", (event) => {
  if (!pointer || pointer.id !== event.pointerId) return;
  state.x = (event.clientX - pointer.x + diameter / 2) / width;
  state.y = (event.clientY - pointer.y + diameter / 2) / height;
  schedule();
});
for (const name of ["pointerup", "pointercancel", "lostpointercapture"])
  lens.addEventListener(name, () => {
    pointer = undefined;
  });
lens.addEventListener("keydown", (event) => {
  const directions: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };
  const direction = directions[event.key];
  if (!direction) return;
  event.preventDefault();
  const step = event.shiftKey ? 25 : 5;
  state.x += (direction[0] * step) / width;
  state.y += (direction[1] * step) / height;
  schedule();
});

function comparison(active: boolean): void {
  stage.classList.toggle("comparing", active);
  compare.querySelector("span")!.textContent = active
    ? "松开恢复效果"
    : "按住查看原图";
}
compare.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  compare.setPointerCapture(event.pointerId);
  comparison(true);
});
for (const name of ["pointerup", "pointercancel", "lostpointercapture", "blur"])
  compare.addEventListener(name, () => comparison(false));
compare.addEventListener("keydown", (event) => {
  if (event.key === " " || event.key === "Enter") {
    event.preventDefault();
    comparison(true);
  }
});
compare.addEventListener("keyup", (event) => {
  if (event.key === " " || event.key === "Enter") comparison(false);
});
window.addEventListener("blur", () => {
  pointer = undefined;
  comparison(false);
});

$<HTMLInputElement>("#upload").addEventListener("change", async (event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const version = ++uploadVersion;
  const url = URL.createObjectURL(file);
  try {
    const loaded = await loadImage(url);
    if (version !== uploadVersion || disposed) return;
    picture = loaded;
    imageMessage.textContent = "";
    scene.setAttribute("aria-label", "上传的图片与文字组成的模糊效果测试背景");
    schedule(true);
  } catch (error) {
    if (version === uploadVersion)
      imageMessage.textContent = (error as Error).message;
  } finally {
    URL.revokeObjectURL(url);
    input.value = "";
  }
});
$("#reset").addEventListener("click", () => {
  uploadVersion++;
  state = { ...defaults };
  picture = defaultPicture;
  imageMessage.textContent = "";
  scene.setAttribute("aria-label", "山脉照片与大小文字组成的模糊效果测试背景");
  comparison(false);
  syncControls();
  schedule(true);
});

function resize(): void {
  const bounds = stage.getBoundingClientRect();
  width = Math.max(1, bounds.width);
  height = Math.max(1, bounds.height);
  dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  scene.width = Math.round(width * dpr);
  scene.height = Math.round(height * dpr);
  schedule(true);
}
const observer = new ResizeObserver(resize);
observer.observe(stage);
window.addEventListener("resize", resize);
syncControls();
resize();

async function start(): Promise<void> {
  const imagePromise = loadImage(mountainUrl)
    .then((image) => {
      if (disposed) return;
      defaultPicture = image;
      if (!picture) picture = image;
      schedule(true);
    })
    .catch(() => {
      imageMessage.textContent =
        "默认图片加载失败，可通过“更换图片”选择本地图片。";
    });
  try {
    const ready = await createProgressiveBlur({
      canvas: blur,
      source,
      mask,
      mode: "reference",
      radius: state.radius,
      maxSamples: 32,
      normalizeEdges: true,
      cacheMask: true,
      canvasUploadMode: "external",
      pixelRatio: dpr,
    });
    if (disposed) {
      ready.destroy();
      return;
    }
    renderer = ready;
    workspace.dataset.ready = "true";
    schedule();
  } catch {
    blur.hidden = true;
    compare.disabled = true;
    setStatus(
      "WebGPU 不可用 · 当前显示原图，请使用支持 WebGPU 的浏览器。",
      true,
    );
  }
  await imagePromise;
  await document.fonts.ready;
  schedule(true);
}
void start();
window.addEventListener("pagehide", (event) => {
  if (event.persisted) return;
  disposed = true;
  observer.disconnect();
  cancelAnimationFrame(frame);
  renderer?.destroy();
});
