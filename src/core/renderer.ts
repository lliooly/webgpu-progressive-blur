import { variableBlurWgsl } from '../shaders/variable-blur.wgsl';
import {
  ProgressiveBlurError,
  requestWebGPUDevice,
} from './device';
import type {
  BlurGradient,
  BlurMode,
  BlurParameters,
  BlurSource,
  BlurStatus,
  CanvasTarget,
  ProgressiveBlurOptions,
  ProgressiveBlurRenderer as ProgressiveBlurRendererContract,
} from './types';

const MAX_SAMPLES = 64;
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
  return {
    start,
    end: Math.abs(end - start) < 0.0001 ? Math.min(1, start + 0.0001) : end,
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

export class ProgressiveBlurRenderer implements ProgressiveBlurRendererContract {
  readonly canvas: CanvasTarget;

  private readonly device: GPUDevice;
  private readonly context: GPUCanvasContext;
  private readonly outputFormat: GPUTextureFormat;
  private readonly sampler: GPUSampler;
  private readonly maskSampler: GPUSampler;
  private readonly uniformBuffer: GPUBuffer;
  private readonly intermediatePipeline: GPURenderPipeline;
  private readonly outputPipeline: GPURenderPipeline;
  private readonly adapter?: GPUAdapter;

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
    this._parameters = normalizeParameters(options);

    const shaderModule = device.createShaderModule({ code: variableBlurWgsl });
    this.intermediatePipeline = this.createPipeline(shaderModule, 'rgba16float');
    this.outputPipeline = this.createPipeline(shaderModule, outputFormat);
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
    this.uniformBuffer = device.createBuffer({
      size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

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
  }

  setMask(mask: BlurSource | undefined): void {
    this.ensureUsable();
    this.mask = mask;
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
    this.intermediateTexture = this.device.createTexture({
      size: { width, height },
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.sourceUploadTexture = this.device.createTexture({
      size: { width, height },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.maskUploadTexture = this.device.createTexture({
      size: { width, height },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
    });
  }

  render(): void {
    this.ensureUsable();
    if (!this.source) {
      throw new Error('No blur source has been set. Call setSource() before render().');
    }

    const sourceTexture = this.resolveSourceTexture(this.source);
    const maskTexture = this.resolveMaskTexture(this.mask);
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
    );
    this.renderPass(
      commandEncoder,
      this.intermediateTexture!,
      this.context.getCurrentTexture().createView(),
      this.outputPipeline,
      secondAxis,
      maskTexture,
    );

    this.device.queue.submit([commandEncoder.finish()]);
  }

  destroy(): void {
    if (this._status.state === 'destroyed') return;
    this.destroyTexture(this.intermediateTexture);
    this.destroyTexture(this.sourceUploadTexture);
    this.destroyTexture(this.maskUploadTexture);
    this.destroyTexture(this.defaultMaskTexture);
    this.uniformBuffer.destroy();
    this._status = { supported: true, state: 'destroyed' };
    this.source = undefined;
    this.mask = undefined;
  }

  private createPipeline(shaderModule: GPUShaderModule, format: GPUTextureFormat): GPURenderPipeline {
    return this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: shaderModule,
        entryPoint: 'vertexMain',
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fragmentMain',
        targets: [{ format }],
      },
      primitive: { topology: 'triangle-list' },
    });
  }

  private renderPass(
    commandEncoder: GPUCommandEncoder,
    sourceTexture: GPUTexture,
    targetView: GPUTextureView,
    pipeline: GPURenderPipeline,
    axis: number,
    maskTexture: GPUTexture,
  ): void {
    const values = new Float32Array([
      this._width,
      this._height,
      1 / this._width,
      1 / this._height,
      this._parameters.radius * 3 * this._pixelRatio,
      this._parameters.maxSamples,
      axis,
      this._parameters.mode === 'navbar' ? 1 : 0,
      this._parameters.gradient.start,
      this._parameters.gradient.end,
      this._parameters.gradient.direction === 'bottom-to-top' ? 1 : 0,
      this._parameters.normalizeEdges ? 1 : 0,
    ]);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, values);

    const bindGroup = this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: sourceTexture.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: this.uniformBuffer } },
        { binding: 3, resource: maskTexture.createView() },
        { binding: 4, resource: this.maskSampler },
      ],
    });

    const pass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: targetView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
  }

  private resolveSourceTexture(source: BlurSource): GPUTexture {
    if (isGPUTexture(source)) return source;
    if (!this.sourceUploadTexture) {
      throw new Error('The source upload texture has not been initialized.');
    }
    this.device.queue.copyExternalImageToTexture(
      { source },
      { texture: this.sourceUploadTexture },
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
    this.device.queue.copyExternalImageToTexture(
      { source: mask },
      { texture: this.maskUploadTexture },
      { width: this._width, height: this._height },
    );
    return this.maskUploadTexture;
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
