import { createBlurPipeline, createBlurShaderModule, encodeBlurPass } from '../../src/core/blur-pass';
import { createBlurUniformValues } from '../../src/core/blur-params';
import { createProgressiveBlur } from '../../src/core/renderer';
import {
  createGradientMask,
  progressiveBlurReference,
} from '../../src/core/reference';
import type { BlurParameters } from '../../src/core/types';

interface GpuCase {
  name: string;
  width: number;
  height: number;
  radius: number;
  maxSamples: number;
  mode: 'reference' | 'navbar';
  maskKind: 'zero' | 'one' | 'binary' | 'gradient';
  gradient?: { start?: number; end?: number; direction?: 'top-to-bottom' | 'bottom-to-top' };
  verticalPassFirst: boolean;
  normalizeEdges: boolean;
}

interface GpuCaseResult {
  name: string;
  width: number;
  height: number;
  maxAbsoluteError: number;
  meanAbsoluteError: number;
  finite: boolean;
  passed: boolean;
}

export interface GpuValidationReport {
  status: 'passed' | 'failed' | 'unsupported';
  cases: GpuCaseResult[];
  message?: string;
}

const MAX_ABSOLUTE_ERROR = 0.003;
const MAX_MEAN_ABSOLUTE_ERROR = 0.00075;

function makeSource(width: number, height: number): Float32Array {
  const source = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const horizontal = x / Math.max(1, width - 1);
      const vertical = y / Math.max(1, height - 1);
      source[offset] = horizontal;
      source[offset + 1] = vertical;
      source[offset + 2] = (x * 3 + y * 5) % 11 / 10;
      source[offset + 3] = 1;
    }
  }

  const impulseX = Math.floor(width / 2);
  const impulseY = Math.floor(height / 2);
  const impulseOffset = (impulseY * width + impulseX) * 4;
  source[impulseOffset] = 1;
  source[impulseOffset + 1] = 0;
  source[impulseOffset + 2] = 0;
  return source;
}

function quantizeSource(source: Float32Array): Float32Array {
  const quantized = new Float32Array(source.length);
  for (let index = 0; index < source.length; index += 1) {
    quantized[index] = Math.round(Math.min(1, Math.max(0, source[index])) * 255) / 255;
  }
  return quantized;
}

function makeMask(width: number, height: number, kind: GpuCase['maskKind']): Float32Array {
  if (kind === 'gradient') return createGradientMask(width, height, { start: 0, end: 1 });
  const mask = new Float32Array(width * height);
  if (kind === 'one') mask.fill(1);
  if (kind === 'binary') {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        mask[y * width + x] = (x + y) % 3 === 0 ? 1 : 0;
      }
    }
  }
  return mask;
}

function quantizeMask(mask: Float32Array): Float32Array {
  const quantized = new Float32Array(mask.length);
  for (let index = 0; index < mask.length; index += 1) {
    quantized[index] = Math.round(Math.min(1, Math.max(0, mask[index])) * 255) / 255;
  }
  return quantized;
}

function rgbaBytes(source: Float32Array): Uint8Array {
  const bytes = new Uint8Array(source.length);
  for (let index = 0; index < source.length; index += 1) {
    bytes[index] = Math.round(Math.min(1, Math.max(0, source[index])) * 255);
  }
  return bytes;
}

function alphaMaskBytes(mask: Float32Array): Uint8Array {
  const bytes = new Uint8Array(mask.length * 4);
  for (let index = 0; index < mask.length; index += 1) {
    bytes[index * 4 + 3] = Math.round(Math.min(1, Math.max(0, mask[index])) * 255);
  }
  return bytes;
}

function writeRgba8Texture(
  device: GPUDevice,
  texture: GPUTexture,
  bytes: Uint8Array,
  width: number,
  height: number,
): void {
  const rowBytes = width * 4;
  const bytesPerRow = Math.ceil(rowBytes / 256) * 256;
  const upload = new Uint8Array(bytesPerRow * height);
  for (let row = 0; row < height; row += 1) {
    upload.set(bytes.subarray(row * rowBytes, (row + 1) * rowBytes), row * bytesPerRow);
  }
  device.queue.writeTexture(
    { texture },
    upload,
    { bytesPerRow, rowsPerImage: height },
    { width, height },
  );
}

