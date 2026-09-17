import { describe, expect, it } from "vitest";
import {
  getPresetRamp,
  resolveBlurPreset,
  validateProceduralProfile,
} from "../src/dom/presets";
import { resolveBlurProfile } from "../src/dom/element";

describe("component preset geometry", () => {
  it.each([
    ["navbar", "top", { bottom: 48 }, [0, 72, 0, 120]],
    ["sidebar", "left", { right: 48 }, [272, 0, 320, 0]],
    ["sidebar", "right", { left: 48 }, [48, 0, 0, 0]],
    ["bottom-bar", "bottom", { top: 48 }, [0, 48, 0, 0]],
  ] as const)(
    "keeps %s solid inside and fades outside %s",
    (preset, placement, bleed, ramp) => {
      const resolved = resolveBlurPreset({ preset, placement })!;
      expect(resolved.bleed).toEqual({
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        ...bleed,
      });
      expect(getPresetRamp(320, 120, resolved)).toEqual(ramp);
    },
  );

  it("supports zero transition and uniform panels without adding bleed", () => {
    for (const options of [
      { preset: "navbar", transition: 0 },
      { preset: "panel", transition: 96 },
    ] as const) {
      const preset = resolveBlurPreset(options)!;
      expect(preset.transition).toBe(0);
      expect(preset.bleed).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    }
  });

  it("rejects ambiguous or invalid configurations", () => {
    expect(() => resolveBlurPreset({ placement: "left" })).toThrow();
    expect(() =>
      resolveBlurPreset({ preset: "sidebar", placement: "top" }),
    ).toThrow();
    for (const transition of [-1, NaN, Infinity]) {
      expect(() =>
        resolveBlurPreset({ preset: "navbar", transition }),
      ).toThrow();
    }
  });

  it("supports radial and arbitrary directional masks with explicit validation", () => {
    expect(resolveBlurProfile({ type: "radial" }).mode).toBe("reference");
    expect(() =>
      validateProceduralProfile({ type: "directional", direction: [0, 0] }),
    ).toThrow();
    expect(() =>
      validateProceduralProfile({
        type: "directional",
        direction: [Infinity, 1],
      }),
    ).toThrow();
    for (const transition of [0, -1, 2, NaN]) {
      expect(() =>
        validateProceduralProfile({ type: "radial", transition }),
      ).toThrow();
    }
    expect(() =>
      validateProceduralProfile({
        type: "directional",
        direction: [3, -7],
        transition: 0.7,
      }),
    ).not.toThrow();
  });
});
