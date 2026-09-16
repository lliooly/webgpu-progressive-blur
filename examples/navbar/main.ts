import {
  createProgressiveBlur,
  getWebGPUCapability,
  type BlurMode,
  type ProgressiveBlurRenderer,
} from '@webgpu-progressive-blur';
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
const sceneCanvas = document.createElement('canvas');
const maskCanvas = document.createElement('canvas');
const sourceContext = sourceCanvas.getContext('2d', { alpha: false })!;
const sceneContext = sceneCanvas.getContext('2d', { alpha: false })!;
const maskContext = maskCanvas.getContext('2d')!;

let renderer: ProgressiveBlurRenderer | undefined;
let pixelRatio = Math.min(2, window.devicePixelRatio || 1);
let sceneHeight = 0;
let renderFrame: number | undefined;
let resizeFrame: number | undefined;
let lastRenderAt = 0;

function setStatus(state: 'pending' | 'ready' | 'fallback' | 'error', message: string): void {
  statusMessage.textContent = message;
  document.documentElement.dataset.gpu = state;
  statusDot.className = `status-dot ${state}`;
}

function currentGradient(): { start: number; end: number; direction: 'top-to-bottom' } {
  return {
    start: Number(startControl.value),
    end: Math.max(Number(endControl.value), Number(startControl.value) + 0.01),
    direction: 'top-to-bottom',
  };
}

function drawScene(): void {
  const width = Math.max(1, Math.round(window.innerWidth * pixelRatio));
  sceneHeight = Math.max(
    2600,
    Math.round(Math.max(document.documentElement.scrollHeight, window.innerHeight * 3.5) * pixelRatio),
  );
  sceneCanvas.width = width;
  sceneCanvas.height = sceneHeight;

  const ctx = sceneContext;
  ctx.fillStyle = '#0d1119';
  ctx.fillRect(0, 0, width, sceneHeight);

  const background = ctx.createLinearGradient(0, 0, width, sceneHeight);
  background.addColorStop(0, '#142536');
  background.addColorStop(0.35, '#101923');
  background.addColorStop(0.7, '#28191c');
  background.addColorStop(1, '#111217');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, sceneHeight);

  for (let y = 0; y < sceneHeight; y += Math.round(36 * pixelRatio)) {
    ctx.strokeStyle = y % Math.round(144 * pixelRatio) === 0 ? 'rgba(233, 226, 208, 0.18)' : 'rgba(233, 226, 208, 0.07)';
    ctx.lineWidth = Math.max(1, pixelRatio);
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(width, y + 0.5);
    ctx.stroke();
  }

  const blobs = [
    { x: 0.76, y: 0.12, r: 0.25, color: '#d8a44e' },
    { x: 0.18, y: 0.35, r: 0.22, color: '#c94d3d' },
    { x: 0.82, y: 0.57, r: 0.32, color: '#2d6c74' },
    { x: 0.12, y: 0.8, r: 0.27, color: '#c8c2a6' },
  ];
  for (const blob of blobs) {
    const gradient = ctx.createRadialGradient(
      width * blob.x,
      sceneHeight * blob.y,
      0,
      width * blob.x,
      sceneHeight * blob.y,
      width * blob.r,
    );
    gradient.addColorStop(0, `${blob.color}cc`);
    gradient.addColorStop(1, `${blob.color}00`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, sceneHeight);
  }

  ctx.save();
  ctx.globalAlpha = 0.86;
  ctx.fillStyle = '#f0eadb';
  ctx.font = `700 ${Math.round(Math.max(74, width * 0.13))}px Baskerville, Georgia, serif`;
  ctx.letterSpacing = `${Math.round(2 * pixelRatio)}px`;
  const words = ['STAY', 'WITH', 'THE', 'SIGNAL', 'MOVE', 'SLOWLY'];
  words.forEach((word, index) => {
    const x = index % 2 === 0 ? width * 0.08 : width * 0.32;
    const y = sceneHeight * (0.1 + index * 0.145);
    ctx.fillText(word, x, y);
  });
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = 'rgba(240, 234, 219, 0.72)';
  ctx.lineWidth = Math.max(1, pixelRatio);
  for (let index = 0; index < 18; index += 1) {
    const x = width * (0.08 + (index % 6) * 0.16);
    const y = sceneHeight * (0.16 + Math.floor(index / 6) * 0.28);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + width * 0.1, y + sceneHeight * 0.12);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSourceSlice(): void {
  const navHeight = Math.max(1, nav.getBoundingClientRect().height);
  const width = Math.max(1, Math.round(window.innerWidth * pixelRatio));
  const height = Math.max(1, Math.round(navHeight * pixelRatio));
  if (sourceCanvas.width !== width || sourceCanvas.height !== height) {
    sourceCanvas.width = width;
    sourceCanvas.height = height;
  }

  const sourceY = Math.max(0, Math.min(sceneHeight - height, Math.round(window.scrollY * pixelRatio)));
  sourceContext.clearRect(0, 0, width, height);
  sourceContext.drawImage(sceneCanvas, 0, sourceY, width, height, 0, 0, width, height);

  maskCanvas.width = width;
  maskCanvas.height = height;
  const gradient = maskContext.createLinearGradient(0, height * Number(startControl.value), 0, height * Number(endControl.value));
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
    drawScene();
    drawSourceSlice();
    renderer?.resize(window.innerWidth, nav.getBoundingClientRect().height, pixelRatio);
    scheduleRender();
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
  drawScene();
  drawSourceSlice();
  setStatus('pending', 'Requesting a high-performance adapter…');

  const capability = getWebGPUCapability();
  if (!capability.supported) {
    outputCanvas.hidden = true;
    setStatus('fallback', 'WebGPU unavailable — showing the source field.');
    return;
  }

  try {
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