function decodeHalf(bits: number): number {
  const sign = (bits & 0x8000) === 0 ? 1 : -1;
  const exponent = (bits >>> 10) & 0x1f;
  const fraction = bits & 0x03ff;
  if (exponent === 0) {
    return sign * (fraction / 1024) * 2 ** -14;
  }
  if (exponent === 0x1f) {
    return fraction === 0 ? sign * Infinity : Number.NaN;
  }
  return sign * (1 + fraction / 1024) * 2 ** (exponent - 15);
}

async function readRgba16Texture(
  device: GPUDevice,
  texture: GPUTexture,
  width: number,
  height: number,
): Promise<Float32Array> {
  const bytesPerRow = Math.ceil((width * 8) / 256) * 256;
  const buffer = device.createBuffer({
    size: bytesPerRow * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const commandEncoder = device.createCommandEncoder({ label: 'progressive-blur-readback' });
  commandEncoder.copyTextureToBuffer(
    { texture },
    { buffer, bytesPerRow, rowsPerImage: height },
    { width, height, depthOrArrayLayers: 1 },
  );
  device.queue.submit([commandEncoder.finish()]);
  await device.queue.onSubmittedWorkDone();
  await buffer.mapAsync(GPUMapMode.READ);
  const mapped = new Uint8Array(buffer.getMappedRange());
  const view = new DataView(mapped.buffer, mapped.byteOffset, mapped.byteLength);
  const result = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceOffset = y * bytesPerRow + x * 8;
      const resultOffset = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        result[resultOffset + channel] = decodeHalf(
          view.getUint16(sourceOffset + channel * 2, true),
        );
      }
    }
  }
  buffer.unmap();
  buffer.destroy();
  return result;
}

function makeCases(): GpuCase[] {
  return [
    {
      name: 'subpixel-radius',
      width: 11,
      height: 7,
      radius: 0.2,
      maxSamples: 15,
      mode: 'reference',
      maskKind: 'one',
      verticalPassFirst: true,
      normalizeEdges: true,
    },
    {
      name: 'horizontal-axis-nonsquare',
      width: 7,
      height: 1,
      radius: 2,
      maxSamples: 15,
      mode: 'reference',
      maskKind: 'one',
      verticalPassFirst: true,
      normalizeEdges: true,
    },
    {
      name: 'vertical-axis-nonsquare',
      width: 1,
      height: 7,
      radius: 2,
      maxSamples: 15,
      mode: 'reference',
      maskKind: 'one',
      verticalPassFirst: false,
      normalizeEdges: true,
    },
    {
      name: 'reference-binary-mask',
      width: 11,
      height: 7,
      radius: 3,
      maxSamples: 1,
      mode: 'reference',
      maskKind: 'binary',
      verticalPassFirst: false,
      normalizeEdges: true,
    },
    {
      name: 'reference-gradient-mask',
      width: 11,
      height: 7,
      radius: 4,
      maxSamples: 64,
      mode: 'reference',
      maskKind: 'gradient',
      verticalPassFirst: true,
      normalizeEdges: true,
    },
    {
      name: 'reference-transparent-exterior',
      width: 11,
      height: 7,
      radius: 3,
      maxSamples: 15,
      mode: 'reference',
      maskKind: 'one',
      verticalPassFirst: false,
      normalizeEdges: false,
    },
    {
      name: 'navbar-top-to-bottom',
      width: 11,
      height: 7,
      radius: 4,
      maxSamples: 15,
      mode: 'navbar',
      maskKind: 'zero',
      gradient: { start: 0, end: 1, direction: 'top-to-bottom' },
      verticalPassFirst: true,
      normalizeEdges: true,
    },
    {
      name: 'navbar-bottom-to-top',
      width: 11,
      height: 7,
      radius: 4,
      maxSamples: 15,
      mode: 'navbar',
      maskKind: 'zero',
      gradient: { start: 0, end: 1, direction: 'bottom-to-top' },
      verticalPassFirst: true,
      normalizeEdges: true,
    },
  ];
}

