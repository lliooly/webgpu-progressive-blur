export type BlurMode = 'reference' | 'navbar';

export type GradientDirection = 'top-to-bottom' | 'bottom-to-top';

export type CanvasTarget = HTMLCanvasElement | OffscreenCanvas;

export type BlurSource = GPUTexture | GPUCopyExternalImageSource;

export interface BlurGradient {
  /** The normalized point where the gradient starts. */
  start?: number;
  /** The normalized point where the gradient ends. */
  end?: number;
  /** Which edge receives the strongest blur. */
  direction?: GradientDirection;
}

export interface ProgressiveBlurOptions {
  /** Canvas receiving the final composited image. */
  canvas: CanvasTarget;
  /** Optional image source. It can also be provided later with setSource(). */
  source?: BlurSource;
  /** Optional alpha mask used by the reference mode. */
  mask?: BlurSource;
  /** An existing device, useful when the caller owns the WebGPU context. */
  device?: GPUDevice;
  /** Adapter used when the renderer creates its own device. */
  adapter?: GPUAdapter;
  /** Device preference passed to requestAdapter(). */
  powerPreference?: GPUPowerPreference;
  /** Public blur radius in CSS pixels, interpreted as Gaussian sigma. */
  radius?: number;
  /** Maximum samples in each direction. Values above 64 are clamped. */
  maxSamples?: number;
  /** Reference mask mode or the analytical navbar gradient mode. */
  mode?: BlurMode;
  /** Run the vertical pass before the horizontal pass. */
  verticalPassFirst?: boolean;
  /** Renormalize samples at the edges instead of clamping them. */
  normalizeEdges?: boolean;
  /** CSS pixels to physical pixels. Defaults to devicePixelRatio in browsers. */
  pixelRatio?: number;
  /** Analytical gradient settings used by the navbar mode. */
  gradient?: BlurGradient;
  /** Explicit output format for a caller-owned canvas context. */
  format?: GPUTextureFormat;
}

export interface BlurParameters {
  radius: number;
  maxSamples: number;
  mode: BlurMode;
  verticalPassFirst: boolean;
  normalizeEdges: boolean;
  gradient: Required<BlurGradient>;
}

export type BlurState = 'ready' | 'lost' | 'destroyed';

export interface BlurStatus {
  supported: boolean;
  state: BlurState | 'unsupported' | 'error';
  message?: string;
}

export interface ProgressiveBlurRenderer {
  readonly canvas: CanvasTarget;
  readonly status: BlurStatus;
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
  readonly parameters: Readonly<BlurParameters>;
  setSource(source: BlurSource): void;
  setMask(mask: BlurSource | undefined): void;
  setParameters(parameters: Partial<ProgressiveBlurOptions>): void;
  resize(cssWidth?: number, cssHeight?: number, pixelRatio?: number): void;
  render(): void;
  destroy(): void;
}

export interface WebGPUCapability {
  supported: boolean;
  reason?: string;
}
