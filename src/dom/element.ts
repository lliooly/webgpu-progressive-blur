import {
  resolveBlurPreset,
  drawManagedMask,
  validateProceduralProfile,
  type BlurPresetOptions,
  type ResolvedBlurPreset,
  type ProceduralBlurProfile,
} from "./presets.js";
import type { Options as Html2CanvasOptions } from "html2canvas-pro";
import { createProgressiveBlur } from "../core/renderer.js";
import { ProgressiveBlurError, requestWebGPUDevice } from "../core/device.js";
import type {
  BlurGradient,
  BlurMode,
  BlurSource,
  GradientDirection,
  ProgressiveBlurOptions,
  ProgressiveBlurRenderer,
} from "../core/types.js";
import {
  getScrollMetrics,
  type DomRefreshReason,
  type DomScrollMetrics,
} from "./adapter.js";
import {
  createDefaultDomCapture,
  type DefaultDomCaptureHandle,
  type DomCaptureStrategy,
} from "./capture.js";

export type { DomCaptureStrategy } from "./capture.js";

export type BlurProfile =
  | ProceduralBlurProfile
  | "uniform"
  | "navbar"
  | {
      type: "linear";
      start?: number;
      end?: number;
      direction?: GradientDirection;
    }
  | {
      type: "mask";
      source: BlurSource;
    };

export interface DomElementCaptureRequest {
  element: HTMLElement;
  captureRoot: HTMLElement;
  rect: DOMRectReadOnly;
  /** CSS pixel width of the output overlay. */
  width: number;
  /** CSS pixel height of the output overlay. */
  height: number;
  pixelRatio: number;
  /** Reusable output canvas sized to the physical output dimensions. */
  output: HTMLCanvasElement;
  excludeElements: readonly HTMLElement[];
  reason: DomRefreshReason;
  signal: AbortSignal;
  scroll: DomScrollMetrics;
}

export type DomElementCapture = (
  request: DomElementCaptureRequest,
) => Promise<BlurSource> | BlurSource;

export interface BlurOverlayBleed {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

export interface BlurOverlayOptions {
  /** Adds CSS-pixel area outside the element's bounds. */
  bleed?: number | BlurOverlayBleed;
  /** CSS class added to the generated canvas. */
  className?: string;
  /** Stacking level inside the element's isolated stacking context. */
  zIndex?: number;
}

export interface ProgressiveBlurAttachOptions
  extends
    Omit<
      ProgressiveBlurOptions,
      "canvas" | "source" | "mask" | "mode" | "gradient"
    >,
    BlurPresetOptions {
  /** Blur shape. Defaults to a constant-strength blur across the element. */
  profile?: BlurProfile;
  /** Custom source provider. The default provider uses html2canvas-pro. */
  capture?: DomElementCapture;
  /** Root captured by the default DOM provider. Defaults to body. */
  captureRoot?: HTMLElement;
  /** Window or scrolling container that drives crop updates. */
  scrollTarget?: Window | HTMLElement;
  /** Full-document caching (default) or viewport recapture on scroll. */
  captureStrategy?: DomCaptureStrategy;
  /** Additional html2canvas-pro options used by the default provider. */
  captureOptions?: Partial<Html2CanvasOptions>;
  overlay?: BlurOverlayOptions;
  observeResize?: boolean;
  observeTheme?: boolean;
  observeContent?: boolean;
  onScroll?: (metrics: DomScrollMetrics) => void;
  onStatus?: (status: ProgressiveBlurEffectStatus) => void;
}

export type ProgressiveBlurEffectState =
  | "initializing"
  | "refreshing"
  | "ready"
  | "unsupported"
  | "error"
  | "destroyed";

export interface ProgressiveBlurEffectStatus {
  state: ProgressiveBlurEffectState;
  reason?: string;
}

export type ProgressiveBlurEffectParameters = Partial<
  Pick<
    ProgressiveBlurOptions,
    "radius" | "maxSamples" | "verticalPassFirst" | "normalizeEdges"
  >
> &
  BlurPresetOptions & {
    profile?: BlurProfile;
  };

export interface ProgressiveBlurEffect {
  readonly element: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly renderer: ProgressiveBlurRenderer | undefined;
  readonly status: ProgressiveBlurEffectStatus;
  refresh(reason?: Exclude<DomRefreshReason, "scroll">): Promise<void>;
  render(): void;
  setParameters(parameters: ProgressiveBlurEffectParameters): void;
  invalidateMask(): void;
  destroy(): void;
}

export interface NormalizedBlurOverlayBleed {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ResolvedBlurProfile {
  mode: BlurMode;
  gradient: BlurGradient;
  mask: BlurSource | undefined;
}

interface DeviceRequestResult {
  device: GPUDevice;
  adapter?: GPUAdapter;
}

const DEFAULT_GRADIENT: Required<BlurGradient> = {
  start: 0,
  end: 1,
  direction: "top-to-bottom",
};

let sharedDevicePromise: Promise<DeviceRequestResult> | undefined;
const activeEffects = new WeakMap<
  HTMLElement,
  ProgressiveBlurElementController
>();

function normalizeNumber(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value))
    throw new RangeError("Overlay bleed must be finite numbers.");
  return Math.max(0, value);
}

