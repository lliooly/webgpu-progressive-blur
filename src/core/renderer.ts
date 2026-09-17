import {
  createBlurBindGroup,
  createBlurPipeline,
  createBlurShaderModule,
  encodeBlurPass,
} from './blur-pass.js';
import {
  BLUR_UNIFORM_BYTE_SIZE,
  MAX_SAMPLES,
  createBlurUniformValues,
} from './blur-params.js';
import {
  ProgressiveBlurError,
  requestWebGPUDevice,
} from './device.js';
import type {
  BlurGradient,
  BlurMode,
  BlurParameters,
  BlurSource,
  BlurStatus,
  CanvasTarget,
  CanvasUploadMode,
  ProgressiveBlurOptions,
  ProgressiveBlurRenderer as ProgressiveBlurRendererContract,
} from './types.js';

const DEFAULT_RADIUS = 16;
const DEFAULT_MAX_SAMPLES = 15;
const DEFAULT_GRADIENT: Required<BlurGradient> = {
  start: 0,
  end: 1,
  direction: 'top-to-bottom',
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeGradient(gradient?: BlurGradient): Required<BlurGradient> {
  const start = clamp(gradient?.start ?? DEFAULT_GRADIENT.start, 0, 1);
  const end = clamp(gradient?.end ?? DEFAULT_GRADIENT.end, 0, 1);
  const safeEnd = Math.abs(end - start) < 0.0001
    ? start >= 1
      ? Math.max(0, start - 0.0001)
      : Math.min(1, start + 0.0001)
    : end;
  return {
    start,
    end: safeEnd,
    direction: gradient?.direction ?? DEFAULT_GRADIENT.direction,
  };
}

function normalizeParameters(options: ProgressiveBlurOptions): BlurParameters {
  const radius = options.radius ?? DEFAULT_RADIUS;
  if (!Number.isFinite(radius) || radius < 0) {
    throw new RangeError('radius must be a finite number greater than or equal to 0.');
  }

  const maxSamples = options.maxSamples ?? DEFAULT_MAX_SAMPLES;
  if (!Number.isFinite(maxSamples) || maxSamples < 1) {
    throw new RangeError('maxSamples must be a finite number greater than 0.');
  }

  return {
    radius,
    maxSamples: Math.min(MAX_SAMPLES, Math.max(1, Math.round(maxSamples))),
    mode: options.mode ?? 'navbar',
    verticalPassFirst: options.verticalPassFirst ?? true,
    normalizeEdges: options.normalizeEdges ?? true,
    gradient: normalizeGradient(options.gradient),
  };
}

function isGPUTexture(source: BlurSource): source is GPUTexture {
  return (
    typeof source === 'object' &&
    source !== null &&
    typeof (source as GPUTexture).createView === 'function' &&
    typeof (source as GPUTexture).destroy === 'function'
  );
}

function isHtmlCanvas(canvas: CanvasTarget): canvas is HTMLCanvasElement {
  return typeof HTMLCanvasElement !== 'undefined' && canvas instanceof HTMLCanvasElement;
}

function readCssDimension(canvas: CanvasTarget, axis: 'width' | 'height'): number {
  if (isHtmlCanvas(canvas)) {
    const cssValue = axis === 'width' ? canvas.clientWidth : canvas.clientHeight;
    if (cssValue > 0) return cssValue;
  }
  return axis === 'width' ? canvas.width : canvas.height;
}

function getDefaultPixelRatio(): number {
  return typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
}

function getPreferredFormat(fallback?: GPUTextureFormat): GPUTextureFormat {
  if (fallback) return fallback;
  if (typeof navigator !== 'undefined' && navigator.gpu) {
    return navigator.gpu.getPreferredCanvasFormat();
  }
  return 'bgra8unorm';
}

function getCanvasContext(canvas: CanvasTarget): GPUCanvasContext {
  const context = canvas.getContext('webgpu') as GPUCanvasContext | null;
  if (!context) {
    throw new ProgressiveBlurError(
      'invalid-canvas',
      'The target canvas could not create a WebGPU context.',
    );
  }
  return context;
}

type Canvas2DSource = {
  getContext: (contextId: '2d') => CanvasRenderingContext2D | null;
};

type BindGroupCache = {
  sourceTexture: GPUTexture;
  maskTexture: GPUTexture;
  bindGroup: GPUBindGroup;
};

function getCanvas2DSource(source: BlurSource): Canvas2DSource | undefined {
  if (typeof source !== 'object' || source === null) return undefined;
  const candidate = source as Partial<Canvas2DSource>;
  return typeof candidate.getContext === 'function' ? candidate as Canvas2DSource : undefined;
}

export class ProgressiveBlurRenderer implements ProgressiveBlurRendererContract {
  readonly canvas: CanvasTarget;

  private readonly device: GPUDevice;
  private readonly context: GPUCanvasContext;
  private readonly outputFormat: GPUTextureFormat;
  private readonly sampler: GPUSampler;
  private readonly maskSampler: GPUSampler;
  private readonly uniformBuffers: [GPUBuffer, GPUBuffer];
  private readonly intermediatePipeline: GPURenderPipeline;
  private readonly outputPipeline: GPURenderPipeline;
  private readonly adapter?: GPUAdapter;
  private readonly canvasUploadMode: CanvasUploadMode;
  private readonly cacheMask: boolean;

  private intermediateTexture: GPUTexture | undefined;
  private sourceUploadTexture: GPUTexture | undefined;
  private maskUploadTexture: GPUTexture | undefined;
  private defaultMaskTexture: GPUTexture | undefined;
  private source: BlurSource | undefined;
  private mask: BlurSource | undefined;
  private _width = 1;
  private _height = 1;
  private _pixelRatio = 1;
  private _status: BlurStatus = { supported: true, state: 'ready' };
  private _parameters: BlurParameters;
  private maskUploadDirty = true;
  private maskUploadSource: BlurSource | undefined;
  private intermediateBindGroup: BindGroupCache | undefined;
  private outputBindGroup: BindGroupCache | undefined;

  private constructor(
    canvas: CanvasTarget,
    device: GPUDevice,
    context: GPUCanvasContext,
    outputFormat: GPUTextureFormat,
    adapter: GPUAdapter | undefined,
    options: ProgressiveBlurOptions,
  ) {
    this.canvas = canvas;
    this.device = device;
    this.context = context;
    this.outputFormat = outputFormat;
    this.adapter = adapter;
    this.canvasUploadMode = options.canvasUploadMode ?? 'readback';
    this.cacheMask = options.cacheMask ?? false;
    this._parameters = normalizeParameters(options);
    this.source = options.source;
    this.mask = options.mask;

    const shaderModule = createBlurShaderModule(device);
    this.intermediatePipeline = createBlurPipeline(device, 'rgba16float', shaderModule);
    this.outputPipeline = createBlurPipeline(device, outputFormat, shaderModule);
    this.sampler = device.createSampler({
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      magFilter: 'linear',
      minFilter: 'linear',
    });
    this.maskSampler = device.createSampler({
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      magFilter: 'linear',
      minFilter: 'linear',
    });
    this.uniformBuffers = [
      device.createBuffer({
        size: BLUR_UNIFORM_BYTE_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
      device.createBuffer({
        size: BLUR_UNIFORM_BYTE_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
    ];

    this.resize(
      readCssDimension(canvas, 'width'),
      readCssDimension(canvas, 'height'),
      options.pixelRatio ?? getDefaultPixelRatio(),
    );

    device.lost.then((info) => {
      if (this._status.state === 'destroyed') return;
      this._status = {
        supported: true,
        state: 'lost',
        message: `WebGPU device lost${info.message ? `: ${info.message}` : '.'}`,
      };
    });
  }

  static async create(options: ProgressiveBlurOptions): Promise<ProgressiveBlurRenderer> {
    const { device, adapter } = await requestWebGPUDevice(options);
    const context = getCanvasContext(options.canvas);
    const outputFormat = getPreferredFormat(options.format);
    context.configure({
      device,
      format: outputFormat,
      alphaMode: 'premultiplied',
    });
    return new ProgressiveBlurRenderer(
      options.canvas,
      device,
      context,
      outputFormat,
      adapter,
      options,
    );
  }

  get status(): BlurStatus {
    return { ...this._status };
  }

  get width(): number {
    return this._width;
  }

  get height(): number {
    return this._height;
  }

  get pixelRatio(): number {
    return this._pixelRatio;
  }

  get parameters(): Readonly<BlurParameters> {
    return {
      ...this._parameters,
      gradient: { ...this._parameters.gradient },
    };
  }

  get gpuDevice(): GPUDevice {
    return this.device;
  }

  get gpuAdapter(): GPUAdapter | undefined {
    return this.adapter;
  }

  setSource(source: BlurSource): void {
    this.ensureUsable();
    this.source = source;
    this.invalidateBindGroups();
  }

  setMask(mask: BlurSource | undefined): void {
    this.ensureUsable();
    this.mask = mask;
    this.maskUploadDirty = true;
    this.maskUploadSource = undefined;
    this.invalidateBindGroups();
  }

  invalidateMask(): void {
    this.ensureUsable();
    this.maskUploadDirty = true;
  }

  setParameters(parameters: Partial<ProgressiveBlurOptions>): void {
    this.ensureUsable();
    const next = normalizeParameters({
      canvas: this.canvas,
      ...this._parameters,
      ...parameters,
      gradient: {
        ...this._parameters.gradient,
        ...parameters.gradient,
      },
    });
    this._parameters = next;
  }

  resize(
    cssWidth = readCssDimension(this.canvas, 'width'),
    cssHeight = readCssDimension(this.canvas, 'height'),
    pixelRatio = this._pixelRatio || getDefaultPixelRatio(),
  ): void {
    this.ensureNotDestroyed();
    const safePixelRatio = clamp(pixelRatio, 0.5, 4);
    const width = Math.max(1, Math.round(cssWidth * safePixelRatio));
    const height = Math.max(1, Math.round(cssHeight * safePixelRatio));

    if (
      this.intermediateTexture &&
      width === this._width &&
      height === this._height &&
      safePixelRatio === this._pixelRatio &&
      this.canvas.width === width &&
      this.canvas.height === height
    ) {
      return;
    }

    this._pixelRatio = safePixelRatio;
    this._width = width;
    this._height = height;
    this.canvas.width = width;
    this.canvas.height = height;
    this.context.configure({
      device: this.device,
      format: this.outputFormat,
      alphaMode: 'premultiplied',
    });

    this.destroyTexture(this.intermediateTexture);
    this.destroyTexture(this.sourceUploadTexture);
    this.destroyTexture(this.maskUploadTexture);
    this.invalidateBindGroups();
    this.maskUploadDirty = true;
    this.maskUploadSource = undefined;
    this.intermediateTexture = this.device.createTexture({
      size: { width, height },
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.sourceUploadTexture = this.device.createTexture({
      size: { width, height },
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.maskUploadTexture = this.device.createTexture({
      size: { width, height },
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  render(): void {
    this.ensureUsable();
    if (!this.source) {
      throw new Error('No blur source has been set. Call setSource() before render().');
    }

    const sourceTexture = this.resolveSourceTexture(this.source);
    const maskTexture =
      this._parameters.mode === 'reference'
        ? this.resolveMaskTexture(this.mask)
        : this.getDefaultMaskTexture();
    const commandEncoder = this.device.createCommandEncoder({ label: 'progressive-blur' });
    const firstAxis = this._parameters.verticalPassFirst ? 1 : 0;
    const secondAxis = this._parameters.verticalPassFirst ? 0 : 1;

    this.renderPass(
      commandEncoder,
      sourceTexture,
      this.intermediateTexture!.createView(),
      this.intermediatePipeline,
      firstAxis,
      maskTexture,
      this.uniformBuffers[0],
      'intermediate',
    );
    this.renderPass(
      commandEncoder,
      this.intermediateTexture!,
      this.context.getCurrentTexture().createView(),
      this.outputPipeline,
      secondAxis,
      maskTexture,
      this.uniformBuffers[1],
      'output',
    );

    this.device.queue.submit([commandEncoder.finish()]);
  }

  destroy(): void {
    if (this._status.state === 'destroyed') return;
    this.destroyTexture(this.intermediateTexture);
    this.destroyTexture(this.sourceUploadTexture);
    this.destroyTexture(this.maskUploadTexture);
    this.destroyTexture(this.defaultMaskTexture);
    this.invalidateBindGroups();
    this.uniformBuffers[0].destroy();
    this.uniformBuffers[1].destroy();
    this._status = { supported: true, state: 'destroyed' };
    this.source = undefined;
    this.mask = undefined;
  }

  private renderPass(
    commandEncoder: GPUCommandEncoder,
    sourceTexture: GPUTexture,
    targetView: GPUTextureView,
    pipeline: GPURenderPipeline,
    axis: number,
    maskTexture: GPUTexture,
    uniformBuffer: GPUBuffer,
    cacheKey: 'intermediate' | 'output',
  ): void {
    const bindGroup = this.getCachedBindGroup(
      cacheKey,
      sourceTexture,
      maskTexture,
      pipeline,
      uniformBuffer,
    );
    encodeBlurPass({
      device: this.device,
      commandEncoder,
      sourceTexture,
      targetView,
      pipeline,
      maskTexture,
      sampler: this.sampler,
      maskSampler: this.maskSampler,
      uniformBuffer,
      uniformValues: createBlurUniformValues({
        width: this._width,
        height: this._height,
        pixelRatio: this._pixelRatio,
        axis,
        parameters: this._parameters,
      }),
      bindGroup,
    });
  }

  private getCachedBindGroup(
    cacheKey: 'intermediate' | 'output',
    sourceTexture: GPUTexture,
    maskTexture: GPUTexture,
    pipeline: GPURenderPipeline,
    uniformBuffer: GPUBuffer,
  ): GPUBindGroup {
    const cached = cacheKey === 'intermediate'
      ? this.intermediateBindGroup
      : this.outputBindGroup;
    if (
      cached?.sourceTexture === sourceTexture &&
      cached.maskTexture === maskTexture
    ) {
      return cached.bindGroup;
    }

    const bindGroup = createBlurBindGroup({
      device: this.device,
      sourceTexture,
      pipeline,
      maskTexture,
      sampler: this.sampler,
      maskSampler: this.maskSampler,
      uniformBuffer,
    });
    const next = { sourceTexture, maskTexture, bindGroup };
    if (cacheKey === 'intermediate') {
      this.intermediateBindGroup = next;
    } else {
      this.outputBindGroup = next;
    }
    return bindGroup;
  }

  private invalidateBindGroups(): void {
    this.intermediateBindGroup = undefined;
    this.outputBindGroup = undefined;
  }

  private resolveSourceTexture(source: BlurSource): GPUTexture {
    if (isGPUTexture(source)) return source;
    if (!this.sourceUploadTexture) {
      throw new Error('The source upload texture has not been initialized.');
    }
    if (
      this.canvasUploadMode === 'readback' &&
      this.uploadCanvasPixels(source, this.sourceUploadTexture)
    ) {
      return this.sourceUploadTexture;
    }
    this.device.queue.copyExternalImageToTexture(
      { source, flipY: false },
      { texture: this.sourceUploadTexture, premultipliedAlpha: false },
      { width: this._width, height: this._height },
    );
    return this.sourceUploadTexture;
  }

  private resolveMaskTexture(mask: BlurSource | undefined): GPUTexture {
    if (mask && isGPUTexture(mask)) return mask;
    if (!mask) return this.getDefaultMaskTexture();
    if (!this.maskUploadTexture) {
      throw new Error('The mask upload texture has not been initialized.');
    }
    if (
      this.cacheMask &&
      this.maskUploadSource === mask &&
      !this.maskUploadDirty
    ) {
      return this.maskUploadTexture;
    }
    if (
      this.canvasUploadMode === 'readback' &&
      this.uploadCanvasPixels(mask, this.maskUploadTexture)
    ) {
      this.maskUploadSource = mask;
      this.maskUploadDirty = false;
      return this.maskUploadTexture;
    }
    this.device.queue.copyExternalImageToTexture(
      { source: mask, flipY: false },
      { texture: this.maskUploadTexture, premultipliedAlpha: false },
      { width: this._width, height: this._height },
    );
    this.maskUploadSource = mask;
    this.maskUploadDirty = false;
    return this.maskUploadTexture;
  }

  private uploadCanvasPixels(source: BlurSource, texture: GPUTexture): boolean {
    const canvasSource = getCanvas2DSource(source);
    if (!canvasSource) return false;
    const context = canvasSource.getContext('2d');
    if (!context) return false;

    // Canvas-to-texture copies can lose the source alpha in Chrome. Reading a
    // 2D canvas keeps opaque DOM snapshots opaque when the legacy readback
    // mode is selected; external mode intentionally uses the zero-copy path.
    const imageData = context.getImageData(0, 0, this._width, this._height).data;
    const rowBytes = this._width * 4;
    const bytesPerRow = Math.ceil(rowBytes / 256) * 256;
    const upload = new Uint8Array(bytesPerRow * this._height);
    if (bytesPerRow === rowBytes) {
      upload.set(imageData);
    } else {
      for (let row = 0; row < this._height; row += 1) {
        upload.set(imageData.subarray(row * rowBytes, (row + 1) * rowBytes), row * bytesPerRow);
      }
    }
    this.device.queue.writeTexture(
      { texture },
      upload,
      { bytesPerRow, rowsPerImage: this._height },
      { width: this._width, height: this._height },
    );
    return true;
  }

  private getDefaultMaskTexture(): GPUTexture {
    if (this.defaultMaskTexture) return this.defaultMaskTexture;
    this.defaultMaskTexture = this.device.createTexture({
      size: { width: 1, height: 1 },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.device.queue.writeTexture(
      { texture: this.defaultMaskTexture },
      new Uint8Array([255, 255, 255, 255]),
      { bytesPerRow: 4 },
      { width: 1, height: 1 },
    );
    return this.defaultMaskTexture;
  }

  private destroyTexture(texture: GPUTexture | undefined): void {
    texture?.destroy();
  }

  private ensureNotDestroyed(): void {
    if (this._status.state === 'destroyed') {
      throw new Error('The progressive blur renderer has been destroyed.');
    }
  }

  private ensureUsable(): void {
    this.ensureNotDestroyed();
    if (this._status.state === 'lost') {
      throw new Error(this._status.message ?? 'The WebGPU device has been lost.');
    }
  }
}

export async function createProgressiveBlur(
  options: ProgressiveBlurOptions,
): Promise<ProgressiveBlurRenderer> {
  return ProgressiveBlurRenderer.create(options);
}
