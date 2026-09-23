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

  it('preserves excluded subtrees and finds their clones after ignored siblings', async () => {
    function node(tag: string, children: any[] = []) {
      const element: any = {
        localName: tag,
        children,
        style: { setProperty: vi.fn() },
        hasAttribute: () => false,
        contains(other: any): boolean {
          return children.some((child) => child === other || child.contains(other));
        },
      };
      for (const child of children) child.parentElement = element;
      return element;
    }
    const inner = node('div');
    const ignoredSibling = node('header');
    const target = node('header', [inner]);
    const otherTarget = node('aside');
    const body = node('body', [ignoredSibling, target, otherTarget]);
    const html = node('html', [body]);
    const document: any = {
      body, documentElement: html,
      defaultView: { innerWidth: 320, innerHeight: 180, scrollX: 0, scrollY: 0 },
    };
    html.scrollWidth = 320;
    html.scrollHeight = 180;
    body.scrollWidth = 320;
    body.scrollHeight = 180;
    for (const element of [html, body, ignoredSibling, target, inner, otherTarget]) {
      element.ownerDocument = document;
    }
    const cloneTarget = node('header', [node('div')]);
    const cloneOther = node('aside');
    const cloneBody = node('body', [cloneTarget, cloneOther]);
    const cloneDocument: any = { documentElement: node('html', [cloneBody]) };
    const onclone = vi.fn(async () => {
      await Promise.resolve();
      cloneTarget.style.setProperty('opacity', '1');
    });
    const customIgnore = vi.fn((element) =>
      element === ignoredSibling || element === target || element === inner,
    );
    html2canvas.mockImplementation(async (_root, options) => {
      expect(options.ignoreElements(ignoredSibling)).toBe(true);
      expect(options.ignoreElements(target)).toBe(false);
      expect(options.ignoreElements(inner)).toBe(false);
      expect(options.ignoreElements(otherTarget)).toBe(false);
      await options.onclone(cloneDocument, cloneBody);
      expect(cloneTarget.style.setProperty).toHaveBeenLastCalledWith('opacity', '0', 'important');
      expect(cloneOther.style.setProperty).toHaveBeenCalledWith('opacity', '0', 'important');
      expect(target.style.setProperty).not.toHaveBeenCalled();
      expect(inner.style.setProperty).not.toHaveBeenCalled();
      return { width: 320, height: 180 };
    });
    const output = {
      width: 320, height: 180,
      getContext: () => ({ clearRect: vi.fn(), drawImage: vi.fn() }),
    } as unknown as HTMLCanvasElement;
    const capture = createDefaultDomCapture({
      element: target, captureRoot: body, scrollTarget: document.defaultView,
      strategy: 'document', html2canvasOptions: { ignoreElements: customIgnore, onclone },
    });
    await capture.capture({
      element: target, captureRoot: body,
      rect: { left: 0, top: 0 } as DOMRectReadOnly,
      width: 320, height: 180, pixelRatio: 1, output,
      excludeElements: [otherTarget], reason: 'initial',
      signal: new AbortController().signal,
      scroll: { top: 0, max: 0, progress: 0 },
    });
    expect(onclone).toHaveBeenCalledWith(cloneDocument, cloneBody);
    expect(customIgnore).toHaveBeenCalledTimes(1);
    capture.release();
  });

  it('uses viewport snapshots for oversized documents and refreshes them while scrolling', async () => {
    const view = {
      innerWidth: 1200,
      innerHeight: 800,
      scrollX: 0,
      scrollY: 6000,
    };
    const document: any = {
      defaultView: view,
      documentElement: { scrollWidth: 1200, scrollHeight: 30000 },
    };
    const body: any = {
      ownerDocument: document,
      scrollWidth: 1200,
      scrollHeight: 30000,
    };
    document.body = body;
    const target = {
      ownerDocument: document,
      contains: () => false,
    } as unknown as HTMLElement;
    const draws: unknown[][] = [];
    const output = {
      width: 0,
      height: 0,
      getContext: () => ({
        clearRect: vi.fn(),
        drawImage: (...args: unknown[]) => draws.push(args),
      }),
    } as unknown as HTMLCanvasElement;
    html2canvas.mockResolvedValue({ width: 1200, height: 800 });

    const capture = createDefaultDomCapture({
      element: target,
      captureRoot: body,
      scrollTarget: view as unknown as Window,
      strategy: 'document',
    });
    const request = (reason: 'initial' | 'scroll') => capture.capture({
      element: target,
      captureRoot: body,
      rect: { left: 0, top: 0 } as DOMRectReadOnly,
      width: 1200,
      height: 80,
      pixelRatio: 1,
      output,
      excludeElements: [target],
      reason,
      signal: new AbortController().signal,
      scroll: { top: view.scrollY, max: 30000, progress: view.scrollY / 30000 },
    });

    await request('initial');
    expect(html2canvas).toHaveBeenCalledTimes(1);
    expect(html2canvas.mock.calls[0]?.[1]).toMatchObject({
      width: 1200,
      height: 800,
      x: 0,
      y: 6000,
      scrollY: 0,
    });

    view.scrollY = 6500;
    await request('scroll');
    expect(html2canvas).toHaveBeenCalledTimes(2);
    expect(html2canvas.mock.calls[1]?.[1]).toMatchObject({
      width: 1200,
      height: 800,
      y: 6500,
    });
    expect(draws.map((draw) => draw.slice(1, 5))).toEqual([
      [0, 0, 1200, 80],
      [0, 0, 1200, 80],
    ]);

    capture.release();
  });

  it('keeps request-time coordinates when scrolling continues during capture', async () => {
    const view = {
      innerWidth: 1200,
      innerHeight: 800,
      scrollX: 0,
      scrollY: 6000,
    };
    const document: any = {
      defaultView: view,
      documentElement: { scrollWidth: 1200, scrollHeight: 30000 },
    };
    const body: any = {
      ownerDocument: document,
      scrollWidth: 1200,
      scrollHeight: 30000,
    };
    document.body = body;
    const target = {
      ownerDocument: document,
      contains: () => false,
    } as unknown as HTMLElement;
    const draws: unknown[][] = [];
    const output = {
      width: 0,
      height: 0,
      getContext: () => ({
        clearRect: vi.fn(),
        drawImage: (...args: unknown[]) => draws.push(args),
      }),
    } as unknown as HTMLCanvasElement;
    let resolveSnapshot!: (canvas: { width: number; height: number }) => void;
    html2canvas.mockReturnValue(new Promise((resolve) => {
      resolveSnapshot = resolve;
    }));

    const capture = createDefaultDomCapture({
      element: target,
      captureRoot: body,
      scrollTarget: view as unknown as Window,
      strategy: 'document',
    });
    const pending = capture.capture({
      element: target,
      captureRoot: body,
      rect: { left: 0, top: 0 } as DOMRectReadOnly,
      width: 1200,
      height: 80,
      pixelRatio: 1,
      output,
      excludeElements: [target],
      reason: 'initial',
      signal: new AbortController().signal,
      scroll: { top: view.scrollY, max: 30000, progress: 0.2 },
    });

    // The captured viewport starts at y=6000, but the live page advances
    // beyond the viewport before html2canvas finishes.
    view.scrollY = 9000;
    resolveSnapshot({ width: 1200, height: 800 });
    await pending;

    expect(draws.map((draw) => draw.slice(1, 5))).toEqual([[0, 0, 1200, 80]]);
    capture.release();
  });

  it('preserves the last output when a scroll crop falls outside its snapshot', async () => {
    const view = {
      innerWidth: 1200,
      innerHeight: 800,
      scrollX: 0,
      scrollY: 6000,
    };
    const document: any = {
      defaultView: view,
      documentElement: { scrollWidth: 1200, scrollHeight: 30000 },
    };
    const body: any = {
      ownerDocument: document,
      scrollWidth: 1200,
      scrollHeight: 30000,
    };
    document.body = body;
    const target = {
      ownerDocument: document,
      contains: () => false,
    } as unknown as HTMLElement;
    const clearRect = vi.fn();
    const drawImage = vi.fn();
    const output = {
      width: 0,
      height: 0,
      getContext: () => ({ clearRect, drawImage }),
    } as unknown as HTMLCanvasElement;
    html2canvas.mockResolvedValue({ width: 1200, height: 800 });

    const capture = createDefaultDomCapture({
      element: target,
      captureRoot: body,
      scrollTarget: view as unknown as Window,
      strategy: 'document',
    });
    await capture.capture({
      element: target,
      captureRoot: body,
      rect: { left: 0, top: 850 } as DOMRectReadOnly,
      width: 1200,
      height: 80,
      pixelRatio: 1,
      output,
      excludeElements: [target],
      reason: 'scroll',
      signal: new AbortController().signal,
      scroll: { top: view.scrollY, max: 30000, progress: 0.2 },
    });

    expect(clearRect).not.toHaveBeenCalled();
    expect(drawImage).not.toHaveBeenCalled();
    capture.release();
  });

  it('discards a viewport capture if scrolling moved before it completed', async () => {
    const view = {
      innerWidth: 1200,
      innerHeight: 800,
      scrollX: 0,
      scrollY: 6000,
    };
    const document: any = {
      defaultView: view,
      documentElement: { scrollWidth: 1200, scrollHeight: 30000 },
    };
    const body: any = {
      ownerDocument: document,
      scrollWidth: 1200,
      scrollHeight: 30000,
    };
    document.body = body;
    const target = {
      ownerDocument: document,
      contains: () => false,
    } as unknown as HTMLElement;
    const clearRect = vi.fn();
    const drawImage = vi.fn();
    const output = {
      width: 0,
      height: 0,
      getContext: () => ({ clearRect, drawImage }),
    } as unknown as HTMLCanvasElement;
    html2canvas.mockResolvedValueOnce({ width: 1200, height: 800 });
    let resolveSnapshot!: (canvas: { width: number; height: number }) => void;
    html2canvas.mockReturnValueOnce(new Promise((resolve) => {
      resolveSnapshot = resolve;
    }));

    const capture = createDefaultDomCapture({
      element: target,
      captureRoot: body,
      scrollTarget: view as unknown as Window,
      strategy: 'document',
    });
    const request = (top: number, reason: 'initial' | 'scroll') => capture.capture({
      element: target,
      captureRoot: body,
      rect: { left: 0, top: 0 } as DOMRectReadOnly,
      width: 1200,
      height: 80,
      pixelRatio: 1,
      output,
      excludeElements: [target],
      reason,
      signal: new AbortController().signal,
      scroll: { top, max: 30000, progress: top / 30000 },
    });

    await request(view.scrollY, 'initial');
    expect(drawImage).toHaveBeenCalledTimes(1);
    view.scrollY = 6500;
    const pending = request(view.scrollY, 'scroll');
    view.scrollY = 7000;
    resolveSnapshot({ width: 1200, height: 800 });
    await pending;

    expect(clearRect).toHaveBeenCalledTimes(1);
    expect(drawImage).toHaveBeenCalledTimes(1);
    capture.release();
  });

});
