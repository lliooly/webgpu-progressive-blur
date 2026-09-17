import html2canvas from 'html2canvas';
import type { Options as Html2CanvasOptions } from 'html2canvas';
import type { BlurSource } from '../core/types.js';
import type {
  DomElementCapture,
  DomElementCaptureRequest,
} from './element.js';

export type DomCaptureStrategy = 'document' | 'viewport';

export interface DefaultDomCaptureOptions {
  element: HTMLElement;
  captureRoot: HTMLElement;
  scrollTarget: Window | HTMLElement;
  strategy: DomCaptureStrategy;
  html2canvasOptions?: Partial<Html2CanvasOptions>;
}

export interface DefaultDomCaptureHandle {
  capture: DomElementCapture;
  release(): void;
}

interface PageScroll {
  x: number;
  y: number;
}

interface RootMetrics {
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  originX: number;
  originY: number;
  pageScroll: PageScroll;
}

interface Snapshot {
  canvas: HTMLCanvasElement;
  scaleX: number;
  scaleY: number;
  originX: number;
  originY: number;
  signature: string;
}

function isDocumentRoot(root: HTMLElement): boolean {
  return root === root.ownerDocument.body || root === root.ownerDocument.documentElement;
}

function getPageScroll(document: Document): PageScroll {
  const view = document.defaultView;
  return {
    x: view?.scrollX ?? document.documentElement.scrollLeft ?? 0,
    y: view?.scrollY ?? document.documentElement.scrollTop ?? 0,
  };
}

function getViewportSize(document: Document): { width: number; height: number } {
  const view = document.defaultView;
  return {
    width: Math.max(1, view?.innerWidth ?? document.documentElement.clientWidth ?? 1),
    height: Math.max(1, view?.innerHeight ?? document.documentElement.clientHeight ?? 1),
  };
}

function isWindowScrollTarget(target: Window | HTMLElement, document: Document): boolean {
  return target === document.defaultView ||
    (typeof Window !== 'undefined' && target instanceof Window);
}

function getRootMetrics(
  root: HTMLElement,
  strategy: DomCaptureStrategy,
): RootMetrics {
  const document = root.ownerDocument;
  const viewport = getViewportSize(document);
  const pageScroll = getPageScroll(document);
  const documentRoot = isDocumentRoot(root);

  if (strategy === 'viewport') {
    if (documentRoot) {
      return {
        width: viewport.width,
        height: viewport.height,
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
        originX: pageScroll.x,
        originY: pageScroll.y,
        pageScroll,
      };
    }

    const rootRect = root.getBoundingClientRect();
    return {
      width: Math.max(1, Math.round(rootRect.width)),
      height: Math.max(1, Math.round(rootRect.height)),
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      originX: rootRect.left + pageScroll.x,
      originY: rootRect.top + pageScroll.y,
      pageScroll,
    };
  }

  if (documentRoot) {
    const documentElement = document.documentElement;
    const body = document.body;
    return {
      width: Math.max(
        viewport.width,
        documentElement.scrollWidth,
        body?.scrollWidth ?? 0,
      ),
      height: Math.max(
        viewport.height,
        documentElement.scrollHeight,
        body?.scrollHeight ?? 0,
      ),
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      originX: 0,
      originY: 0,
      pageScroll,
    };
  }

  const rootRect = root.getBoundingClientRect();
  return {
    width: Math.max(1, root.scrollWidth, Math.ceil(rootRect.width)),
    height: Math.max(1, root.scrollHeight, Math.ceil(rootRect.height)),
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    originX: rootRect.left + pageScroll.x - root.scrollLeft,
    originY: rootRect.top + pageScroll.y - root.scrollTop,
    pageScroll,
  };
}

function resizeOutput(output: HTMLCanvasElement, width: number, height: number, pixelRatio: number): void {
  const physicalWidth = Math.max(1, Math.round(width * pixelRatio));
  const physicalHeight = Math.max(1, Math.round(height * pixelRatio));
  if (output.width === physicalWidth && output.height === physicalHeight) return;
  output.width = physicalWidth;
  output.height = physicalHeight;
}

function isExcluded(element: Element, excluded: readonly HTMLElement[]): boolean {
  return excluded.some((candidate) => candidate === element || candidate.contains(element));
}

class SharedDomCaptureSession {
  private readonly captureRoot: HTMLElement;
  private readonly scrollTarget: Window | HTMLElement;
  private readonly strategy: DomCaptureStrategy;
  private readonly html2canvasOptions: Partial<Html2CanvasOptions>;
  private readonly clients = new Set<HTMLElement>();
  private snapshot: Snapshot | undefined;
  private capturePromise: Promise<void> | undefined;
  private clientRevision = 0;

  constructor(options: Omit<DefaultDomCaptureOptions, 'element'>) {
    this.captureRoot = options.captureRoot;
    this.scrollTarget = options.scrollTarget;
    this.strategy = options.strategy;
    this.html2canvasOptions = options.html2canvasOptions ?? {};
  }

  addClient(element: HTMLElement): void {
    if (this.clients.has(element)) return;
    this.clients.add(element);
    this.clientRevision += 1;
  }

  removeClient(element: HTMLElement): void {
    this.clients.delete(element);
    this.clientRevision += 1;
    if (this.clients.size === 0) this.snapshot = undefined;
  }

  async capture(request: DomElementCaptureRequest): Promise<BlurSource> {
    await this.ensureSnapshot(request);
    if (request.signal.aborted) return request.output;

    const snapshot = this.snapshot;
    if (!snapshot) {
      throw new Error('The DOM capture session did not produce a snapshot.');
    }

    resizeOutput(request.output, request.width, request.height, request.pixelRatio);
    this.drawCrop(request, snapshot);
    return request.output;
  }