async function runCase(device: GPUDevice, testCase: GpuCase): Promise<GpuCaseResult> {
  const { width, height } = testCase;
  const source = quantizeSource(makeSource(width, height));
  const mask = quantizeMask(makeMask(width, height, testCase.maskKind));
  const parameters: BlurParameters = {
    radius: testCase.radius,
    maxSamples: testCase.maxSamples,
    mode: testCase.mode,
    verticalPassFirst: testCase.verticalPassFirst,
    normalizeEdges: testCase.normalizeEdges,
    gradient: {
      start: testCase.gradient?.start ?? 0,
      end: testCase.gradient?.end ?? 1,
      direction: testCase.gradient?.direction ?? 'top-to-bottom',
    },
  };
  const expected = progressiveBlurReference(source, width, height, {
    radius: testCase.radius,
    maxSamples: testCase.maxSamples,
    mask: testCase.mode === 'reference' ? mask : undefined,
    gradient: testCase.mode === 'navbar' ? parameters.gradient : undefined,
    verticalPassFirst: testCase.verticalPassFirst,
    normalizeEdges: testCase.normalizeEdges,
  });

  const sourceTexture = device.createTexture({
    size: { width, height },
    format: 'rgba8unorm',
    usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
  });
  const maskTexture = device.createTexture({
    size: { width, height },
    format: 'rgba8unorm',
    usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
  });
  const intermediateTexture = device.createTexture({
    size: { width, height },
    format: 'rgba16float',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  const outputTexture = device.createTexture({
    size: { width, height },
    format: 'rgba16float',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  writeRgba8Texture(device, sourceTexture, rgbaBytes(source), width, height);
  writeRgba8Texture(device, maskTexture, alphaMaskBytes(mask), width, height);

  const shaderModule = createBlurShaderModule(device);
  const compilationInfo = await shaderModule.getCompilationInfo();
  const compilationErrors = compilationInfo.messages.filter((message) => message.type === 'error');
  if (compilationErrors.length > 0) {
    throw new Error(
      compilationErrors.map((message) => message.message).join('\n'),
    );
  }
  const pipeline = createBlurPipeline(device, 'rgba16float', shaderModule);
  const sampler = device.createSampler({
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
    magFilter: 'linear',
    minFilter: 'linear',
  });
  const maskSampler = device.createSampler({
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
    magFilter: 'linear',
    minFilter: 'linear',
  });
  const uniformBuffers: [GPUBuffer, GPUBuffer] = [
    device.createBuffer({
      size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    }),
    device.createBuffer({
      size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    }),
  ];
  const commandEncoder = device.createCommandEncoder({ label: `progressive-blur-${testCase.name}` });
  const firstAxis = testCase.verticalPassFirst ? 1 : 0;
  const secondAxis = testCase.verticalPassFirst ? 0 : 1;
  encodeBlurPass({
    device,
    commandEncoder,
    sourceTexture,
    targetView: intermediateTexture.createView(),
    pipeline,
    maskTexture,
    sampler,
    maskSampler,
    uniformBuffer: uniformBuffers[0],
    uniformValues: createBlurUniformValues({
      width,
      height,
      pixelRatio: 1,
      axis: firstAxis,
      parameters,
    }),
  });
  encodeBlurPass({
    device,
    commandEncoder,
    sourceTexture: intermediateTexture,
    targetView: outputTexture.createView(),
    pipeline,
    maskTexture,
    sampler,
    maskSampler,
    uniformBuffer: uniformBuffers[1],
    uniformValues: createBlurUniformValues({
      width,
      height,
      pixelRatio: 1,
      axis: secondAxis,
      parameters,
    }),
  });
  device.queue.submit([commandEncoder.finish()]);
  const actual = await readRgba16Texture(device, outputTexture, width, height);

  let maxAbsoluteError = 0;
  let sumAbsoluteError = 0;
  let finite = true;
  for (let index = 0; index < actual.length; index += 1) {
    if (!Number.isFinite(actual[index])) finite = false;
    const absoluteError = Math.abs(actual[index] - expected[index]);
    maxAbsoluteError = Math.max(maxAbsoluteError, absoluteError);
    sumAbsoluteError += absoluteError;
  }
  const meanAbsoluteError = sumAbsoluteError / actual.length;

  sourceTexture.destroy();
  maskTexture.destroy();
  intermediateTexture.destroy();
  outputTexture.destroy();
  uniformBuffers[0].destroy();
  uniformBuffers[1].destroy();

  return {
    name: testCase.name,
    width,
    height,
    maxAbsoluteError,
    meanAbsoluteError,
    finite,
    passed:
      finite &&
      maxAbsoluteError <= MAX_ABSOLUTE_ERROR &&
      meanAbsoluteError <= MAX_MEAN_ABSOLUTE_ERROR,
  };
}

// Exercise the public renderer as well as the shared pass encoder: two passes
// accidentally sharing one uniform buffer produce a horizontal streak here.
async function runRendererCase(device: GPUDevice, pixelRatio: number): Promise<GpuCaseResult> {
  const cssWidth = 53;
  const cssHeight = 37;
  const width = cssWidth * pixelRatio;
  const height = cssHeight * pixelRatio;
  const source = quantizeSource(makeSource(width, height));
  const sourceCanvas = new OffscreenCanvas(width, height);
  const sourceContext = sourceCanvas.getContext('2d')!;
  const input = sourceContext.createImageData(width, height);
  input.data.set(rgbaBytes(source));
  sourceContext.putImageData(input, 0, 0);
  const outputCanvas = new OffscreenCanvas(cssWidth, cssHeight);
  const renderer = await createProgressiveBlur({
    canvas: outputCanvas,
    source: sourceCanvas,
    device,
    mode: 'navbar',
    radius: 3,
    pixelRatio,
    maxSamples: 15,
    verticalPassFirst: true,
    gradient: { start: 0, end: 1 },
  });
  const readback = new OffscreenCanvas(width, height).getContext('2d')!;
  let maxAbsoluteError = 0;
  let sumAbsoluteError = 0;
  let finite = true;
  // Zero radius checks exact scaling/coordinates; nonzero checks both axes.
  for (const radius of [0, 3]) {
    renderer.setParameters({ radius });
    renderer.render();
    await device.queue.onSubmittedWorkDone();
    readback.drawImage(outputCanvas, 0, 0);
    const actual = readback.getImageData(0, 0, width, height).data;
    const expected = progressiveBlurReference(source, width, height, {
      radius: radius * pixelRatio,
      maxSamples: 15,
      verticalPassFirst: true,
      gradient: { start: 0, end: 1 },
    });
    for (let index = 0; index < actual.length; index += 1) {
      const error = Math.abs(actual[index] / 255 - expected[index]);
      finite &&= Number.isFinite(error);
      maxAbsoluteError = Math.max(maxAbsoluteError, error);
      sumAbsoluteError += error;
    }
  }
  renderer.destroy();
  const meanAbsoluteError = sumAbsoluteError / (source.length * 2);
  return {
    name: `production-renderer-dpr-${pixelRatio}`,
    width,
    height,
    maxAbsoluteError,
    meanAbsoluteError,
    finite,
    passed: finite && maxAbsoluteError < 0.005 && meanAbsoluteError < 0.0015,
  };
}

export async function runGpuValidation(): Promise<GpuValidationReport> {
  if (!navigator.gpu) {
    return {
      status: 'unsupported',
      cases: [],
      message: 'navigator.gpu is unavailable in this browser.',
    };
  }

  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) {
    return {
      status: 'unsupported',
      cases: [],
      message: 'WebGPU adapter request returned null.',
    };
  }

  const device = await adapter.requestDevice();
  device.pushErrorScope('validation');
  const results: GpuCaseResult[] = [];
  try {
    for (const testCase of makeCases()) {
      results.push(await runCase(device, testCase));
    }
    for (const pixelRatio of [1, 2]) {
      results.push(await runRendererCase(device, pixelRatio));
    }
    const validationError = await device.popErrorScope();
    if (validationError) {
      throw new Error(validationError.message);
    }
  } catch (error) {
    await device.popErrorScope();
    return {
      status: 'failed',
      cases: results,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  const failed = results.filter((result) => !result.passed);
  return {
    status: failed.length === 0 ? 'passed' : 'failed',
    cases: results,
    message: failed.length === 0 ? undefined : `${failed.length} GPU cases exceeded tolerance.`,
  };
}
