import {
  createProgressiveBlur,
  getWebGPUCapability,
  type BlurMode,
  type ProgressiveBlurRenderer,
} from '@webgpu-progressive-blur';
import html2canvas from 'html2canvas';
import './style.css';

const nav = document.querySelector<HTMLElement>('#site-nav')!;
const outputCanvas = document.querySelector<HTMLCanvasElement>('#blur-output')!;
const statusMessage = document.querySelector<HTMLElement>('#gpu-status')!;
const statusDot = document.querySelector<HTMLElement>('#status-dot')!;
const modeControl = document.querySelector<HTMLSelectElement>('#mode-control')!;
const radiusControl = document.querySelector<HTMLInputElement>('#radius-control')!;
const samplesControl = document.querySelector<HTMLInputElement>('#samples-control')!;
const startControl = document.querySelector<HTMLInputElement>('#start-control')!;
const endControl = document.querySelector<HTMLInputElement>('#end-control')!;
const orderControl = document.querySelector<HTMLInputElement>('#order-control')!;
const edgeControl = document.querySelector<HTMLInputElement>('#edge-control')!;
const radiusValue = document.querySelector<HTMLOutputElement>('#radius-value')!;
const samplesValue = document.querySelector<HTMLOutputElement>('#samples-value')!;
const startValue = document.querySelector<HTMLOutputElement>('#start-value')!;
const endValue = document.querySelector<HTMLOutputElement>('#end-value')!;
const passValue = document.querySelector<HTMLElement>('#pass-value')!;
const frameValue = document.querySelector<HTMLElement>('#frame-value')!;
const gradientControls = [...document.querySelectorAll<HTMLElement>('.gradient-only')];

const sourceCanvas = document.createElement('canvas');
const maskCanvas = document.createElement('canvas');
const sourceContext = sourceCanvas.getContext('2d', { alpha: false })!;
const maskContext = maskCanvas.getContext('2d')!;

type OutputMetrics = {
  cssWidth: number;
  cssHeight: number;
  width: number;
  height: number;
  navHeight: number;
};

let renderer: ProgressiveBlurRenderer | undefined;
let pixelRatio = Math.min(2, window.devicePixelRatio || 1);
let pageSnapshot: HTMLCanvasElement | undefined;
let renderFrame: number | undefined;
let resizeFrame: number | undefined;
let lastRenderAt = 0;
let maskKey = '';
let parametersDirty = true;
let rendererSizeKey = '';

function setStatus(state: 'pending' | 'ready' | 'fallback' | 'error', message: string): void {
  statusMessage.textContent = message;
  document.documentElement.dataset.gpu = state;
  statusDot.className = `status-dot ${state}`;
}

function getOutputMetrics(): OutputMetrics {
  const outputRect = outputCanvas.getBoundingClientRect();
  const cssWidth = Math.max(1, outputRect.width || window.innerWidth);
  const cssHeight = Math.max(1, outputRect.height || nav.getBoundingClientRect().height);
  const navHeight = Math.max(1, nav.getBoundingClientRect().height);
  return {
    cssWidth,
    cssHeight,
    width: Math.max(1, Math.round(cssWidth * pixelRatio)),
    height: Math.max(1, Math.round(cssHeight * pixelRatio)),
    navHeight,
  };
}

function currentGradient(metrics: OutputMetrics): { start: number; end: number; direction: 'top-to-bottom' } {
  const visibleRatio = Math.min(1, metrics.navHeight / metrics.cssHeight);
  const start = Number(startControl.value) * visibleRatio;
  const end = Math.max(Number(endControl.value), Number(startControl.value) + 0.01) * visibleRatio;
  return {
    start,
    end: Math.max(end, start + 0.01),
    direction: 'top-to-bottom',
  };
}

async function capturePageSnapshot(): Promise<void> {
  const cssWidth = Math.max(1, document.documentElement.clientWidth || window.innerWidth);
  const cssHeight = Math.max(
    window.innerHeight,
    document.documentElement.scrollHeight,
    document.body.scrollHeight,
  );
  const snapshot = await html2canvas(document.body, {
    backgroundColor: null,
    height: cssHeight,
    logging: false,
    scale: pixelRatio,
    scrollX: 0,
    scrollY: 0,
    width: cssWidth,
    windowHeight: cssHeight,
    windowWidth: cssWidth,
    ignoreElements: (element) =>
      element.id === 'site-nav' || element.classList.contains('control-dock'),
  });
  pageSnapshot = snapshot;
}

function drawSourceSlice(): OutputMetrics {
  const metrics = getOutputMetrics();
  const { width, height } = metrics;
  if (sourceCanvas.width !== metrics.width || sourceCanvas.height !== metrics.height) {
    sourceCanvas.width = metrics.width;
    sourceCanvas.height = metrics.height;
  }

  const sourceY = pageSnapshot
    ? Math.max(0, Math.min(pageSnapshot.height - height, Math.round(window.scrollY * pixelRatio)))
    : 0;
  sourceContext.clearRect(0, 0, width, height);
  if (pageSnapshot) {
    sourceContext.drawImage(pageSnapshot, 0, sourceY, width, height, 0, 0, width, height);
  } else {
    sourceContext.fillStyle = '#0d1119';
    sourceContext.fillRect(0, 0, width, height);
  }

  if (modeControl.value === 'reference') {
    const visibleRatio = Math.min(1, metrics.navHeight / metrics.cssHeight);
    const gradientStart = Number(startControl.value) * visibleRatio;
    const gradientEnd = Math.max(Number(endControl.value), Number(startControl.value) + 0.01) * visibleRatio;
    const nextMaskKey = [
      metrics.width,
      metrics.height,
      metrics.cssHeight,
      metrics.navHeight,
      gradientStart,
      gradientEnd,
    ].join(':');
    if (
      maskKey !== nextMaskKey ||
      maskCanvas.width !== metrics.width ||
      maskCanvas.height !== metrics.height
    ) {
      maskCanvas.width = metrics.width;
      maskCanvas.height = metrics.height;
      const gradient = maskContext.createLinearGradient(
        0,
        metrics.height * gradientStart,
        0,
        metrics.height * gradientEnd,
      );
      gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
      gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
      maskContext.fillStyle = gradient;
      maskContext.fillRect(0, 0, metrics.width, metrics.height);
      maskKey = nextMaskKey;
      renderer?.invalidateMask();
    }
  }
  return metrics;
}

