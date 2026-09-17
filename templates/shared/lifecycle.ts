import {
  attachProgressiveBlur,
  type ProgressiveBlurAttachOptions,
  type ProgressiveBlurEffect,
} from "webgpu-progressive-blur/dom";

// Serialize mounts on the same node, including React StrictMode's setup/cleanup cycle.
const pending = new WeakMap<HTMLElement, Promise<void>>();
export function mountProgressiveBlur(
  element: HTMLElement,
  options: ProgressiveBlurAttachOptions,
): () => void {
  let disposed = false;
  let effect: ProgressiveBlurEffect | undefined;
  const ready = (pending.get(element) ?? Promise.resolve()).then(async () => {
    if (disposed || !element.isConnected) return;
    element.dataset.blurState = "initializing";
    try {
      effect = await attachProgressiveBlur(element, options);
      if (disposed || !element.isConnected) {
        effect.destroy();
        return;
      }
      element.dataset.blurState = effect.status.state;
    } catch (error) {
      if (disposed) return;
      element.dataset.blurState = "error";
      element.dispatchEvent(
        new CustomEvent("progressive-blur:error", {
          detail: error,
          bubbles: true,
        }),
      );
      console.warn("[progressive-blur]", error);
    }
  });
  pending.set(element, ready);
  return () => {
    disposed = true;
    effect?.destroy();
  };
}
