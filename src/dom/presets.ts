/** Component presets preserve full blur under the element, fading into content. */
export type BlurPreset =
  "navbar" | "sidebar" | "bottom-bar" | "caption" | "edge" | "panel";
export type BlurPlacement = "top" | "right" | "bottom" | "left";
export interface BlurPresetOptions {
  preset?: BlurPreset;
  /** Edge occupied by the component, not the direction of the fade. */
  placement?: BlurPlacement;
  /** Fade extension outside the component, in CSS pixels. Default: 48. */
  transition?: number;
}
export interface ResolvedBlurPreset {
  placement: BlurPlacement;
  transition: number;
  bleed: { top: number; right: number; bottom: number; left: number };
}

export function resolveBlurPreset(
  options: BlurPresetOptions,
): ResolvedBlurPreset | undefined {
  if (!options.preset) {
    if (options.placement !== undefined || options.transition !== undefined) {
      throw new TypeError("placement and transition require a preset.");
    }
    return undefined;
  }
  const placements: Record<BlurPreset, readonly BlurPlacement[]> = {
    navbar: ["top"],
    sidebar: ["left", "right"],
    "bottom-bar": ["bottom"],
    caption: ["bottom", "top"],
    edge: ["top", "right", "bottom", "left"],
    panel: ["top"],
  };
  const allowed = placements[options.preset];
  if (!allowed) throw new TypeError("Unknown blur preset.");
  const placement = options.placement ?? allowed[0];
  if (!allowed.includes(placement))
    throw new RangeError(`Invalid placement for ${options.preset}.`);
  const requested = options.transition ?? 48;
  if (!Number.isFinite(requested) || requested < 0)
    throw new RangeError("transition must be finite and non-negative.");
  const transition = options.preset === "panel" ? 0 : requested;
  const opposite: Record<BlurPlacement, BlurPlacement> = {
    top: "bottom",
    bottom: "top",
    left: "right",
    right: "left",
  };
  const bleed = { top: 0, right: 0, bottom: 0, left: 0 };
  bleed[opposite[placement]] = transition;
  return { placement, transition, bleed };
}

/** Ramp endpoints are expressed in overlay coordinates, from full blur to clear. */
export function getPresetRamp(
  width: number,
  height: number,
  preset: ResolvedBlurPreset,
): [number, number, number, number] {
  const t = preset.transition;
  switch (preset.placement) {
    case "top":
      return [0, height - t, 0, height];
    case "bottom":
      return [0, t, 0, 0];
    case "left":
      return [width - t, 0, width, 0];
    case "right":
      return [t, 0, 0, 0];
  }
}

export type ProceduralBlurProfile =
  | { type: "radial"; transition?: number; reverse?: boolean }
  | {
      type: "directional";
      direction: readonly [number, number];
      transition?: number;
      reverse?: boolean;
    };

export function validateProceduralProfile(
  profile: ProceduralBlurProfile,
): void {
  const transition = profile.transition ?? 1;
  if (!Number.isFinite(transition) || transition <= 0 || transition > 1)
    throw new RangeError("Profile transition must be in (0, 1].");
  if (profile.type === "directional") {
    const [x, y] = profile.direction;
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.hypot(x, y) === 0)
      throw new RangeError("Direction must be a finite, non-zero vector.");
  }
}

export function drawManagedMask(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  pixelRatio: number,
  preset?: ResolvedBlurPreset,
  profile?: ProceduralBlurProfile,
): void {
  canvas.width = Math.max(1, Math.round(width * pixelRatio));
  canvas.height = Math.max(1, Math.round(height * pixelRatio));
  const context = canvas.getContext("2d")!;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  let gradient: CanvasGradient | undefined;
  if (preset?.transition) {
    gradient = context.createLinearGradient(
      ...getPresetRamp(width, height, preset),
    );
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
  } else if (profile) {
    validateProceduralProfile(profile);
    if (profile.type === "radial") {
      gradient = context.createRadialGradient(
        width / 2,
        height / 2,
        0,
        width / 2,
        height / 2,
        Math.min(width, height) / 2,
      );
    } else {
      const length = Math.hypot(...profile.direction);
      const dx = profile.direction[0] / length;
      const dy = profile.direction[1] / length;
      const reach = (width * Math.abs(dx) + height * Math.abs(dy)) / 2;
      gradient = context.createLinearGradient(
        width / 2 - dx * reach,
        height / 2 - dy * reach,
        width / 2 + dx * reach,
        height / 2 + dy * reach,
      );
    }
    const start = (1 - (profile.transition ?? 1)) / 2;
    gradient.addColorStop(
      start,
      `rgba(255,255,255,${profile.reverse ? 0 : 1})`,
    );
    gradient.addColorStop(
      1 - start,
      `rgba(255,255,255,${profile.reverse ? 1 : 0})`,
    );
  }
  context.fillStyle = gradient ?? "#fff";
  context.fillRect(0, 0, width, height);
}
