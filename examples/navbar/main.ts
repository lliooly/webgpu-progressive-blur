import {
  attachProgressiveBlur,
  type BlurProfile,
  type ProgressiveBlurEffect,
  type ProgressiveBlurEffectStatus,
} from '@webgpu-progressive-blur/dom';
import './style.css';

const nav = document.querySelector<HTMLElement>('#site-nav')!;
const signalCards = [...document.querySelectorAll<HTMLElement>('[data-demo-blur]')];
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

const maskCanvas = document.createElement('canvas');
const maskContext = maskCanvas.getContext('2d')!;
const NAV_BLEED_BOTTOM = 48;

let navEffect: ProgressiveBlurEffect | undefined;
let cardEffects: ProgressiveBlurEffect[] = [];
let renderFrame: number | undefined;
let lastRenderAt = 0;
let parametersDirty = true;
let maskKey = '';

function setStatus(state: 'pending' | 'ready' | 'fallback' | 'error', message: string): void {
  statusMessage.textContent = message;
  document.documentElement.dataset.gpu = state;
  statusDot.className = `status-dot ${state}`;
}

function handleNavStatus(status: ProgressiveBlurEffectStatus): void {
  if (status.state === 'unsupported') {
    setStatus('fallback', `WebGPU unavailable — showing the source field. ${status.reason ?? ''}`.trim());
  } else if (status.state === 'error') {
    setStatus('error', `Blur setup failed — ${status.reason ?? 'unknown error'}`);
  } else if (status.state === 'refreshing' || status.state === 'initializing') {
    setStatus('pending', 'Capturing the page behind the blur fields…');
  } else if (status.state === 'ready') {
    setStatus('ready', 'WebGPU active — scroll to move every blur field.');
  }
}

function getPixelRatio(): number {
  return Math.min(4, Math.max(0.5, window.devicePixelRatio || 1));
}

function getNavOutputMetrics(): {
  cssWidth: number;
  cssHeight: number;
  navHeight: number;
} {
  const rect = nav.getBoundingClientRect();
  const navHeight = Math.max(1, rect.height);
  return {
    cssWidth: Math.max(1, rect.width || window.innerWidth),
    cssHeight: navHeight + NAV_BLEED_BOTTOM,
    navHeight,
  };
}

function prepareMask(): HTMLCanvasElement {
  const metrics = getNavOutputMetrics();
  const pixelRatio = getPixelRatio();
  const width = Math.max(1, Math.round(metrics.cssWidth * pixelRatio));
  const height = Math.max(1, Math.round(metrics.cssHeight * pixelRatio));
  const start = Number(startControl.value);
  const end = Math.max(Number(endControl.value), start + 0.01);
  const visibleRatio = Math.min(1, metrics.navHeight / metrics.cssHeight);
  const gradientStart = start * visibleRatio;
  const gradientEnd = end * visibleRatio;
  const nextKey = [width, height, gradientStart, gradientEnd].join(':');

  if (maskKey === nextKey && maskCanvas.width === width && maskCanvas.height === height) {
    return maskCanvas;
  }

  maskCanvas.width = width;
  maskCanvas.height = height;
  const gradient = maskContext.createLinearGradient(
    0,
    height * gradientStart,
    0,
    height * gradientEnd,
  );
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  maskContext.fillStyle = gradient;
  maskContext.fillRect(0, 0, width, height);
  maskKey = nextKey;
  return maskCanvas;
}

function getCurrentProfile(): BlurProfile {
  const metrics = getNavOutputMetrics();
  const start = Number(startControl.value);
  const end = Math.max(Number(endControl.value), start + 0.01);
  const visibleRatio = Math.min(1, metrics.navHeight / metrics.cssHeight);

  if (modeControl.value === 'navbar') {
    return {
      type: 'linear',
      start: start * visibleRatio,
      end: end * visibleRatio,
      direction: 'top-to-bottom',
    };
  }
  return { type: 'mask', source: prepareMask() };
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

function applyNavParameters(): void {
  if (!navEffect?.renderer) return;
  if (modeControl.value === 'reference') prepareMask();
  navEffect.setParameters({
    profile: getCurrentProfile(),
    radius: Number(radiusControl.value),
    maxSamples: Number(samplesControl.value),
    verticalPassFirst: orderControl.checked,
    normalizeEdges: edgeControl.checked,
  });
  if (modeControl.value === 'reference') navEffect.invalidateMask();
  parametersDirty = false;
}

function renderNow(): void {
  if (!navEffect?.renderer) return;
  const startedAt = performance.now();
  if (parametersDirty) applyNavParameters();
  navEffect.render();
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
  maskKey = '';
  parametersDirty = true;
  if (modeControl.value === 'reference') {
    prepareMask();
    navEffect?.invalidateMask();
  }
  const effects = [navEffect, ...cardEffects].filter(
    (effect): effect is ProgressiveBlurEffect => effect !== undefined,
  );
  void Promise.all(effects.map((effect) => effect.refresh('resize')))
    .then(() => {
      scheduleRender();
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      setStatus('error', `Resize refresh failed — ${message}`);
    });
}

function bindControls(): void {
  [modeControl, radiusControl, samplesControl, startControl, endControl, orderControl, edgeControl]
    .forEach((control) => {
      const update = (): void => {
        const changed = control === startControl ? 'start' : control === endControl ? 'end' : undefined;
        updateControlLabels(changed);
        parametersDirty = true;
        scheduleRender();
      };
      control.addEventListener('input', update);
      control.addEventListener('change', update);
    });
}

async function boot(): Promise<void> {
  bindControls();
  updateControlLabels();
  setStatus('pending', 'Requesting a high-performance adapter…');
  prepareMask();

  try {
    const sharedOptions = {
      captureRoot: document.body,
      captureStrategy: 'document' as const,
      canvasUploadMode: 'external' as const,
      cacheMask: true,
    };
    const effects = await Promise.all([
      attachProgressiveBlur(nav, {
        ...sharedOptions,
        profile: getCurrentProfile(),
        radius: Number(radiusControl.value),
        maxSamples: Number(samplesControl.value),
        verticalPassFirst: true,
        normalizeEdges: true,
        overlay: {
          className: 'blur-output',
          bleed: { bottom: NAV_BLEED_BOTTOM },
        },
        onStatus: handleNavStatus,
      }),
      ...signalCards.map((element) =>
        attachProgressiveBlur(element, {
          ...sharedOptions,
          profile: element.dataset.demoBlur === 'linear'
            ? { type: 'linear', start: 0.05, end: 0.9, direction: 'bottom-to-top' }
            : 'uniform',
          radius: element.dataset.demoBlur === 'linear' ? 12 : 10,
          maxSamples: 12,
          overlay: { className: 'progressive-blur-card-overlay' },
        })),
    ]);
    navEffect = effects[0];
    cardEffects = effects.slice(1);
    setStatus(
      navEffect.status.state === 'unsupported' ? 'fallback' : 'ready',
      navEffect.status.state === 'unsupported'
        ? 'WebGPU unavailable — showing the source field.'
        : 'WebGPU active — scroll to move every blur field.',
    );
    renderNow();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus('error', `Blur setup failed — ${message}`);
  }
}

window.addEventListener('resize', handleResize, { passive: true });

void boot();
