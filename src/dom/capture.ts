import html2canvas from 'html2canvas-pro';
import type { Options as Html2CanvasOptions } from 'html2canvas-pro';
import type { BlurSource } from '../core/types.js';
import type {
  DomElementCapture,
  DomElementCapturePruner,
  DomElementCaptureRequest,
} from './element.js';

export type DomCaptureStrategy = 'document' | 'viewport';
export type OversizedDocumentCaptureStrategy = 'viewport' | 'region';
type ResolvedDomCaptureStrategy = DomCaptureStrategy | 'region';

// Keep full-page captures below common browser canvas limits and avoid large
// backing stores that can silently turn transparent past their valid area.
const MAX_DOCUMENT_CAPTURE_DIMENSION = 16_384;
const MAX_DOCUMENT_CAPTURE_PIXELS = 16_777_216;
const REGION_CAPTURE_IDLE_DELAY_MS = 120;

export interface DefaultDomCaptureOptions {
  element: HTMLElement;
  captureRoot: HTMLElement;
  scrollTarget: Window | HTMLElement;
  strategy: DomCaptureStrategy;
  oversizedDocumentStrategy?: OversizedDocumentCaptureStrategy;
  pruneElement?: DomElementCapturePruner;
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
  strategy: ResolvedDomCaptureStrategy,
): RootMetrics {
  const document = root.ownerDocument;
  const viewport = getViewportSize(document);
  const pageScroll = getPageScroll(document);
  const documentRoot = isDocumentRoot(root);

  if (strategy !== 'document') {
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

function resolveCaptureStrategy(
  root: HTMLElement,
  strategy: DomCaptureStrategy,
  pixelRatio: number,
  captureScale: number,
  oversizedStrategy: OversizedDocumentCaptureStrategy,
): ResolvedDomCaptureStrategy {
  if (strategy !== 'document' || !isDocumentRoot(root)) return strategy;

  const metrics = getRootMetrics(root, 'document');
  const scale = Number.isFinite(captureScale) && captureScale > 0
    ? captureScale
    : pixelRatio;
  const physicalWidth = Math.ceil(metrics.width * scale);
  const physicalHeight = Math.ceil(metrics.height * scale);
  if (
    physicalWidth > MAX_DOCUMENT_CAPTURE_DIMENSION ||
    physicalHeight > MAX_DOCUMENT_CAPTURE_DIMENSION ||
    physicalWidth * physicalHeight > MAX_DOCUMENT_CAPTURE_PIXELS
  ) {
    return oversizedStrategy;
  }

  return strategy;
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

/** Locate an element without adding capture markers to the live document. */
function findClonedElement(
  element: HTMLElement,
  clonedDocument: Document,
  ignored: ReadonlySet<Element>,
): HTMLElement | undefined {
  const path: { tag: string; index: number }[] = [];
  let current: Element = element;
  while (current !== element.ownerDocument.documentElement) {
    const parent = current.parentElement;
    if (!parent) return undefined;
    const siblings = Array.from(parent.children).filter((sibling) =>
      sibling.localName === current.localName &&
      !ignored.has(sibling) &&
      !sibling.hasAttribute('data-html2canvas-ignore'),
    );
    const index = siblings.indexOf(current);
    if (index < 0) return undefined;
    path.push({ tag: current.localName, index });
    current = parent;
  }

  let clone: Element | undefined = clonedDocument.documentElement;
  for (const { tag, index } of path.reverse()) {
    clone = Array.from(clone.children).filter((child) => child.localName === tag)[index];
    if (!clone) return undefined;
  }
  return clone as HTMLElement;
}

const PLACEHOLDER_LAYOUT_PROPERTIES = [
  'display',
  'box-sizing',
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'flex',
  'flex-basis',
  'flex-grow',
  'flex-shrink',
  'align-self',
  'justify-self',
  'order',
  'grid-area',
  'grid-column',
  'grid-row',
  'float',
  'clear',
] as const;

function createLayoutPlaceholder(
  source: Element,
  clonedDocument: Document,
  style = source.ownerDocument.defaultView?.getComputedStyle(source),
): HTMLDivElement {
  const rect = source.getBoundingClientRect();
  const placeholder = clonedDocument.createElement('div');
  placeholder.setAttribute('data-webgpu-capture-placeholder', '');

  if (style) {
    for (const property of PLACEHOLDER_LAYOUT_PROPERTIES) {
      const value = style.getPropertyValue(property);
      if (value) placeholder.style.setProperty(property, value);
    }
  }

  // Keep the original block's outer geometry without cloning its text, images,
  // or decorative paint into the bounded snapshot.
  placeholder.style.setProperty('box-sizing', 'border-box', 'important');
  placeholder.style.setProperty('width', `${rect.width}px`, 'important');
  placeholder.style.setProperty('height', `${rect.height}px`, 'important');
  placeholder.style.setProperty('min-height', `${rect.height}px`, 'important');
  placeholder.style.setProperty('visibility', 'hidden', 'important');
  placeholder.style.setProperty('background', 'none', 'important');
  placeholder.style.setProperty('background-image', 'none', 'important');
  placeholder.style.setProperty('box-shadow', 'none', 'important');
  placeholder.style.setProperty('filter', 'none', 'important');
  return placeholder;
}

function restorePrunedLayout(
  prunedElements: readonly Element[],
  clonedDocument: Document,
  ignored: ReadonlySet<Element>,
): void {
  if (prunedElements.length === 0) return;

  const cloneCache = new Map<Element, HTMLElement | undefined>();
  const getClone = (source: Element): HTMLElement | undefined => {
    if (!cloneCache.has(source)) {
      cloneCache.set(
        source,
        findClonedElement(source as HTMLElement, clonedDocument, ignored),
      );
    }
    return cloneCache.get(source);
  };

  const placeholders = clonedDocument.createElement('style');
  placeholders.textContent = `
    [data-webgpu-capture-placeholder]::before,
    [data-webgpu-capture-placeholder]::after {
      content: none !important;
      display: none !important;
    }
  `;
  clonedDocument.head.appendChild(placeholders);

  // Process siblings in reverse document order so consecutive removed blocks
  // are inserted before the same surviving sibling without reversing them.
  for (const source of [...prunedElements].reverse()) {
    const sourceParent = source.parentElement;
    if (!sourceParent) continue;
    const sourceStyle = source.ownerDocument.defaultView?.getComputedStyle(source);
    // Out-of-flow elements do not reserve space in their parent. Replacing
    // them with a normal-flow spacer would move the remaining cloned content.
    if (sourceStyle?.position === 'absolute' || sourceStyle?.position === 'fixed') {
      continue;
    }
    const clonedParent = getClone(sourceParent);
    if (!clonedParent) continue;

    let nextSource = source.nextElementSibling;
    while (nextSource && ignored.has(nextSource)) {
      nextSource = nextSource.nextElementSibling;
    }
    const clonedNext = nextSource ? getClone(nextSource) : undefined;
    clonedParent.insertBefore(
      createLayoutPlaceholder(source, clonedDocument, sourceStyle),
      clonedNext ?? null,
    );
  }
}

class SharedDomCaptureSession {
  private readonly captureRoot: HTMLElement;
  private readonly scrollTarget: Window | HTMLElement;
  private readonly strategy: DomCaptureStrategy;
  private readonly oversizedDocumentStrategy: OversizedDocumentCaptureStrategy;
  private readonly pruneElement: DomElementCapturePruner | undefined;
  private readonly html2canvasOptions: Partial<Html2CanvasOptions>;
  private readonly clients = new Set<HTMLElement>();
  private snapshot: Snapshot | undefined;
  private capturePromise: Promise<void> | undefined;
  private clientRevision = 0;
  private lastScrollEventAt = Number.NEGATIVE_INFINITY;

  constructor(options: Omit<DefaultDomCaptureOptions, 'element'>) {
    this.captureRoot = options.captureRoot;
    this.scrollTarget = options.scrollTarget;
    this.strategy = options.strategy;
    this.oversizedDocumentStrategy = options.oversizedDocumentStrategy ?? 'viewport';
    this.pruneElement = options.pruneElement;
    this.html2canvasOptions = options.html2canvasOptions ?? {};
  }

  addClient(element: HTMLElement): void {
    if (this.clients.has(element)) return;
    const shouldObserveScroll = this.clients.size === 0;
    this.clients.add(element);
    this.clientRevision += 1;
    if (shouldObserveScroll) {
      this.lastScrollEventAt = Date.now();
      this.scrollTarget.addEventListener('scroll', this.recordScroll, { passive: true });
    }
  }

  removeClient(element: HTMLElement): void {
    this.clients.delete(element);
    this.clientRevision += 1;
    if (this.clients.size === 0) {
      this.snapshot = undefined;
      this.scrollTarget.removeEventListener('scroll', this.recordScroll);
    }
  }

  async capture(request: DomElementCaptureRequest): Promise<BlurSource> {
    // html2canvas is asynchronous. Keep the target position in the same
    // coordinate space as the scroll position when this request was issued.
    const target = this.getTargetPoint(request);
    const strategy = resolveCaptureStrategy(
      this.captureRoot,
      this.strategy,
      request.pixelRatio,
      this.html2canvasOptions.scale ?? request.pixelRatio,
      this.oversizedDocumentStrategy,
    );
    if (
      strategy === 'region' &&
      request.reason === 'scroll' &&
      !(await this.waitForRegionScrollIdle(request.signal))
    ) {
      return request.output;
    }
    if (request.signal.aborted) return request.output;
    if (strategy === 'region' && request.reason === 'scroll' && !this.isScrollRequestCurrent(request)) {
      return request.output;
    }

    await this.ensureSnapshot(request);
    if (request.signal.aborted) return request.output;

    // A scroll request is obsolete if the page moved while html2canvas was
    // cloning or rasterizing. Leave the current source untouched; the scroll
    // scheduler will issue one capture for the newest position.
    if (request.reason === 'scroll' && !this.isScrollRequestCurrent(request)) return request.output;

    const snapshot = this.snapshot;
    if (!snapshot) {
      throw new Error('The DOM capture session did not produce a snapshot.');
    }

    resizeOutput(request.output, request.width, request.height, request.pixelRatio);
    const drawn = this.drawCrop(request, snapshot, target);
    if (!drawn && request.reason !== 'scroll') {
      throw new Error('The blur target is outside the captured viewport.');
    }
    return request.output;
  }

  private readonly recordScroll = (): void => {
    this.lastScrollEventAt = Date.now();
  };

  private async waitForRegionScrollIdle(signal: AbortSignal): Promise<boolean> {
    while (!signal.aborted) {
      const remaining = REGION_CAPTURE_IDLE_DELAY_MS - (Date.now() - this.lastScrollEventAt);
      if (remaining <= 0) return true;

      await new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          signal.removeEventListener('abort', finish);
          resolve();
        };
        const timer = setTimeout(finish, remaining);
        signal.addEventListener('abort', finish, { once: true });
      });
    }
    return false;
  }

  private isScrollRequestCurrent(request: DomElementCaptureRequest): boolean {
    const currentScrollTop = isWindowScrollTarget(
      this.scrollTarget,
      this.captureRoot.ownerDocument,
    )
      ? getPageScroll(this.captureRoot.ownerDocument).y
      : (this.scrollTarget as HTMLElement).scrollTop;
    // Match getScrollMetrics' overscroll normalization before comparing.
    return Math.max(0, currentScrollTop) === request.scroll.top;
  }

  private async ensureSnapshot(request: DomElementCaptureRequest): Promise<void> {
    const strategy = resolveCaptureStrategy(
      this.captureRoot,
      this.strategy,
      request.pixelRatio,
      this.html2canvasOptions.scale ?? request.pixelRatio,
      this.oversizedDocumentStrategy,
    );
    const metrics = getRootMetrics(this.captureRoot, strategy);
    const regionTarget = strategy === 'region' ? this.getTargetPoint(request) : undefined;
    const signature = [
      metrics.width,
      metrics.height,
      metrics.viewportWidth,
      metrics.viewportHeight,
      request.pixelRatio,
      metrics.originX,
      metrics.originY,
      strategy,
      regionTarget?.x,
      regionTarget?.y,
      strategy === 'region' ? request.width : undefined,
      strategy === 'region' ? request.height : undefined,
      this.clientRevision,
    ].join(':');
    const force =
      request.reason === 'manual' ||
      request.reason === 'theme' ||
      ((strategy === 'viewport' || strategy === 'region') && request.reason === 'scroll') ||
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

    const capturePromise = this.captureSnapshot(request, metrics, signature, strategy);
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
    strategy: ResolvedDomCaptureStrategy,
  ): Promise<void> {
    const customIgnore = this.html2canvasOptions.ignoreElements;
    const customOnClone = this.html2canvasOptions.onclone;
    const documentRoot = isDocumentRoot(this.captureRoot);
    const excludedElements = [...this.clients, ...request.excludeElements];
    const ignoredElements = new Set<Element>();
    const prunedElements = new Set<Element>();
    const regionTarget = strategy === 'region' ? this.getTargetPoint(request) : undefined;
    const cropX = regionTarget
      ? regionTarget.x
      : strategy === 'viewport' && documentRoot
        ? metrics.pageScroll.x
        : 0;
    const cropY = regionTarget
      ? regionTarget.y
      : strategy === 'viewport' && documentRoot
        ? metrics.pageScroll.y
        : 0;
    const captureWidth = regionTarget ? request.width : metrics.width;
    const captureHeight = regionTarget ? request.height : metrics.height;
    const canvas = await html2canvas(this.captureRoot, {
      ...this.html2canvasOptions,
      backgroundColor: this.html2canvasOptions.backgroundColor ?? null,
      logging: this.html2canvasOptions.logging ?? false,
      scale: this.html2canvasOptions.scale ?? request.pixelRatio,
      useCORS: this.html2canvasOptions.useCORS ?? true,
      x: cropX,
      y: cropY,
      width: captureWidth,
      height: captureHeight,
      windowWidth: metrics.viewportWidth,
      windowHeight: metrics.viewportHeight,
      scrollX: documentRoot ? 0 : metrics.pageScroll.x,
      scrollY: documentRoot ? 0 : metrics.pageScroll.y,
      ignoreElements: (element) => {
        // Keep the entire effect subtree in layout, including children that a
        // caller normally ignores. Removing a sticky/flow element shifts the
        // captured page; removing its children can change its intrinsic size.
        if (isExcluded(element, excludedElements)) return false;
        if (regionTarget && this.pruneElement?.(element, request)) {
          ignoredElements.add(element);
          prunedElements.add(element);
          return true;
        }
        const ignore = Boolean(customIgnore?.(element));
        if (ignore) ignoredElements.add(element);
        return ignore;
      },
      onclone: async (document, root) => {
        const clones = excludedElements.map((element) =>
          findClonedElement(element, document, ignoredElements),
        );
        await customOnClone?.(document, root);
        restorePrunedLayout([...prunedElements], document, ignoredElements);
        for (const clone of clones) {
          // Opacity hides the complete subtree, even visibility:visible
          // descendants, while preserving sticky, flex and grid geometry.
          clone?.style.setProperty('opacity', '0', 'important');
        }
      },
    });

    if (request.signal.aborted && this.clients.size === 0) return;

    const scaleX = canvas.width / Math.max(1, captureWidth);
    const scaleY = canvas.height / Math.max(1, captureHeight);
    this.snapshot = {
      canvas,
      scaleX,
      scaleY,
      originX: regionTarget?.x ?? metrics.originX,
      originY: regionTarget?.y ?? metrics.originY,
      signature,
    };
  }

  private drawCrop(
    request: DomElementCaptureRequest,
    snapshot: Snapshot,
    target: { x: number; y: number },
  ): boolean {
    const context = request.output.getContext('2d');
    if (!context) {
      throw new Error('The capture output canvas could not create a 2D context.');
    }

    const sourceX = (target.x - snapshot.originX) * snapshot.scaleX;
    const sourceY = (target.y - snapshot.originY) * snapshot.scaleY;
    const sourceWidth = request.width * snapshot.scaleX;
    const sourceHeight = request.height * snapshot.scaleY;
    const sourceRight = sourceX + sourceWidth;
    const sourceBottom = sourceY + sourceHeight;

    // Never clear the last good sample for a stale or partially out-of-bounds
    // viewport crop. This can happen when the page moves while a capture runs.
    if (
      !Number.isFinite(sourceX) ||
      !Number.isFinite(sourceY) ||
      sourceX < 0 ||
      sourceY < 0 ||
      sourceRight > snapshot.canvas.width ||
      sourceBottom > snapshot.canvas.height
    ) {
      return false;
    }

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
    return true;
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

    // Snapshot origins are kept in document/page coordinates for both root
    // kinds. Converting the target to the same space is important when the
    // capture root is a nested scrolling element.
    return {
      x: request.rect.left + pageScroll.x,
      y: request.rect.top + pageScroll.y,
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
  const hasCustomOptions =
    Object.keys(options.html2canvasOptions ?? {}).length > 0 ||
    options.pruneElement !== undefined ||
    options.oversizedDocumentStrategy !== undefined;
  const session = hasCustomOptions
    ? new SharedDomCaptureSession(options)
    : getSharedSession(options);
  session.addClient(options.element);

  return {
    capture: (request) => session.capture(request),
    release: () => session.removeClient(options.element),
  };
}
