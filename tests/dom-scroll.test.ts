import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createProgressiveBlurMock, requestWebGPUDeviceMock } = vi.hoisted(() => ({
  createProgressiveBlurMock: vi.fn(),
  requestWebGPUDeviceMock: vi.fn(),
}));

vi.mock('../src/core/device.js', () => ({
  ProgressiveBlurError: class ProgressiveBlurError extends Error {},
  requestWebGPUDevice: requestWebGPUDeviceMock,
}));

vi.mock('../src/core/renderer.js', () => ({
  createProgressiveBlur: createProgressiveBlurMock,
}));

import { attachProgressiveBlur } from '../src/dom/element';

function makeCanvas(): any {
  return {
    width: 0,
    height: 0,
    style: {},
    dataset: {},
    hidden: false,
    className: '',
    setAttribute: vi.fn(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 70 }),
    remove: vi.fn(),
  };
}

function makeTarget() {
  const scrollListeners: (() => void)[] = [];
  const scrollTarget: any = {
    scrollHeight: 30000,
    clientHeight: 800,
    scrollTop: 6000,
    addEventListener: vi.fn((type: string, listener: () => void) => {
      if (type === 'scroll') scrollListeners.push(listener);
    }),
    removeEventListener: vi.fn(),
  };
  const document: any = {
    fonts: { ready: Promise.resolve() },
    defaultView: {
      devicePixelRatio: 1,
      getComputedStyle: () => ({ position: 'relative', isolation: 'isolate' }),
    },
    createElement: () => makeCanvas(),
  };
  const element: any = {
    nodeType: 1,
    ownerDocument: document,
    style: { position: 'relative', isolation: 'isolate' },
    firstChild: null,
    contains: () => true,
    insertBefore: vi.fn(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 70 }),
  };
  document.body = element;
  return {
    element,
    scrollTarget,
    emitScroll: () => scrollListeners.forEach((listener) => listener()),
  };
}

function makeRenderer(canvas: unknown) {
  return {
    canvas,
    status: { supported: true, state: 'ready' },
    width: 300,
    height: 70,
    pixelRatio: 1,
    resize: vi.fn(),
    setSource: vi.fn(),
    setMask: vi.fn(),
    invalidateMask: vi.fn(),
    setParameters: vi.fn(),
    render: vi.fn(),
    destroy: vi.fn(),
  };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
  requestWebGPUDeviceMock.mockReset().mockResolvedValue({
    device: { lost: new Promise(() => {}) },
  });
  createProgressiveBlurMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('DOM blur scroll sampling', () => {
  it('limits scroll captures and coalesces movement while a capture is pending', async () => {
    const { element, scrollTarget, emitScroll } = makeTarget();
    const pending = deferred<any>();
    const capture = vi.fn((request: any) =>
      request.reason === 'initial' ? request.output : pending.promise,
    );
    let renderer: ReturnType<typeof makeRenderer>;
    createProgressiveBlurMock.mockImplementation(async ({ canvas }: any) => {
      renderer = makeRenderer(canvas);
      return renderer;
    });

    const effect = await attachProgressiveBlur(element, {
      captureRoot: element,
      scrollTarget,
      capture,
      observeResize: false,
      observeTheme: false,
    });
    expect(effect.status.state).toBe('ready');

    emitScroll();
    await vi.advanceTimersByTimeAsync(16);
    await flushMicrotasks();
    expect(capture).toHaveBeenCalledTimes(2);

    for (let index = 0; index < 12; index += 1) emitScroll();
    pending.resolve(effect.canvas);
    await flushMicrotasks();

    expect(capture).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(120);
    await vi.advanceTimersByTimeAsync(16);
    await flushMicrotasks();

    expect(capture).toHaveBeenCalledTimes(3);
    expect(renderer!.render).toHaveBeenCalledTimes(3);
    effect.destroy();
  });

  it('keeps the last rendered frame after a transient scroll capture failure', async () => {
    const { element, scrollTarget, emitScroll } = makeTarget();
    const statuses: string[] = [];
    let failNextScroll = true;
    const capture = vi.fn((request: any) => {
      if (request.reason === 'scroll' && failNextScroll) {
        failNextScroll = false;
        return Promise.reject(new Error('temporary snapshot failure'));
      }
      return request.output;
    });
    let renderer: ReturnType<typeof makeRenderer>;
    createProgressiveBlurMock.mockImplementation(async ({ canvas }: any) => {
      renderer = makeRenderer(canvas);
      return renderer;
    });

    const effect = await attachProgressiveBlur(element, {
      captureRoot: element,
      scrollTarget,
      capture,
      observeResize: false,
      observeTheme: false,
      onStatus: (status) => statuses.push(status.state),
    });
    expect(effect.status.state).toBe('ready');
    expect(renderer!.render).toHaveBeenCalledTimes(1);

    emitScroll();
    await vi.advanceTimersByTimeAsync(16);
    await flushMicrotasks();
    expect(effect.status.state).toBe('ready');
    expect(renderer!.render).toHaveBeenCalledTimes(1);
    expect(statuses).not.toContain('error');

    emitScroll();
    await vi.advanceTimersByTimeAsync(136);
    await vi.advanceTimersByTimeAsync(16);
    await flushMicrotasks();
    expect(effect.status.state).toBe('ready');
    expect(renderer!.render).toHaveBeenCalledTimes(2);
    effect.destroy();
  });
});
