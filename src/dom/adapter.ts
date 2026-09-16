import type {
  BlurSource,
  ProgressiveBlurRenderer,
} from '../core/types.js';

export type DomRefreshReason = 'initial' | 'manual' | 'resize' | 'theme';

export interface DomScrollMetrics {
  top: number;
  max: number;
  progress: number;
}

export interface DomCaptureRequest {
  element: HTMLElement;
  width: number;
  height: number;
  pixelRatio: number;
  reason: DomRefreshReason;
  signal: AbortSignal;
  scroll: DomScrollMetrics;
}

export type DomCapture = (request: DomCaptureRequest) => Promise<BlurSource> | BlurSource;

export interface DomBlurAdapterOptions {
  renderer: ProgressiveBlurRenderer;
  element: HTMLElement;
  capture: DomCapture;
  scrollTarget?: Window | HTMLElement;
  observeResize?: boolean;
  observeTheme?: boolean;
  onScroll?: (metrics: DomScrollMetrics) => void;
  onStatus?: (status: DomAdapterStatus) => void;
}

export type DomAdapterState = 'idle' | 'refreshing' | 'ready' | 'error' | 'destroyed';

export interface DomAdapterStatus {
  state: DomAdapterState;
  reason?: string;
}

function getScrollMetrics(target: Window | HTMLElement): DomScrollMetrics {
  if (typeof Window !== 'undefined' && target instanceof Window) {
    const documentElement = document.documentElement;
    const max = Math.max(0, documentElement.scrollHeight - window.innerHeight);
    const top = Math.max(0, window.scrollY);
    return { top, max, progress: max === 0 ? 0 : top / max };
  }

  const element = target as HTMLElement;
  const max = Math.max(0, element.scrollHeight - element.clientHeight);
  const top = Math.max(0, element.scrollTop);
  return { top, max, progress: max === 0 ? 0 : top / max };
}

function getCanvasCssSize(renderer: ProgressiveBlurRenderer): { width: number; height: number } {
  const canvas = renderer.canvas;
  if (typeof HTMLCanvasElement !== 'undefined' && canvas instanceof HTMLCanvasElement) {
    return {
      width: canvas.clientWidth || canvas.width / renderer.pixelRatio,
      height: canvas.clientHeight || canvas.height / renderer.pixelRatio,
    };
  }
  return {
    width: canvas.width / renderer.pixelRatio,
    height: canvas.height / renderer.pixelRatio,
  };
}

export class ProgressiveBlurDomAdapter {
  private readonly renderer: ProgressiveBlurRenderer;
  private readonly element: HTMLElement;
  private readonly capture: DomCapture;
  private readonly scrollTarget: Window | HTMLElement;
  private readonly onScrollCallback?: (metrics: DomScrollMetrics) => void;
  private readonly onStatusCallback?: (status: DomAdapterStatus) => void;
  private readonly resizeObserver?: ResizeObserver;
  private readonly mutationObserver?: MutationObserver;
  private readonly abortController = new AbortController();
  private status: DomAdapterStatus = { state: 'idle' };
  private refreshController: AbortController | undefined;
  private cachedSource: BlurSource | undefined;
  private scrollFrame: number | undefined;

  constructor(options: DomBlurAdapterOptions) {
    this.renderer = options.renderer;
    this.element = options.element;
    this.capture = options.capture;
    this.scrollTarget = options.scrollTarget ?? window;
    this.onScrollCallback = options.onScroll;
    this.onStatusCallback = options.onStatus;

    this.scrollTarget.addEventListener('scroll', this.handleScroll, { passive: true });

    if (options.observeResize !== false && typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        void this.refresh('resize');
      });
      this.resizeObserver.observe(this.element);
      this.resizeObserver.observe(this.renderer.canvas as HTMLCanvasElement);
    }

    if (options.observeTheme !== false && typeof MutationObserver !== 'undefined') {
      this.mutationObserver = new MutationObserver(() => {
        void this.refresh('theme');
      });
      this.mutationObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'data-theme', 'style'],
      });
    }
  }

  get currentStatus(): DomAdapterStatus {
    return { ...this.status };
  }

  get source(): BlurSource | undefined {
    return this.cachedSource;
  }

  async start(): Promise<void> {
    await this.refresh('initial');
  }

  async refresh(reason: DomRefreshReason = 'manual'): Promise<void> {
    this.ensureAlive();
    this.refreshController?.abort();
    const controller = new AbortController();
    this.refreshController = controller;
    this.setStatus({ state: 'refreshing' });

    try {
      if (reason === 'initial' && typeof document !== 'undefined' && document.fonts) {
        await document.fonts.ready;
      }
      if (controller.signal.aborted) return;

      const { width, height } = getCanvasCssSize(this.renderer);
      const scroll = getScrollMetrics(this.scrollTarget);
      const source = await this.capture({
        element: this.element,
        width,
        height,
        pixelRatio: this.renderer.pixelRatio,
        reason,
        signal: controller.signal,
        scroll,
      });
      if (controller.signal.aborted) return;

      this.renderer.resize(width, height, this.renderer.pixelRatio);
      this.renderer.setSource(source);
      this.renderer.render();
      this.cachedSource = source;
      this.setStatus({ state: 'ready' });
    } catch (error) {
      if (controller.signal.aborted) return;
      const reasonText = error instanceof Error ? error.message : String(error);
      this.setStatus({ state: 'error', reason: reasonText });
      throw error;
    }
  }

  destroy(): void {
    if (this.status.state === 'destroyed') return;
    this.abortController.abort();
    this.refreshController?.abort();
    this.resizeObserver?.disconnect();
    this.mutationObserver?.disconnect();
    this.scrollTarget.removeEventListener('scroll', this.handleScroll);
    if (this.scrollFrame !== undefined) {
      cancelAnimationFrame(this.scrollFrame);
    }
    this.renderer.destroy();
    this.setStatus({ state: 'destroyed' });
  }

  private readonly handleScroll = (): void => {
    if (this.status.state === 'destroyed' || this.scrollFrame !== undefined) return;
    const schedule = typeof requestAnimationFrame === 'undefined' ? setTimeout : requestAnimationFrame;
    this.scrollFrame = schedule(() => {
      this.scrollFrame = undefined;
      const metrics = getScrollMetrics(this.scrollTarget);
      this.onScrollCallback?.(metrics);
      if (this.cachedSource) this.renderer.render();
    }) as number;
  };

  private setStatus(status: DomAdapterStatus): void {
    this.status = status;
    this.onStatusCallback?.(this.currentStatus);
  }

  private ensureAlive(): void {
    if (this.status.state === 'destroyed') {
      throw new Error('The progressive blur DOM adapter has been destroyed.');
    }
  }
}
