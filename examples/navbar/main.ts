import {
  attachProgressiveBlur,
  type DomElementCapture,
  type ProgressiveBlurEffect,
  type ProgressiveBlurEffectStatus,
} from '@webgpu-progressive-blur/dom';
import './style.css';

const fieldCanvas = document.querySelector<HTMLCanvasElement>('#color-field')!;
const fieldContext = fieldCanvas.getContext('2d', { alpha: false });
const nav = document.querySelector<HTMLElement>('#site-nav')!;
const stage = document.querySelector<HTMLElement>('#orb-stage')!;
const orb = document.querySelector<HTMLElement>('#blur-orb')!;
const statusMessage = document.querySelector<HTMLElement>('#gpu-status')!;
const statusDot = document.querySelector<HTMLElement>('#status-dot')!;
const radiusControl = document.querySelector<HTMLInputElement>('#radius-control')!;
const samplesControl = document.querySelector<HTMLInputElement>('#samples-control')!;
const edgeControl = document.querySelector<HTMLInputElement>('#edge-control')!;
const radiusValue = document.querySelector<HTMLOutputElement>('#radius-value')!;
const samplesValue = document.querySelector<HTMLOutputElement>('#samples-value')!;
const centerButton = document.querySelector<HTMLButtonElement>('#center-orb')!;
const frameValue = document.querySelector<HTMLElement>('#frame-value')!;

if (!fieldContext) throw new Error('The color field could not create a 2D context.');
const colorContext: CanvasRenderingContext2D = fieldContext;

const NAV_BLEED_BOTTOM = 54;
const ORB_PADDING = 24;
const BLOB_COLORS = [
  [35, 223, 196],
  [255, 84, 122],
  [255, 181, 71],
  [112, 102, 255],
  [45, 160, 255],
] as const;

let navEffect: ProgressiveBlurEffect | undefined;
let orbEffect: ProgressiveBlurEffect | undefined;
let parameterFrame: number | undefined;
let resizeFrame: number | undefined;
let liveRefreshFrame: number | undefined;
let liveRefreshBusy = false;
let liveRefreshPending = false;
let lastLiveRefreshAt = -Infinity;
let uiStatusKey = '';
let fieldDpr = 1;
let activePointerId: number | undefined;
let pointerOffsetX = 0;
let pointerOffsetY = 0;

function getPixelRatio(): number {
  return Math.min(2, Math.max(1, window.devicePixelRatio || 1));
}

function resizeField(): void {
  fieldDpr = getPixelRatio();
  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  const nextWidth = Math.round(width * fieldDpr);
  const nextHeight = Math.round(height * fieldDpr);
  if (fieldCanvas.width !== nextWidth || fieldCanvas.height !== nextHeight) {
    fieldCanvas.width = nextWidth;
    fieldCanvas.height = nextHeight;
  }
}

function rgba(color: readonly number[], alpha: number): string {
  return `rgba(${color.join(',')},${alpha})`;
}

