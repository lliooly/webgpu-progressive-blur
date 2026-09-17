import type { BlurPlacement, BlurPreset } from "webgpu-progressive-blur/dom";

// These are editable starting layouts. The component merges user style after
// these defaults; a regular class cannot override an equal inline property.
export function presetLayout(
  preset: BlurPreset,
  placement?: BlurPlacement,
): Record<string, string | number> {
  const base = { position: "relative", background: "transparent" };
  switch (preset) {
    case "navbar":
      return {
        ...base,
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        minHeight: "72px",
        zIndex: 10,
      };
    case "sidebar":
      return {
        ...base,
        position: "fixed",
        [placement ?? "left"]: 0,
        top: 0,
        bottom: 0,
        width: "200px",
        zIndex: 10,
      };
    case "bottom-bar":
      return {
        ...base,
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        minHeight: "80px",
        zIndex: 10,
      };
    case "caption":
      return {
        ...base,
        position: "absolute",
        [placement ?? "bottom"]: 0,
        left: 0,
        right: 0,
        minHeight: "120px",
      };
    case "edge": {
      const side = placement ?? "top";
      return {
        ...base,
        position: "absolute",
        [side]: 0,
        pointerEvents: "none",
        ...(side === "top" || side === "bottom"
          ? { left: 0, right: 0, height: "16px" }
          : { top: 0, bottom: 0, width: "16px" }),
      };
    }
    case "panel":
      return {
        ...base,
        width: "min(320px, 90vw)",
        minHeight: "200px",
        borderRadius: "16px",
      };
  }
}