export function normalizeOverlayBleed(
  bleed?: number | BlurOverlayBleed,
): NormalizedBlurOverlayBleed {
  if (typeof bleed === "number") {
    const value = normalizeNumber(bleed, 0);
    return { top: value, right: value, bottom: value, left: value };
  }
  return {
    top: normalizeNumber(bleed?.top, 0),
    right: normalizeNumber(bleed?.right, 0),
    bottom: normalizeNumber(bleed?.bottom, 0),
    left: normalizeNumber(bleed?.left, 0),
  };
}

export function resolveBlurProfile(
  profile: BlurProfile = "uniform",
): ResolvedBlurProfile {
  if (profile === "uniform") {
    return {
      mode: "reference",
      gradient: { ...DEFAULT_GRADIENT },
      mask: undefined,
    };
  }
  if (profile === "navbar") {
    return {
      mode: "navbar",
      gradient: { ...DEFAULT_GRADIENT },
      mask: undefined,
    };
  }
  if (profile.type === "linear") {
    return {
      mode: "navbar",
      gradient: {
        start: profile.start ?? DEFAULT_GRADIENT.start,
        end: profile.end ?? DEFAULT_GRADIENT.end,
        direction: profile.direction ?? DEFAULT_GRADIENT.direction,
      },
      mask: undefined,
    };
  }
  if (profile.type === "radial" || profile.type === "directional") {
    validateProceduralProfile(profile);
    return {
      mode: "reference",
      gradient: { ...DEFAULT_GRADIENT },
      mask: undefined,
    };
  }
  return {
    mode: "reference",
    gradient: { ...DEFAULT_GRADIENT },
    mask: profile.source,
  };
}

async function requestSharedDevice(
  options: ProgressiveBlurAttachOptions,
): Promise<DeviceRequestResult> {
  if (
    options.device ||
    options.adapter ||
    options.powerPreference !== undefined
  ) {
    return requestWebGPUDevice(options);
  }

  if (!sharedDevicePromise) {
    let currentPromise: Promise<DeviceRequestResult>;
    const promise = requestWebGPUDevice().then((result) => {
      result.device.lost.then(() => {
        if (sharedDevicePromise === currentPromise)
          sharedDevicePromise = undefined;
      });
      return result;
    });
    currentPromise = promise.catch((error: unknown) => {
      sharedDevicePromise = undefined;
      throw error;
    });
    sharedDevicePromise = currentPromise;
  }
  return sharedDevicePromise;
}

function getPixelRatio(element: HTMLElement, requested?: number): number {
  const view = element.ownerDocument.defaultView;
  const value = requested ?? view?.devicePixelRatio ?? 1;
  if (!Number.isFinite(value)) return 1;
  return Math.min(4, Math.max(0.5, value));
}

function resizeSourceCanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  pixelRatio: number,
): void {
  const physicalWidth = Math.max(1, Math.round(width * pixelRatio));
  const physicalHeight = Math.max(1, Math.round(height * pixelRatio));
  if (canvas.width === physicalWidth && canvas.height === physicalHeight)
    return;
  canvas.width = physicalWidth;
  canvas.height = physicalHeight;
}

