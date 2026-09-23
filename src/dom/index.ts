export { ProgressiveBlurDomAdapter } from "./adapter.js";
export type {
  DomAdapterState,
  DomAdapterStatus,
  DomBlurAdapterOptions,
  DomCapture,
  DomCaptureRequest,
  DomRefreshReason,
  DomScrollMetrics,
} from "./adapter.js";
export {
  attachProgressiveBlur,
  normalizeOverlayBleed,
  resolveBlurProfile,
} from "./element.js";
export type {
  BlurOverlayBleed,
  BlurOverlayOptions,
  BlurProfile,
  DomElementCapture,
  DomElementCapturePruner,
  DomElementCaptureRequest,
  NormalizedBlurOverlayBleed,
  ProgressiveBlurAttachOptions,
  ProgressiveBlurEffect,
  ProgressiveBlurEffectParameters,
  ProgressiveBlurEffectState,
  ProgressiveBlurEffectStatus,
  ResolvedBlurProfile,
} from "./element.js";
export { createDefaultDomCapture } from "./capture.js";
export type {
  DefaultDomCaptureHandle,
  DefaultDomCaptureOptions,
  OversizedDocumentCaptureStrategy,
} from "./capture.js";

export type {
  BlurPreset,
  BlurPlacement,
  BlurPresetOptions,
  ProceduralBlurProfile,
} from "./presets.js";