  private async ensureSnapshot(request: DomElementCaptureRequest): Promise<void> {
    const metrics = getRootMetrics(this.captureRoot, this.strategy);
    const signature = [
      metrics.width,
      metrics.height,
      metrics.viewportWidth,
      metrics.viewportHeight,
      request.pixelRatio,
      metrics.originX,
      metrics.originY,
      this.strategy,
      this.clientRevision,
    ].join(':');
    const force =
      request.reason === 'manual' ||
      request.reason === 'theme' ||
      (this.strategy === 'viewport' && request.reason === 'scroll') ||
      (request.reason === 'scroll' &&
        !isWindowScrollTarget(this.scrollTarget, this.captureRoot.ownerDocument) &&
        this.captureRoot !== this.scrollTarget);

    if (!force && this.snapshot?.signature === signature) return;
    if (this.capturePromise) {
      await this.capturePromise;
      if (
        request.reason !== 'manual' &&
        request.reason !== 'theme' &&
        this.snapshot?.signature === signature
      ) {
        return;
      }
    }

    const capturePromise = this.captureSnapshot(request, metrics, signature);
    this.capturePromise = capturePromise;
    try {
      await capturePromise;
    } finally {
      if (this.capturePromise === capturePromise) this.capturePromise = undefined;
    }
  }

  private async captureSnapshot(
    request: DomElementCaptureRequest,
    metrics: RootMetrics,
    signature: string,
  ): Promise<void> {
    const customIgnore = this.html2canvasOptions.ignoreElements;
    const documentRoot = isDocumentRoot(this.captureRoot);
    const excludedElements = [...this.clients, ...request.excludeElements];
    const cropX = this.strategy === 'viewport' && documentRoot ? metrics.pageScroll.x : 0;
    const cropY = this.strategy === 'viewport' && documentRoot ? metrics.pageScroll.y : 0;
    const canvas = await html2canvas(this.captureRoot, {
      ...this.html2canvasOptions,
      backgroundColor: this.html2canvasOptions.backgroundColor ?? null,
      logging: this.html2canvasOptions.logging ?? false,
      scale: this.html2canvasOptions.scale ?? request.pixelRatio,
      useCORS: this.html2canvasOptions.useCORS ?? true,
      x: cropX,
      y: cropY,
      width: metrics.width,
      height: metrics.height,
      windowWidth: metrics.viewportWidth,
      windowHeight: metrics.viewportHeight,
      scrollX: documentRoot ? 0 : metrics.pageScroll.x,
      scrollY: documentRoot ? 0 : metrics.pageScroll.y,
      ignoreElements: (element) =>
        isExcluded(element, excludedElements) || Boolean(customIgnore?.(element)),
    });

    if (request.signal.aborted && this.clients.size === 0) return;

    const scaleX = canvas.width / Math.max(1, metrics.width);
    const scaleY = canvas.height / Math.max(1, metrics.height);
    this.snapshot = {
      canvas,
      scaleX,
      scaleY,
      originX: metrics.originX,
      originY: metrics.originY,
      signature,
    };
  }

  private drawCrop(request: DomElementCaptureRequest, snapshot: Snapshot): void {
    const context = request.output.getContext('2d');
    if (!context) {
      throw new Error('The capture output canvas could not create a 2D context.');
    }

    const target = this.getTargetPoint(request);
    const sourceX = (target.x - snapshot.originX) * snapshot.scaleX;
    const sourceY = (target.y - snapshot.originY) * snapshot.scaleY;
    const sourceWidth = request.width * snapshot.scaleX;
    const sourceHeight = request.height * snapshot.scaleY;

    context.clearRect(0, 0, request.output.width, request.output.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(
      snapshot.canvas,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      request.output.width,
      request.output.height,
    );
  }

  private getTargetPoint(request: DomElementCaptureRequest): { x: number; y: number } {
    const documentRoot = isDocumentRoot(this.captureRoot);
    const document = this.captureRoot.ownerDocument;
    const pageScroll = getPageScroll(document);
    if (documentRoot) {
      return {
        x: request.rect.left + pageScroll.x,
        y: request.rect.top + pageScroll.y,
      };
    }

    const rootRect = this.captureRoot.getBoundingClientRect();
    return {
      x: request.rect.left - rootRect.left + this.captureRoot.scrollLeft,
      y: request.rect.top - rootRect.top + this.captureRoot.scrollTop,
    };
  }
}

type SessionBucket = Map<object, Map<DomCaptureStrategy, SharedDomCaptureSession>>;

const sharedSessions = new WeakMap<HTMLElement, SessionBucket>();

function getSharedSession(options: DefaultDomCaptureOptions): SharedDomCaptureSession {
  let bucket = sharedSessions.get(options.captureRoot);
  if (!bucket) {
    bucket = new Map();
    sharedSessions.set(options.captureRoot, bucket);
  }

  const targetKey = options.scrollTarget as object;
  let byStrategy = bucket.get(targetKey);
  if (!byStrategy) {
    byStrategy = new Map();
    bucket.set(targetKey, byStrategy);
  }

  let session = byStrategy.get(options.strategy);
  if (!session) {
    session = new SharedDomCaptureSession(options);
    byStrategy.set(options.strategy, session);
  }
  return session;
}

export function createDefaultDomCapture(
  options: DefaultDomCaptureOptions,
): DefaultDomCaptureHandle {
  const hasCustomOptions = Object.keys(options.html2canvasOptions ?? {}).length > 0;
  const session = hasCustomOptions
    ? new SharedDomCaptureSession(options)
    : getSharedSession(options);
  session.addClient(options.element);

  return {
    capture: (request) => session.capture(request),
    release: () => session.removeClient(options.element),
  };
}