function isRecoverableWebGPUFailure(error: unknown): boolean {
  return (
    error instanceof ProgressiveBlurError &&
    (error.code === "webgpu-unavailable" ||
      error.code === "adapter-unavailable" ||
      error.code === "device-unavailable")
  );
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getDefaultCaptureRoot(element: HTMLElement): HTMLElement {
  const documentRoot = element.ownerDocument.documentElement;
  if (element !== element.ownerDocument.body && element.ownerDocument.body) {
    return element.ownerDocument.body;
  }
  if (element !== documentRoot) return documentRoot;
  return element.parentElement ?? element;
}

function scheduleFrame(callback: () => void): number {
  if (typeof requestAnimationFrame !== "undefined") {
    return requestAnimationFrame(() => callback());
  }
  return setTimeout(callback, 16) as unknown as number;
}

function cancelScheduledFrame(handle: number | undefined): void {
  if (handle === undefined) return;
  if (typeof cancelAnimationFrame !== "undefined") {
    cancelAnimationFrame(handle);
  } else {
    clearTimeout(handle);
  }
}

class ProgressiveBlurElementController implements ProgressiveBlurEffect {
  readonly element: HTMLElement;
  readonly canvas: HTMLCanvasElement;

  private readonly sourceCanvas: HTMLCanvasElement;
  private readonly captureRoot: HTMLElement;
  private readonly scrollTarget: Window | HTMLElement;
  private readonly capture: DomElementCapture;
  private readonly defaultCaptureHandle?: DefaultDomCaptureHandle;
  private readonly options: ProgressiveBlurAttachOptions;
  private readonly onScrollCallback?: (metrics: DomScrollMetrics) => void;
  private readonly onStatusCallback?: (
    status: ProgressiveBlurEffectStatus,
  ) => void;
  private originalPosition = "";
  private originalIsolation = "";
  private changedPosition = false;
  private changedIsolation = false;
  private readonly resizeObserver?: ResizeObserver;
  private readonly themeObserver?: MutationObserver;
  private readonly contentObserver?: MutationObserver;

  private _renderer: ProgressiveBlurRenderer | undefined;
  private _status: ProgressiveBlurEffectStatus = { state: "initializing" };
  private profile: BlurProfile;
  private presetOptions: BlurPresetOptions;
  private preset: ResolvedBlurPreset | undefined;
  private managedMask: HTMLCanvasElement | undefined;
  private maskKey = "";
  private currentSource: BlurSource | undefined;
  private operationController: AbortController | undefined;
  private scrollFrame: number | undefined;
  private refreshFrame: number | undefined;
  private queuedRefreshReason: Exclude<DomRefreshReason, "scroll"> = "manual";
  private scrollBusy = false;
  private scrollPending = false;
  private captureReleased = false;

  constructor(
    element: HTMLElement,
    options: ProgressiveBlurAttachOptions = {},
  ) {
    this.element = element;
    this.options = options;
    this.presetOptions = {
      preset: options.preset,
      placement: options.placement,
      transition: options.transition,
    };
    this.preset = resolveBlurPreset(this.presetOptions);
    if (
      options.preset &&
      (options.profile || options.overlay?.bleed !== undefined)
    ) {
      throw new TypeError(
        "preset cannot be combined with profile or overlay.bleed.",
      );
    }
    this.profile = options.profile ?? "uniform";
    resolveBlurProfile(this.profile);
    this.captureRoot = options.captureRoot ?? getDefaultCaptureRoot(element);
    const defaultScrollTarget = element.ownerDocument.defaultView;
    if (!options.scrollTarget && !defaultScrollTarget) {
      throw new Error("The blurred element is not attached to a window.");
    }
    this.scrollTarget = options.scrollTarget ?? defaultScrollTarget!;
    this.onScrollCallback = options.onScroll;
    this.onStatusCallback = options.onStatus;

    if (!this.captureRoot.contains(element) && this.captureRoot !== element) {
      throw new RangeError(
        "captureRoot must contain the element being blurred.",
      );
    }
    if (!options.capture && this.captureRoot === element) {
      throw new RangeError(
        "captureRoot must be an ancestor of the element being blurred.",
      );
    }

    const existing = activeEffects.get(element);
    if (existing) {
      throw new Error(
        "A progressive blur effect is already attached to this element.",
      );
    }

    this.canvas = element.ownerDocument.createElement("canvas");
    this.sourceCanvas = element.ownerDocument.createElement("canvas");
    this.installOverlay();

    if (options.capture) {
      this.capture = options.capture;
    } else {
      const handle = createDefaultDomCapture({
        element,
        captureRoot: this.captureRoot,
        scrollTarget: this.scrollTarget,
        strategy: options.captureStrategy ?? "document",
        html2canvasOptions: options.captureOptions,
      });
      this.defaultCaptureHandle = handle;
      this.capture = handle.capture;
    }

    this.scrollTarget.addEventListener("scroll", this.handleScroll, {
      passive: true,
    });

    if (
      options.observeResize !== false &&
      typeof ResizeObserver !== "undefined"
    ) {
      this.resizeObserver = new ResizeObserver(() => {
        this.scheduleRefresh("resize");
      });
      this.resizeObserver.observe(element);
    }

    if (
      options.observeTheme !== false &&
      typeof MutationObserver !== "undefined"
    ) {
      const documentElement = element.ownerDocument.documentElement;
      this.themeObserver = new MutationObserver(() => {
        this.scheduleRefresh("theme");
      });
      this.themeObserver.observe(documentElement, {
        attributes: true,
        attributeFilter: ["class", "data-theme", "style"],
      });
    }

    if (
      options.observeContent === true &&
      typeof MutationObserver !== "undefined"
    ) {
      this.contentObserver = new MutationObserver(() => {
        this.scheduleRefresh("manual");
      });
      this.contentObserver.observe(this.captureRoot, {
        attributes: true,
        childList: true,
        characterData: true,
        subtree: true,
      });
    }

    activeEffects.set(element, this);
    this.setStatus({ state: "initializing" });
  }

  get renderer(): ProgressiveBlurRenderer | undefined {
    return this._renderer;
  }

  get status(): ProgressiveBlurEffectStatus {
    return { ...this._status };
  }

  async initialize(): Promise<void> {
    try {
      const { device, adapter } = await requestSharedDevice(this.options);
      const resolved = resolveBlurProfile(this.profile);
      this._renderer = await createProgressiveBlur({
        canvas: this.canvas,
        source: this.sourceCanvas,
        mask: resolved.mask,
        device,
        adapter,
        powerPreference: this.options.powerPreference,
        radius: this.options.radius,
        maxSamples: this.options.maxSamples,
        mode: resolved.mode,
        verticalPassFirst: this.options.verticalPassFirst,
        normalizeEdges: this.options.normalizeEdges,
        pixelRatio: this.options.pixelRatio,
        gradient: resolved.gradient,
        format: this.options.format,
        canvasUploadMode: this.options.canvasUploadMode ?? "external",
        cacheMask: this.options.cacheMask ?? true,
      });
      this.canvas.hidden = false;
      await this.refresh("initial");
    } catch (error) {
      if (isRecoverableWebGPUFailure(error)) {
        this.releaseCapture();
        this.canvas.hidden = true;
        this.setStatus({ state: "unsupported", reason: toErrorMessage(error) });
        return;
      }
      this.setStatus({ state: "error", reason: toErrorMessage(error) });
      throw error;
    }
  }

  async refresh(
    reason: Exclude<DomRefreshReason, "scroll"> = "manual",
  ): Promise<void> {
    this.ensureAlive();
    if (!this._renderer) return;
    cancelScheduledFrame(this.refreshFrame);
    this.refreshFrame = undefined;
    await this.update(reason, true);
  }

  render(): void {
    this.ensureAlive();
    this.prepareManagedMask();
    this._renderer?.render();
  }

  setParameters(parameters: ProgressiveBlurEffectParameters): void {
    this.ensureAlive();
    const hasPreset =
      parameters.preset !== undefined ||
      parameters.placement !== undefined ||
      parameters.transition !== undefined;
    if (hasPreset && parameters.profile !== undefined)
      throw new TypeError("Choose preset or profile.");
    if (hasPreset) {
      if (this.options.overlay?.bleed !== undefined)
        throw new TypeError("preset cannot be combined with overlay.bleed.");
      const next =
        parameters.preset && parameters.preset !== this.presetOptions.preset
          ? {
              preset: parameters.preset,
              placement: parameters.placement,
              transition: parameters.transition,
            }
          : {
              ...this.presetOptions,
              ...Object.fromEntries(
                Object.entries(parameters).filter(
                  ([key, value]) =>
                    ["preset", "placement", "transition"].includes(key) &&
                    value !== undefined,
                ),
              ),
            };
      const resolved = resolveBlurPreset(next);
      this.presetOptions = next;
      if (JSON.stringify(resolved) !== JSON.stringify(this.preset)) {
        this.preset = resolved;
        this.profile = "uniform";
        this.maskKey = "";
        this.applyOverlayGeometry();
        this._renderer?.setParameters({ mode: "reference" });
        this.scheduleRefresh("resize");
      }
    }
    if (parameters.profile !== undefined) {
      const resolved = resolveBlurProfile(parameters.profile);
      this.profile = parameters.profile;
      this.preset = undefined;
      this.presetOptions = {};
      this.maskKey = "";
      this.applyOverlayGeometry();
      this._renderer?.setMask(resolved.mask);
      this._renderer?.setParameters({
        mode: resolved.mode,
        gradient: resolved.gradient,
      });
      this.scheduleRefresh("resize");
    }
    if (!this._renderer) return;
    const {
      profile: _profile,
      preset: _preset,
      placement: _placement,
      transition: _transition,
      ...coreParameters
    } = parameters;
    if (Object.keys(coreParameters).length > 0) {
      this._renderer.setParameters(coreParameters);
    }
  }

  invalidateMask(): void {
    this.ensureAlive();
    this._renderer?.invalidateMask();
  }

  destroy(): void {
    if (this._status.state === "destroyed") return;
    this.operationController?.abort();
    cancelScheduledFrame(this.scrollFrame);
    cancelScheduledFrame(this.refreshFrame);
    this.scrollFrame = undefined;
    this.refreshFrame = undefined;
    this.resizeObserver?.disconnect();
    this.themeObserver?.disconnect();
    this.contentObserver?.disconnect();
    this.scrollTarget.removeEventListener("scroll", this.handleScroll);
    this.releaseCapture();
    this._renderer?.destroy();
    this.canvas.remove();
    if (this.changedPosition)
      this.element.style.position = this.originalPosition;
    if (this.changedIsolation)
      this.element.style.isolation = this.originalIsolation;
    if (activeEffects.get(this.element) === this)
      activeEffects.delete(this.element);
    this.setStatus({ state: "destroyed" });
  }

  private async update(
    reason: DomRefreshReason,
    reportStatus: boolean,
  ): Promise<void> {
    const renderer = this._renderer;
    if (!renderer) return;

    this.operationController?.abort();
    const controller = new AbortController();
    this.operationController = controller;
    if (reportStatus) this.setStatus({ state: "refreshing" });

    try {
      if (reason === "initial") {
        const fonts = this.element.ownerDocument.fonts;
        if (fonts) await fonts.ready;
      }
      if (controller.signal.aborted) return;

      const rect = this.canvas.getBoundingClientRect();
      const width = Math.max(
        1,
        rect.width || this.element.getBoundingClientRect().width,
      );
      const height = Math.max(
        1,
        rect.height || this.element.getBoundingClientRect().height,
      );
      const pixelRatio = getPixelRatio(this.element, this.options.pixelRatio);
      renderer.resize(width, height, pixelRatio);
      resizeSourceCanvas(this.sourceCanvas, width, height, pixelRatio);
      const scroll = getScrollMetrics(this.scrollTarget);
      this.onScrollCallback?.(scroll);
      const source = await this.capture({
        element: this.element,
        captureRoot: this.captureRoot,
        rect,
        width,
        height,
        pixelRatio,
        output: this.sourceCanvas,
        excludeElements: [this.element],
        reason,
        signal: controller.signal,
        scroll,
      });
      if (controller.signal.aborted) return;

      if (this.currentSource !== source) {
        renderer.setSource(source);
        this.currentSource = source;
      }
      this.prepareManagedMask();
      renderer.render();
      if (reportStatus || this._status.state === "refreshing") {
        this.setStatus({ state: "ready" });
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      this.setStatus({ state: "error", reason: toErrorMessage(error) });
      throw error;
    } finally {
      if (this.operationController === controller)
        this.operationController = undefined;
    }
  }

  private readonly handleScroll = (): void => {
    if (this._status.state === "destroyed" || !this._renderer) return;
    if (this.scrollBusy) {
      this.scrollPending = true;
      return;
    }
    if (this.scrollFrame !== undefined) return;
    this.scrollFrame = scheduleFrame(() => {
      this.scrollFrame = undefined;
      void this.updateForScroll();
    });
  };

  private async updateForScroll(): Promise<void> {
    if (
      this.scrollBusy ||
      this._status.state === "destroyed" ||
      !this._renderer
    )
      return;
    this.scrollBusy = true;
    try {
      await this.update("scroll", false);
    } catch {
      // update() reports the actionable error through the status callback.
    } finally {
      this.scrollBusy = false;
      if (this.scrollPending) {
        this.scrollPending = false;
        this.handleScroll();
      }
    }
  }

  private scheduleRefresh(reason: Exclude<DomRefreshReason, "scroll">): void {
    this.queuedRefreshReason = reason;
    if (this.refreshFrame !== undefined || this._status.state === "destroyed")
      return;
    this.refreshFrame = scheduleFrame(() => {
      this.refreshFrame = undefined;
      const nextReason = this.queuedRefreshReason;
      void this.refresh(nextReason).catch(() => {
        // Status and the onStatus callback already contain the error.
      });
    });
  }

  private installOverlay(): void {
    const view = this.element.ownerDocument.defaultView;
    const computed = view?.getComputedStyle(this.element);
    this.originalPosition = this.element.style.position;
    this.originalIsolation = this.element.style.isolation;
    this.changedPosition = computed?.position === "static";
    this.changedIsolation = computed?.isolation === "auto";
    if (this.changedPosition) this.element.style.position = "relative";
    if (this.changedIsolation) this.element.style.isolation = "isolate";

    this.applyOverlayGeometry();
    this.canvas.className =
      this.options.overlay?.className ?? "progressive-blur-overlay";
    this.canvas.dataset.progressiveBlurOverlay = "true";
    this.canvas.setAttribute("aria-hidden", "true");
    this.canvas.setAttribute("role", "presentation");
    this.canvas.style.position = "absolute";
    this.canvas.style.pointerEvents = "none";
    this.canvas.style.display = "block";
    this.canvas.style.zIndex = String(this.options.overlay?.zIndex ?? -1);
    this.canvas.style.borderRadius = "inherit";
    this.canvas.hidden = true;
    this.element.insertBefore(this.canvas, this.element.firstChild);
  }

  private applyOverlayGeometry(): void {
    const bleed =
      this.preset?.bleed ?? normalizeOverlayBleed(this.options.overlay?.bleed);
    this.canvas.style.top = `${-bleed.top}px`;
    this.canvas.style.left = `${-bleed.left}px`;
    this.canvas.style.width = `calc(100% + ${bleed.left + bleed.right}px)`;
    this.canvas.style.height = `calc(100% + ${bleed.top + bleed.bottom}px)`;
  }

  private prepareManagedMask(): void {
    const renderer = this._renderer;
    const procedural =
      typeof this.profile === "object" &&
      (this.profile.type === "radial" || this.profile.type === "directional")
        ? this.profile
        : undefined;
    if (!renderer || (!this.preset && !procedural)) return;
    const key = JSON.stringify([
      renderer.width,
      renderer.height,
      renderer.pixelRatio,
      this.preset,
      procedural,
    ]);
    if (key === this.maskKey) return;
    this.managedMask ??= this.element.ownerDocument.createElement("canvas");
    drawManagedMask(
      this.managedMask,
      renderer.width / renderer.pixelRatio,
      renderer.height / renderer.pixelRatio,
      renderer.pixelRatio,
      this.preset,
      procedural,
    );
    renderer.setMask(this.managedMask);
    renderer.invalidateMask();
    this.maskKey = key;
  }

  private setStatus(status: ProgressiveBlurEffectStatus): void {
    this._status = status;
    this.onStatusCallback?.(this.status);
  }

  private releaseCapture(): void {
    if (this.captureReleased) return;
    this.captureReleased = true;
    this.defaultCaptureHandle?.release();
  }

  private ensureAlive(): void {
    if (this._status.state === "destroyed") {
      throw new Error(
        "The progressive blur element effect has been destroyed.",
      );
    }
  }
}

export async function attachProgressiveBlur(
  element: HTMLElement,
  options: ProgressiveBlurAttachOptions = {},
): Promise<ProgressiveBlurEffect> {
  if (
    !element ||
    element.nodeType !== 1 ||
    typeof element.getBoundingClientRect !== "function"
  ) {
    throw new TypeError("attachProgressiveBlur expects an HTMLElement.");
  }

  const controller = new ProgressiveBlurElementController(element, options);
  try {
    await controller.initialize();
    return controller;
  } catch (error) {
    controller.destroy();
    throw error;
  }
}