function drawColorField(timestamp: number): void {
  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  const expectedWidth = Math.round(width * getPixelRatio());
  const expectedHeight = Math.round(height * getPixelRatio());
  if (fieldCanvas.width !== expectedWidth || fieldCanvas.height !== expectedHeight) {
    resizeField();
  }

  const t = timestamp * 0.00035;
  const context = colorContext;
  context.setTransform(fieldDpr, 0, 0, fieldDpr, 0, 0);
  context.globalAlpha = 1;
  context.globalCompositeOperation = 'source-over';

  const base = context.createLinearGradient(0, 0, width, height);
  base.addColorStop(0, '#081923');
  base.addColorStop(0.44, '#16112a');
  base.addColorStop(1, '#160c18');
  context.fillStyle = base;
  context.fillRect(0, 0, width, height);

  context.globalCompositeOperation = 'screen';
  BLOB_COLORS.forEach((color, index) => {
    const phase = index * 1.31;
    const x = width * (0.16 + index * 0.19) + Math.sin(t * (1.1 + index * 0.08) + phase) * width * 0.13;
    const y = height * (0.26 + (index % 3) * 0.29) + Math.cos(t * (0.86 + index * 0.07) + phase) * height * 0.12;
    const radius = Math.max(width, height) * (0.32 + (index % 2) * 0.08);
    const glow = context.createRadialGradient(x, y, 0, x, y, radius);
    glow.addColorStop(0, rgba(color, 0.84));
    glow.addColorStop(0.34, rgba(color, 0.31));
    glow.addColorStop(1, rgba(color, 0));
    context.fillStyle = glow;
    context.fillRect(0, 0, width, height);
  });

  context.globalCompositeOperation = 'lighter';
  context.lineWidth = 1;
  for (let index = 0; index < 5; index += 1) {
    const y = height * (0.08 + index * 0.22) + Math.sin(t * 1.8 + index) * height * 0.06;
    context.beginPath();
    context.moveTo(-40, y);
    context.bezierCurveTo(
      width * 0.28,
      y - height * 0.12,
      width * 0.62,
      y + height * 0.14,
      width + 40,
      y - height * 0.04,
    );
    context.strokeStyle = rgba(BLOB_COLORS[(index + 2) % BLOB_COLORS.length], 0.14);
    context.stroke();
  }

  context.globalCompositeOperation = 'source-over';
  context.globalAlpha = 0.11;
  context.strokeStyle = '#f3ead5';
  for (let x = -height; x < width + height; x += 72) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x + height, height);
    context.stroke();
  }
  context.globalAlpha = 1;

  if (timestamp - lastLiveRefreshAt > 90) {
    lastLiveRefreshAt = timestamp;
    queueLiveRefresh();
  }
  requestAnimationFrame(drawColorField);
}

const captureField: DomElementCapture = ({ rect, output, width, height, signal }) => {
  const context = output.getContext('2d');
  if (!context) throw new Error('The field capture could not create a 2D context.');
  if (signal.aborted) return output;

  const sourceScaleX = fieldCanvas.width / Math.max(1, fieldCanvas.clientWidth || window.innerWidth);
  const sourceScaleY = fieldCanvas.height / Math.max(1, fieldCanvas.clientHeight || window.innerHeight);
  context.clearRect(0, 0, output.width, output.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    fieldCanvas,
    rect.left * sourceScaleX,
    rect.top * sourceScaleY,
    width * sourceScaleX,
    height * sourceScaleY,
    0,
    0,
    output.width,
    output.height,
  );
  return output;
};

const orbMask = document.createElement('canvas');
const orbMaskContext = orbMask.getContext('2d')!;

function prepareOrbMask(): void {
  const rect = orb.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width * getPixelRatio()));
  const height = Math.max(1, Math.round(rect.height * getPixelRatio()));
  if (orbMask.width === width && orbMask.height === height) return;

  orbMask.width = width;
  orbMask.height = height;
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) / 2;
  const gradient = orbMaskContext.createRadialGradient(
    centerX,
    centerY,
    radius * 0.12,
    centerX,
    centerY,
    radius,
  );
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
  gradient.addColorStop(0.34, 'rgba(255, 255, 255, 0.02)');
  gradient.addColorStop(0.58, 'rgba(255, 255, 255, 0.18)');
  gradient.addColorStop(0.8, 'rgba(255, 255, 255, 0.62)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 1)');
  orbMaskContext.clearRect(0, 0, width, height);
  orbMaskContext.fillStyle = gradient;
  orbMaskContext.fillRect(0, 0, width, height);
}

function setStatus(state: 'pending' | 'ready' | 'fallback' | 'error', message: string): void {
  const key = `${state}:${message}`;
  if (key === uiStatusKey) return;
  uiStatusKey = key;
  statusMessage.textContent = message;
  document.documentElement.dataset.gpu = state;
  statusDot.className = `status-dot ${state}`;
}

