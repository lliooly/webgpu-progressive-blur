import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("webgpu-progressive-blur/dom", () => ({
  attachProgressiveBlur: vi.fn(),
}));

import {
  attachProgressiveBlur,
  type ProgressiveBlurEffect,
} from "webgpu-progressive-blur/dom";
import { mountProgressiveBlur } from "../templates/shared/lifecycle";

class TestCustomEvent {
  readonly type: string;
  readonly detail: unknown;
  readonly bubbles: boolean;

  constructor(type: string, init: { detail: unknown; bubbles: boolean }) {
    this.type = type;
    this.detail = init.detail;
    this.bubbles = init.bubbles;
  }
}

function element() {
  const events: TestCustomEvent[] = [];
  const target = {
    isConnected: true,
    dataset: {} as Record<string, string>,
    ownerDocument: { defaultView: { CustomEvent: TestCustomEvent } },
    dispatchEvent(event: TestCustomEvent) {
      events.push(event);
      return true;
    },
  } as unknown as HTMLElement;
  return { target, events };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

function effect(overrides: Partial<ProgressiveBlurEffect> = {}) {
  return {
    status: { state: "ready" as const },
    destroy: vi.fn(),
    refresh: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as ProgressiveBlurEffect;
}

beforeEach(() => {
  vi.mocked(attachProgressiveBlur).mockReset();
});

describe("generated shared lifecycle", () => {
  it("destroys an effect that resolves after cleanup", async () => {
    const { target } = element();
    const pending = deferred<ProgressiveBlurEffect>();
    const created = effect();
    vi.mocked(attachProgressiveBlur).mockReturnValueOnce(pending.promise);

    const handle = mountProgressiveBlur(target, {});
    await flushMicrotasks();
    expect(attachProgressiveBlur).toHaveBeenCalledTimes(1);
    handle.destroy();
    pending.resolve(created);
    await handle.refresh();

    expect(created.destroy).toHaveBeenCalledTimes(1);
    expect(target.dataset.blurState).toBe("initializing");
  });

  it("serializes the StrictMode setup-cleanup-setup sequence", async () => {
    const { target } = element();
    const first = deferred<ProgressiveBlurEffect>();
    const firstEffect = effect();
    const secondEffect = effect();
    vi.mocked(attachProgressiveBlur)
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(secondEffect);

    const firstHandle = mountProgressiveBlur(target, {});
    await flushMicrotasks();
    firstHandle.destroy();
    const secondHandle = mountProgressiveBlur(target, {});
    expect(attachProgressiveBlur).toHaveBeenCalledTimes(1);

    first.resolve(firstEffect);
    await secondHandle.refresh();

    expect(firstEffect.destroy).toHaveBeenCalledTimes(1);
    expect(attachProgressiveBlur).toHaveBeenCalledTimes(2);
    expect(target.dataset.blurState).toBe("ready");
    secondHandle.destroy();
  });

  it("keeps the queue usable after initialization failure", async () => {
    const { target, events } = element();
    const error = new Error("GPU request failed");
    const created = effect();
    vi.mocked(attachProgressiveBlur)
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(created);

    const firstHandle = mountProgressiveBlur(target, {});
    await firstHandle.refresh();
    expect(target.dataset.blurState).toBe("error");
    expect(events.some((event) => event.type === "progressive-blur:error")).toBe(
      true,
    );

    const secondHandle = mountProgressiveBlur(target, {});
    await secondHandle.refresh();
    expect(attachProgressiveBlur).toHaveBeenCalledTimes(2);
    expect(target.dataset.blurState).toBe("ready");
    secondHandle.destroy();
  });

  it("coalesces concurrent refreshes into the current refresh plus one pending refresh", async () => {
    const { target } = element();
    const created = effect();
    const firstRefresh = deferred<void>();
    vi.mocked(attachProgressiveBlur).mockResolvedValueOnce(created);
    vi.mocked(created.refresh)
      .mockReturnValueOnce(firstRefresh.promise)
      .mockResolvedValueOnce(undefined);

    const handle = mountProgressiveBlur(target, {});
    const first = handle.refresh();
    await flushMicrotasks();
    expect(created.refresh).toHaveBeenCalledTimes(1);

    const second = handle.refresh();
    const third = handle.refresh();
    expect(second).toBe(first);
    expect(third).toBe(first);
    firstRefresh.resolve();
    await first;

    expect(created.refresh).toHaveBeenCalledTimes(2);
    handle.destroy();
  });

  it("prevents a stale task from publishing state after a new mount", async () => {
    const { target } = element();
    const first = deferred<ProgressiveBlurEffect>();
    const stale = effect({ status: { state: "error", reason: "stale" } });
    const current = effect();
    vi.mocked(attachProgressiveBlur)
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(current);

    const oldHandle = mountProgressiveBlur(target, {});
    await flushMicrotasks();
    oldHandle.destroy();
    const currentHandle = mountProgressiveBlur(target, {});
    first.resolve(stale);
    await currentHandle.refresh();

    expect(target.dataset.blurState).toBe("ready");
    expect(stale.destroy).toHaveBeenCalledTimes(1);
    currentHandle.destroy();
  });
});