function updateControlLabels(changed?: 'start' | 'end'): void {
  const radius = Number(radiusControl.value);
  const samples = Number(samplesControl.value);
  let start = Number(startControl.value);
  let end = Number(endControl.value);
  if (changed === 'start' && start >= end) {
    end = Math.min(1, start + 0.01);
    endControl.value = String(end);
  } else if (changed === 'end' && end <= start) {
    start = Math.max(0, end - 0.01);
    startControl.value = String(start);
  }
  radiusValue.value = `${radius.toFixed(1).replace('.0', '')} px`;
  samplesValue.value = `${samples} / axis`;
  startValue.value = `${Math.round(start * 100)}%`;
  endValue.value = `${Math.round(end * 100)}%`;
  passValue.textContent = orderControl.checked ? 'Y → X' : 'X → Y';
  gradientControls.forEach((control) => {
    control.hidden = modeControl.value !== 'navbar';
  });
}

function syncRendererSize(metrics: OutputMetrics): void {
  if (!renderer) return;
  const nextSizeKey = `${metrics.width}:${metrics.height}:${pixelRatio}`;
  if (
    rendererSizeKey === nextSizeKey &&
    renderer.width === metrics.width &&
    renderer.height === metrics.height &&
    renderer.pixelRatio === pixelRatio
  ) {
    return;
  }
  if (
    renderer.width !== metrics.width ||
    renderer.height !== metrics.height ||
    renderer.pixelRatio !== pixelRatio
  ) {
    renderer.resize(metrics.cssWidth, metrics.cssHeight, pixelRatio);
  }
  rendererSizeKey = nextSizeKey;
}

function renderNow(): void {
  if (!renderer) return;
  const startedAt = performance.now();
  const metrics = drawSourceSlice();
  syncRendererSize(metrics);
  if (parametersDirty) {
    renderer.setParameters({
      mode: modeControl.value as BlurMode,
      radius: Number(radiusControl.value),
      maxSamples: Number(samplesControl.value),
      verticalPassFirst: orderControl.checked,
      normalizeEdges: edgeControl.checked,
      gradient: currentGradient(metrics),
    });
    parametersDirty = false;
  }
  renderer.render();
  lastRenderAt = performance.now() - startedAt;
  frameValue.textContent = `CPU ${lastRenderAt.toFixed(1)} ms`;
}

function scheduleRender(): void {
  if (renderFrame !== undefined) return;
  renderFrame = requestAnimationFrame(() => {
    renderFrame = undefined;
    renderNow();
  });
}

function handleResize(): void {
  if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = undefined;
    pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    parametersDirty = true;
    rendererSizeKey = '';
    maskKey = '';
    void capturePageSnapshot()
      .then(() => {
        scheduleRender();
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        setStatus('error', `Page capture failed — ${message}`);
      });
  });
}

function bindControls(): void {
  [modeControl, radiusControl, samplesControl, startControl, endControl, orderControl, edgeControl].forEach((control) => {
    control.addEventListener('input', () => {
      const changed = control === startControl ? 'start' : control === endControl ? 'end' : undefined;
      updateControlLabels(changed);
      parametersDirty = true;
      scheduleRender();
    });
    control.addEventListener('change', () => {
      const changed = control === startControl ? 'start' : control === endControl ? 'end' : undefined;
      updateControlLabels(changed);
      parametersDirty = true;
      scheduleRender();
    });
  });
}

async function boot(): Promise<void> {
  bindControls();
  updateControlLabels();
  setStatus('pending', 'Requesting a high-performance adapter…');

  const capability = getWebGPUCapability();
  if (!capability.supported) {
    outputCanvas.hidden = true;
    setStatus('fallback', 'WebGPU unavailable — showing the source field.');
    return;
  }

  try {
    setStatus('pending', 'Capturing the page behind the navigation…');
    await capturePageSnapshot();
    renderer = await createProgressiveBlur({
      canvas: outputCanvas,
      source: sourceCanvas,
      mask: maskCanvas,
      radius: Number(radiusControl.value),
      maxSamples: Number(samplesControl.value),
      mode: 'navbar',
      verticalPassFirst: true,
      normalizeEdges: true,
      pixelRatio,
      canvasUploadMode: 'external',
      cacheMask: true,
      gradient: currentGradient(getOutputMetrics()),
    });
    setStatus('ready', 'WebGPU active — scroll to move the source texture.');
    renderNow();
  } catch (error) {
    outputCanvas.hidden = true;
    const message = error instanceof Error ? error.message : String(error);
    setStatus('error', `WebGPU setup failed — ${message}`);
  }
}

window.addEventListener('scroll', () => {
  scheduleRender();
}, { passive: true });
window.addEventListener('resize', handleResize, { passive: true });

void boot();
