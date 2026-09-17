import {
  attachProgressiveBlur,
  type ProgressiveBlurAttachOptions,
  type ProgressiveBlurEffect,
  type ProgressiveBlurEffectStatus,
} from "webgpu-progressive-blur/dom";

export interface BlurMountHandle {
  destroy(): void;
  refresh(): Promise<void>;
}

interface MountRecord {
  disposed: boolean;
  effect: ProgressiveBlurEffect | undefined;
  pending: Promise<void>;
  refreshAgain: boolean;
  refreshPromise: Promise<void> | undefined;
}

// A node can be mounted more than once during React StrictMode or a router swap.
// Keep the old promise in the chain so two attach calls never race on one node.
const records = new WeakMap<HTMLElement, MountRecord>();

function isCurrent(element: HTMLElement, record: MountRecord): boolean {
  return records.get(element) === record && !record.disposed;
}

function dispatch(
  element: HTMLElement,
  type: "progressive-blur:error" | "progressive-blur:status",
  detail: unknown,
): void {
  const EventConstructor =
    element.ownerDocument.defaultView?.CustomEvent ?? globalThis.CustomEvent;
  if (typeof EventConstructor !== "function") return;
  element.dispatchEvent(
    new EventConstructor(type, { detail, bubbles: true }),
  );
}

function reportStatus(
  element: HTMLElement,
  record: MountRecord,
  status: ProgressiveBlurEffectStatus,
): void {
  if (!isCurrent(element, record)) return;
  element.dataset.blurState = status.state;
  if (status.reason) element.dataset.blurReason = status.reason;
  else delete element.dataset.blurReason;
  dispatch(element, "progressive-blur:status", { ...status });
}

function reportError(
  element: HTMLElement,
  record: MountRecord,
  error: unknown,
): void {
  if (!isCurrent(element, record)) return;
  const reason = error instanceof Error ? error.message : String(error);
  reportStatus(element, record, { state: "error", reason });
  dispatch(element, "progressive-blur:error", error);
}

export function mountProgressiveBlur(
  element: HTMLElement,
  options: ProgressiveBlurAttachOptions,
): BlurMountHandle {
  const previous = records.get(element);
  if (previous) previous.disposed = true;
  previous?.effect?.destroy();

  const record: MountRecord = {
    disposed: false,
    effect: undefined,
    pending: Promise.resolve(),
    refreshAgain: false,
    refreshPromise: undefined,
  };
  const previousPending = previous?.pending ?? Promise.resolve();
  const ready = previousPending.catch(() => undefined).then(async () => {
    if (!isCurrent(element, record) || !element.isConnected) return;
    reportStatus(element, record, { state: "initializing" });
    try {
      const effect = await attachProgressiveBlur(element, {
        ...options,
        onStatus: (status) => {
          reportStatus(element, record, status);
          try {
            options.onStatus?.(status);
          } catch {
            // A consumer callback must not lock the mount queue.
          }
        },
      });
      if (!isCurrent(element, record) || !element.isConnected) {
        effect.destroy();
        return;
      }
      record.effect = effect;
      reportStatus(element, record, effect.status);
    } catch (error) {
      reportError(element, record, error);
    }
  });
  record.pending = ready.catch(() => undefined);
  records.set(element, record);

  const refresh = (): Promise<void> => {
    if (record.disposed) return Promise.resolve();
    if (record.refreshPromise) {
      record.refreshAgain = true;
      return record.refreshPromise;
    }

    const run = async (): Promise<void> => {
      do {
        record.refreshAgain = false;
        await record.pending;
        if (!isCurrent(element, record)) return;
        const effect = record.effect;
        if (!effect) return;
        try {
          await effect.refresh();
          reportStatus(element, record, effect.status);
        } catch (error) {
          reportError(element, record, error);
        }
      } while (record.refreshAgain && isCurrent(element, record));
    };

    const promise = run();
    record.refreshPromise = promise.finally(() => {
      record.refreshPromise = undefined;
    });
    return record.refreshPromise;
  };

  return {
    destroy(): void {
      if (record.disposed) return;
      record.disposed = true;
      record.refreshAgain = false;
      const effect = record.effect;
      record.effect = undefined;
      effect?.destroy();
    },
    refresh,
  };
}
