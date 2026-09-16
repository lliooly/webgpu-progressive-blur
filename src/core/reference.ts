import type { BlurGradient } from './types.js';

export interface ReferenceBlurOptions {
  /** Gaussian sigma in input texture pixels. The support radius is sigma * 3. */
  radius: number;
  maxSamples: number;
  /** Per-pixel alpha values in the range 0..1 (255 is also accepted). */
  mask?: ArrayLike<number>;
  gradient?: BlurGradient;
  verticalPassFirst?: boolean;
  normalizeEdges?: boolean;
}

type Rgba = [number, number, number, number];
type Axis = 'horizontal' | 'vertical';

const MAX_SAMPLES = 64;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function gaussian(distance: number, sigma: number): number {
  const safeSigma = Math.max(sigma, 0.0001);
  const exponent = -(distance * distance) / (2 * safeSigma * safeSigma);
  return (1 / (2 * Math.PI * safeSigma * safeSigma)) * Math.exp(exponent);
}

function normalizeMaskValue(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value > 1 ? value / 255 : value;
}

function normalizeGradient(gradient: BlurGradient): Required<BlurGradient> {
  const start = clamp(gradient.start ?? 0, 0, 1);
  const end = clamp(gradient.end ?? 1, 0, 1);
  const safeEnd = Math.abs(end - start) < 0.0001
    ? start >= 1
      ? Math.max(0, start - 0.0001)
      : Math.min(1, start + 0.0001)
    : end;
  return {
    start,
    end: safeEnd,
    direction: gradient.direction ?? 'top-to-bottom',
  };
}

function gradientStrength(
  pixelY: number,
  height: number,
  gradient: Required<BlurGradient>,
): number {
  const normalizedY = height > 0 ? pixelY / height : 0;
  const range = Math.max(Math.abs(gradient.end - gradient.start), 0.0001);
  const progress = clamp((normalizedY - gradient.start) / range, 0, 1);
  return gradient.direction === 'bottom-to-top' ? progress : 1 - progress;
}

function inBoundingRect(x: number, y: number, width: number, height: number): boolean {
  return x >= 0 && x <= width && y >= 0 && y <= height;
}

/**
 * Samples a texture using the same continuous pixel coordinates as the WGSL
 * shader. Pixel centers are x + 0.5/y + 0.5; x == width and y == height are
 * retained as the inclusive texture boundary used by Inferno's boundingRect.
 */
function sampleLinear(
  source: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
  normalizeEdges: boolean,
): Rgba | undefined {
  const inside = inBoundingRect(x, y, width, height);
  if (!inside && normalizeEdges) return undefined;
  if (!inside) return [0, 0, 0, 0];

  const clampedX = clamp(x - 0.5, 0, width - 1);
  const clampedY = clamp(y - 0.5, 0, height - 1);
  const x0 = Math.floor(clampedX);
  const y0 = Math.floor(clampedY);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = clampedX - x0;
  const ty = clampedY - y0;
  const p00 = (y0 * width + x0) * 4;
  const p10 = (y0 * width + x1) * 4;
  const p01 = (y1 * width + x0) * 4;
  const p11 = (y1 * width + x1) * 4;
  const result: Rgba = [0, 0, 0, 0];

  for (let channel = 0; channel < 4; channel += 1) {
    const top = source[p00 + channel] * (1 - tx) + source[p10 + channel] * tx;
    const bottom = source[p01 + channel] * (1 - tx) + source[p11 + channel] * tx;
    result[channel] = top * (1 - ty) + bottom * ty;
  }
  return result;
}

function copyColor(target: Float32Array, offset: number, color: Rgba): void {
  target[offset] = color[0];
  target[offset + 1] = color[1];
  target[offset + 2] = color[2];
  target[offset + 3] = color[3];
}

function resolveMaxSamples(value: number): number {
  if (!Number.isFinite(value) || value < 1) {
    throw new RangeError('maxSamples must be a finite number greater than 0.');
  }
  return Math.min(MAX_SAMPLES, Math.max(1, Math.round(value)));
}

