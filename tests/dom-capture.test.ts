import { beforeEach, describe, expect, it, vi } from 'vitest';

const html2canvas = vi.hoisted(() => vi.fn());

vi.mock('html2canvas-pro', () => ({
  default: html2canvas,
}));

import { createDefaultDomCapture } from '../src/dom/capture';

describe('default DOM capture', () => {
  beforeEach(() => {
    html2canvas.mockReset();
  });

  it('crops a nested capture root in the same coordinate space as its snapshot', async () => {
    const targetRect = {
      left: 130,
      top: 260,
      width: 80,
      height: 40,
    } as DOMRectReadOnly;
    const document = {
      body: {},
      documentElement: {
        clientWidth: 1200,
        clientHeight: 800,
        scrollLeft: 0,
        scrollTop: 0,
      },
      defaultView: {
        innerWidth: 1200,
        innerHeight: 800,
        scrollX: 0,
        scrollY: 0,
      },
    } as unknown as Document;
    const root = {
      ownerDocument: document,
      scrollLeft: 0,
      scrollTop: 0,
      scrollWidth: 600,
      scrollHeight: 400,
      getBoundingClientRect: () => ({
        left: 100,
        top: 200,
        width: 600,
        height: 400,
      }),
    } as unknown as HTMLElement;

    const draws: unknown[][] = [];
    const output = {
      width: 0,
      height: 0,
      getContext: () => ({
        clearRect: vi.fn(),
        drawImage: (...args: unknown[]) => draws.push(args),
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high',
      }),
    } as unknown as HTMLCanvasElement;
    const snapshot = { width: 600, height: 400 } as HTMLCanvasElement;
    html2canvas.mockResolvedValue(snapshot);

    const capture = createDefaultDomCapture({
      element: { contains: () => false } as unknown as HTMLElement,
      captureRoot: root,
      scrollTarget: document.defaultView as unknown as Window,
      strategy: 'document',
    });

    await capture.capture({
      element: root,
      captureRoot: root,
      rect: targetRect,
      width: 80,
      height: 40,
      pixelRatio: 1,
      output,
      excludeElements: [],
      reason: 'initial',
      signal: new AbortController().signal,
      scroll: { top: 0, max: 0, progress: 0 },
    });

    expect(draws[0]?.slice(1, 5)).toEqual([30, 60, 80, 40]);
    capture.release();
  });
});