function handleNavStatus(status: ProgressiveBlurEffectStatus): void {
  if (status.state === 'unsupported') {
    setStatus('fallback', 'Blur unavailable — showing the field as-is.');
  } else if (status.state === 'error') {
    setStatus('error', 'The blur field could not start.');
  } else if (status.state === 'initializing' || (status.state === 'refreshing' && !navEffect)) {
    setStatus('pending', 'Preparing the blur field…');
  } else if (status.state === 'ready') {
    frameValue.textContent = 'active';
    setStatus('ready', 'Ready — drag the orb and scroll around.');
  }
}

function getEffects(): ProgressiveBlurEffect[] {
  return [navEffect, orbEffect].filter(
    (effect): effect is ProgressiveBlurEffect => effect !== undefined && effect.renderer !== undefined,
  );
}

async function refreshEffects(reason: 'manual' | 'resize'): Promise<void> {
  await Promise.all(getEffects().map((effect) => effect.refresh(reason)));
}

function queueLiveRefresh(): void {
  liveRefreshPending = true;
  if (liveRefreshFrame !== undefined || liveRefreshBusy) return;
  liveRefreshFrame = requestAnimationFrame(() => {
    liveRefreshFrame = undefined;
    if (!liveRefreshPending || liveRefreshBusy) return;
    liveRefreshPending = false;
    liveRefreshBusy = true;
    void refreshEffects('manual')
      .catch(() => {
        setStatus('error', 'The blur field could not refresh.');
      })
      .finally(() => {
        liveRefreshBusy = false;
        if (liveRefreshPending) queueLiveRefresh();
      });
  });
}

function updateControlLabels(): void {
  const radius = Number(radiusControl.value);
  const samples = Number(samplesControl.value);
  radiusValue.value = `${radius.toFixed(1).replace('.0', '')} px`;
  samplesValue.value = `${samples}`;
}

function applyParameters(): void {
  parameterFrame = undefined;
  const parameters = {
    radius: Number(radiusControl.value),
    maxSamples: Number(samplesControl.value),
    verticalPassFirst: true,
    normalizeEdges: edgeControl.checked,
  };
  getEffects().forEach((effect) => {
    effect.setParameters(parameters);
    effect.render();
  });
  frameValue.textContent = 'active';
}

function scheduleParameterUpdate(): void {
  if (parameterFrame !== undefined) return;
  parameterFrame = requestAnimationFrame(applyParameters);
}

function clampOrbPosition(left: number, top: number): void {
  const stageRect = stage.getBoundingClientRect();
  const orbRect = orb.getBoundingClientRect();
  const maxLeft = Math.max(ORB_PADDING, stageRect.width - orbRect.width - ORB_PADDING);
  const maxTop = Math.max(ORB_PADDING, stageRect.height - orbRect.height - ORB_PADDING);
  orb.style.left = `${Math.min(maxLeft, Math.max(ORB_PADDING, left))}px`;
  orb.style.top = `${Math.min(maxTop, Math.max(ORB_PADDING, top))}px`;
}

function centerOrb(): void {
  orb.style.transform = 'none';
  const stageRect = stage.getBoundingClientRect();
  const orbRect = orb.getBoundingClientRect();
  const horizontalBias = window.innerWidth <= 860 ? 0.5 : 0.3;
  clampOrbPosition(
    (stageRect.width - orbRect.width) * horizontalBias,
    (stageRect.height - orbRect.height) * 0.43,
  );
  prepareOrbMask();
  orbEffect?.invalidateMask();
  queueLiveRefresh();
}

function moveOrb(clientX: number, clientY: number): void {
  const stageRect = stage.getBoundingClientRect();
  clampOrbPosition(
    clientX - stageRect.left - pointerOffsetX,
    clientY - stageRect.top - pointerOffsetY,
  );
  queueLiveRefresh();
}

function handlePointerDown(event: PointerEvent): void {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  const rect = orb.getBoundingClientRect();
  activePointerId = event.pointerId;
  pointerOffsetX = event.clientX - rect.left;
  pointerOffsetY = event.clientY - rect.top;
  orb.setPointerCapture(event.pointerId);
  orb.classList.add('is-dragging');
  event.preventDefault();
}