function blurPass(
  source: Float32Array,
  width: number,
  height: number,
  supportRadius: number,
  maxSamples: number,
  mask: ArrayLike<number> | undefined,
  gradient: Required<BlurGradient> | undefined,
  axis: Axis,
  normalizeEdges: boolean,
): Float32Array {
  const output = new Float32Array(source.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = y * width + x;
      const pixelPositionX = x + 0.5;
      const pixelPositionY = y + 0.5;
      const strength = mask
        ? clamp(normalizeMaskValue(mask[pixelIndex] ?? 0), 0, 1)
        : gradient
          ? gradientStrength(pixelPositionY, height, gradient)
          : 1;
      const radius = strength * supportRadius;
      const outputOffset = pixelIndex * 4;

      if (radius < 1) {
        copyColor(output, outputOffset, [
          source[outputOffset],
          source[outputOffset + 1],
          source[outputOffset + 2],
          source[outputOffset + 3],
        ]);
        continue;
      }

      const sigma = radius / 3;
      const centerWeight = gaussian(0, sigma);
      const center = sampleLinear(
        source,
        width,
        height,
        pixelPositionX,
        pixelPositionY,
        normalizeEdges,
      );
      if (!center) {
        throw new Error('The current pixel is outside the blur bounding rect.');
      }

      let weightedRed = center[0] * centerWeight;
      let weightedGreen = center[1] * centerWeight;
      let weightedBlue = center[2] * centerWeight;
      let weightedAlpha = center[3] * centerWeight;
      let totalWeight = centerWeight;
      const interval = Math.max(1, radius / maxSamples);
      const axisX = axis === 'horizontal';

      for (let sampleIndex = 1; sampleIndex <= MAX_SAMPLES; sampleIndex += 1) {
        const distance = sampleIndex * interval;
        if (distance > radius) break;

        const weight = gaussian(distance, sigma);
        const offsetX = axisX ? distance : 0;
        const offsetY = axisX ? 0 : distance;
        const positive = sampleLinear(
          source,
          width,
          height,
          pixelPositionX + offsetX,
          pixelPositionY + offsetY,
          normalizeEdges,
        );
        const negative = sampleLinear(
          source,
          width,
          height,
          pixelPositionX - offsetX,
          pixelPositionY - offsetY,
          normalizeEdges,
        );

        for (const sample of [positive, negative]) {
          if (!sample) continue;
          weightedRed += sample[0] * weight;
          weightedGreen += sample[1] * weight;
          weightedBlue += sample[2] * weight;
          weightedAlpha += sample[3] * weight;
          totalWeight += weight;
        }
      }

      copyColor(output, outputOffset, [
        weightedRed / totalWeight,
        weightedGreen / totalWeight,
        weightedBlue / totalWeight,
        weightedAlpha / totalWeight,
      ]);
    }
  }

  return output;
}

/**
 * CPU reference for the same two-pass approximation used by the WGSL shader.
 * It is intentionally small and slow: tests use it to make GPU changes
 * explainable rather than as a production fallback.
 */
export function progressiveBlurReference(
  source: Float32Array,
  width: number,
  height: number,
  options: ReferenceBlurOptions,
): Float32Array {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new RangeError('width and height must be positive integers.');
  }
  if (source.length !== width * height * 4) {
    throw new RangeError('source length must equal width * height * 4.');
  }
  if (!Number.isFinite(options.radius) || options.radius < 0) {
    throw new RangeError('radius must be a finite number greater than or equal to 0.');
  }

  const maxSamples = resolveMaxSamples(options.maxSamples);
  const gradient = options.gradient ? normalizeGradient(options.gradient) : undefined;
  const supportRadius = options.radius * 3;
  const normalizeEdges = options.normalizeEdges ?? true;
  const firstAxis = options.verticalPassFirst ? 'vertical' : 'horizontal';
  const secondAxis = options.verticalPassFirst ? 'horizontal' : 'vertical';
  const firstPass = blurPass(
    source,
    width,
    height,
    supportRadius,
    maxSamples,
    options.mask,
    gradient,
    firstAxis,
    normalizeEdges,
  );
  return blurPass(
    firstPass,
    width,
    height,
    supportRadius,
    maxSamples,
    options.mask,
    gradient,
    secondAxis,
    normalizeEdges,
  );
}

export function createGradientMask(
  width: number,
  height: number,
  gradient: BlurGradient = {},
): Float32Array {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new RangeError('width and height must be positive integers.');
  }
  const normalized = normalizeGradient(gradient);
  const mask = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const strength = gradientStrength(y + 0.5, height, normalized);
    for (let x = 0; x < width; x += 1) {
      mask[y * width + x] = strength;
    }
  }
  return mask;
}
