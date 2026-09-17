import {
  attachProgressiveBlur,
  type ProgressiveBlurEffect,
} from "../../src/dom/element";
import {
  drawManagedMask,
  resolveBlurPreset,
  type BlurPresetOptions,
} from "../../src/dom/presets";

/** Browser-only checks: real Canvas masks, public DOM lifecycle and WebGPU. */
export async function runPresetValidation(): Promise<{
  status: "passed" | "unsupported";
  checks: number;
}> {
  let checks = 0;
  function check(condition: unknown, message: string): void {
    if (!condition) throw new Error(`Preset validation: ${message}`);
    checks++;
  }
  const mask = document.createElement("canvas");
  function alpha(x: number, y: number): number {
    return mask.getContext("2d")!.getImageData(x, y, 1, 1).data[3];
  }
  for (const placement of ["top", "bottom", "left", "right"] as const) {
    drawManagedMask(
      mask,
      160,
      160,
      1,
      resolveBlurPreset({ preset: "edge", placement, transition: 40 }),
    );
    const horizontal = placement === "left" || placement === "right";
    const reverse = placement === "bottom" || placement === "right";
    const sample = (t: number) =>
      alpha(horizontal ? t : 80, horizontal ? 80 : t);
    check(
      sample(reverse ? 159 : 0) === 255,
      `${placement} solid under component`,
    );
    check(sample(reverse ? 0 : 159) < 8, `${placement} clear at outer edge`);
    check(
      Math.abs(sample(reverse ? 20 : 139) - 128) < 8,
      `${placement} half strength midway through fade`,
    );
  }
  drawManagedMask(mask, 160, 160, 1, undefined, { type: "radial" });
  check(alpha(80, 80) > 248 && alpha(0, 80) < 8, "radial center to edge");
  drawManagedMask(mask, 160, 160, 1, undefined, {
    type: "radial",
    reverse: true,
  });
  check(alpha(80, 80) < 8 && alpha(0, 80) > 248, "radial reverse");
  drawManagedMask(mask, 160, 160, 1, undefined, {
    type: "directional",
    direction: [1, 1],
  });
  check(alpha(0, 0) > 248 && alpha(159, 159) < 8, "diagonal corner projection");

  const root = document.createElement("div");
  root.style.cssText =
    "position:fixed;left:-2000px;top:0;width:320px;height:240px;";
  document.body.append(root);
  const effects: ProgressiveBlurEffect[] = [];
  try {
    const target = document.createElement("div");
    target.style.cssText = "width:200px;height:72px";
    root.append(target);
    const effect = await attachProgressiveBlur(target, {
      preset: "navbar",
      transition: 48,
      pixelRatio: 1,
      observeResize: false,
      observeTheme: false,
      capture: ({ output }) => {
        const ctx = output.getContext("2d")!;
        ctx.fillStyle = "#bb8044";
        ctx.fillRect(0, 0, output.width, output.height);
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, output.width / 2, output.height / 2);
        return output;
      },
    });
    effects.push(effect);
    if (effect.status.state === "unsupported")
      return { status: "unsupported", checks };
    check(effect.status.state === "ready", "initial GPU render");
    check(effect.renderer?.height === 120, "navbar extends 48 CSS pixels");
    const configurations: BlurPresetOptions[] = [
      { preset: "sidebar", placement: "right", transition: 32 },
      { preset: "bottom-bar", transition: 24 },
      { preset: "caption", placement: "top", transition: 16 },
      { preset: "edge", placement: "left", transition: 12 },
      { preset: "panel" },
    ];
    for (const config of configurations) {
      effect.setParameters(config);
      await effect.refresh();
      check(effect.status.state === "ready", `${config.preset} render`);
      check(
        target.querySelectorAll("canvas").length === 1,
        "one overlay after preset change",
      );
    }
    target.style.width = "260px";
    await effect.refresh();
    check(effect.renderer?.width === 260, "resize updates render target");
    effect.setParameters({ profile: { type: "radial", transition: 0.8 } });
    await effect.refresh();
    check(
      effect.status.state === "ready",
      "switch from preset to procedural profile",
    );
    effect.setParameters({ profile: "uniform" });
    await effect.refresh();
    check(
      effect.canvas.style.height === "calc(100% + 0px)",
      "switch clears preset bleed",
    );
    effect.destroy();
    effect.destroy();
    check(
      target.children.length === 0,
      "destroy removes overlay, including repeated destroy",
    );
    check(
      target.style.position === "" && target.style.isolation === "",
      "destroy restores inline styles",
    );
    check(effect.status.state === "destroyed", "destroyed status");
    return { status: "passed", checks };
  } finally {
    effects.forEach((effect) => effect.destroy());
    root.remove();
  }
}