function handlePointerMove(event: PointerEvent): void {
  if (event.pointerId !== activePointerId) return;
  moveOrb(event.clientX, event.clientY);
  event.preventDefault();
}

function endPointerDrag(event: PointerEvent): void {
  if (event.pointerId !== activePointerId) return;
  activePointerId = undefined;
  orb.classList.remove('is-dragging');
  if (orb.hasPointerCapture(event.pointerId)) orb.releasePointerCapture(event.pointerId);
  queueLiveRefresh();
}

function handleOrbKeydown(event: KeyboardEvent): void {
  const step = event.shiftKey ? 48 : 18;
  const rect = orb.getBoundingClientRect();
  const stageRect = stage.getBoundingClientRect();
  let left = rect.left - stageRect.left;
  let top = rect.top - stageRect.top;
  if (event.key === 'ArrowLeft') left -= step;
  else if (event.key === 'ArrowRight') left += step;
  else if (event.key === 'ArrowUp') top -= step;
  else if (event.key === 'ArrowDown') top += step;
  else return;
  event.preventDefault();
  orb.style.transform = 'none';
  clampOrbPosition(left, top);
  queueLiveRefresh();
}

function handleResize(): void {
  if (resizeFrame !== undefined) return;
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = undefined;
    resizeField();
    const stageRect = stage.getBoundingClientRect();
    const orbRect = orb.getBoundingClientRect();
    orb.style.transform = 'none';
    clampOrbPosition(orbRect.left - stageRect.left, orbRect.top - stageRect.top);
    prepareOrbMask();
    orbEffect?.invalidateMask();
    void refreshEffects('resize').catch(() => {
      setStatus('error', 'The blur field could not resize.');
    });
  });
}

function bindControls(): void {
  [radiusControl, samplesControl, edgeControl].forEach((control) => {
    control.addEventListener('input', () => {
      updateControlLabels();
      scheduleParameterUpdate();
    });
    control.addEventListener('change', () => {
      updateControlLabels();
      scheduleParameterUpdate();
    });
  });
  centerButton.addEventListener('click', centerOrb);
  orb.addEventListener('pointerdown', handlePointerDown);
  orb.addEventListener('pointermove', handlePointerMove);
  orb.addEventListener('pointerup', endPointerDrag);
  orb.addEventListener('pointercancel', endPointerDrag);
  orb.addEventListener('keydown', handleOrbKeydown);
  window.addEventListener('resize', handleResize, { passive: true });
}

async function boot(): Promise<void> {
  resizeField();
  centerOrb();
  updateControlLabels();
  bindControls();
  setStatus('pending', 'Preparing the blur field…');

  const sharedOptions = {
    captureRoot: document.body,
    capture: captureField,
    canvasUploadMode: 'external' as const,
    cacheMask: true,
    observeResize: false,
    observeTheme: false,
  };

  try {
    const [nextNavEffect, nextOrbEffect] = await Promise.all([
      attachProgressiveBlur(nav, {
        ...sharedOptions,
        profile: { type: 'linear', start: 0, end: 1, direction: 'top-to-bottom' },
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
      attachProgressiveBlur(orb, {
        ...sharedOptions,
        profile: { type: 'mask', source: orbMask },
        radius: Number(radiusControl.value),
        maxSamples: Number(samplesControl.value),
        verticalPassFirst: true,
        normalizeEdges: edgeControl.checked,
        overlay: { className: 'orb-blur-output' },
      }),
    ]);
    navEffect = nextNavEffect;
    orbEffect = nextOrbEffect;
    setStatus(
      navEffect.status.state === 'unsupported' ? 'fallback' : 'ready',
      navEffect.status.state === 'unsupported'
        ? 'Blur unavailable — showing the field as-is.'
        : 'Ready — drag the orb and scroll around.',
    );
    queueLiveRefresh();
  } catch {
    setStatus('error', 'The blur field could not start.');
  }
}

requestAnimationFrame(drawColorField);
void boot();
