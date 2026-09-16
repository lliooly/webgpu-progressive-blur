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

let renderer: ProgressiveBlurRenderer | undefined;
let pixelRatio = Math.min(2, window.devicePixelRatio || 1);
let pageSnapshot: HTMLCanvasElement | undefined;
let renderFrame: number | undefined;
let resizeFrame: number | undefined;
let lastRenderAt = 0;

function setStatus(state: 'pending' | 'ready' | 'fallback' | 'error', message: string): void {
  statusMessage.textContent = message;
  document.documentElement.dataset.gpu = state;
  statusDot.className = `status-dot ${state}`;
}

function currentGradient(): { start: number; end: number; direction: 'top-to-bottom' } {
  const navHeight = Math.max(1, nav.getBoundingClientRect().height);
  const outputHeight = Math.max(1, outputCanvas.getBoundingClientRect().height);
  const visibleRatio = Math.min(1, navHeight / outputHeight);
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

function drawSourceSlice(): void {
  const navHeight = Math.max(1, nav.getBoundingClientRect().height);
  const width = Math.max(1, Math.round(window.innerWidth * pixelRatio));
  const outputHeight = Math.max(1, outputCanvas.getBoundingClientRect().height);
  const height = Math.max(1, Math.round(outputHeight * pixelRatio));
  if (sourceCanvas.width !== width || sourceCanvas.height !== height) {
    sourceCanvas.width = width;
    sourceCanvas.height = height;
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

  maskCanvas.width = width;
  maskCanvas.height = height;
  const visibleRatio = Math.min(1, navHeight / outputHeight);
  const gradientStart = Number(startControl.value) * visibleRatio;
  const gradientEnd = Math.max(Number(endControl.value), Number(startControl.value) + 0.01) * visibleRatio;
  const gradient = maskContext.createLinearGradient(0, height * gradientStart, 0, height * gradientEnd);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  maskContext.fillStyle = gradient;
  maskContext.fillRect(0, 0, width, height);
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

function renderNow(): void {
  if (!renderer) return;
  const startedAt = performance.now();
  drawSourceSlice();
  renderer.setParameters({
    mode: modeControl.value as BlurMode,
    radius: Number(radiusControl.value),
    maxSamples: Number(samplesControl.value),
    verticalPassFirst: orderControl.checked,
    normalizeEdges: edgeControl.checked,
    gradient: currentGradient(),
  });
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
    renderer?.resize(window.innerWidth, outputCanvas.getBoundingClientRect().height, pixelRatio);
    void capturePageSnapshot()
      .then(() => {
        drawSourceSlice();
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
      scheduleRender();
    });
    control.addEventListener('change', () => {
      const changed = control === startControl ? 'start' : control === endControl ? 'end' : undefined;
      updateControlLabels(changed);
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
    drawSourceSlice();
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
      gradient: currentGradient(),
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
  drawSourceSlice();
  scheduleRender();
}, { passive: true });
window.addEventListener('resize', handleResize, { passive: true });

void boot();
