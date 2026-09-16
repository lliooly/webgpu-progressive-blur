import type { BlurGradient } from './types.js';

export interface ReferenceBlurOptions {
  /** Gaussian sigma in source pixels. The support radius is sigma * 3. */
  radius: number;
  maxSamples: number;
  /** Per-pixel alpha values in the range 0..1. */
  mask?: ArrayLike<number>;
  gradient?: BlurGradient;
  verticalPassFirst?: boolean;
  normalizeEdges?: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function gaussian(distance: number, sigma: number): number {
  const safeSigma = Math.max(sigma, 0.0001);
  return Math.exp(-(distance * distance) / (2 * safeSigma * safeSigma));
}

function normalizeMaskValue(value: number): number {
  return value > 1 ? value / 255 : value;
}

function gradientStrength(y: number, height: number, gradient: Required<BlurGradient>): number {
  const normalizedY = height <= 1 ? 0 : y / (height - 1);
  const range = Math.max(Math.abs(gradient.end - gradient.start), 0.0001);
  const progress = clamp((normalizedY - gradient.start) / range, 0, 1);
  return gradient.direction === 'bottom-to-top' ? progress : 1 - progress;
}

function bilinearSample(
  source: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
  normalizeEdges: boolean,
): [number, number, number, number] | undefined {
  if (normalizeEdges && (x < 0 || x > width - 1 || y < 0 || y > height - 1)) {
    return undefined;
  }

  const clampedX = clamp(x, 0, width - 1);
  const clampedY = clamp(y, 0, height - 1);
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
  const result: [number, number, number, number] = [0, 0, 0, 0];

  for (let channel = 0; channel < 4; channel += 1) {
    const top = source[p00 + channel] * (1 - tx) + source[p10 + channel] * tx;
    const bottom = source[p01 + channel] * (1 - tx) + source[p11 + channel] * tx;
    result[channel] = top * (1 - ty) + bottom * ty;
  }
  return result;
}

function blurPass(
  source: Float32Array,
  width: number,
  height: number,
  supportRadius: number,
  maxSamples: number,
  mask: ArrayLike<number> | undefined,
  gradient: Required<BlurGradient> | undefined,
  axis: 'horizontal' | 'vertical',
  normalizeEdges: boolean,
): Float32Array {
  const output = new Float32Array(source.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = y * width + x;
      const strength = mask
        ? clamp(normalizeMaskValue(mask[pixelIndex] ?? 0), 0, 1)
        : gradient
          ? gradientStrength(y, height, gradient)
          : 1;
      const radius = strength * supportRadius;
      const outputOffset = pixelIndex * 4;

      if (radius < 1) {
        output[outputOffset] = source[outputOffset];
        output[outputOffset + 1] = source[outputOffset + 1];
        output[outputOffset + 2] = source[outputOffset + 2];
        output[outputOffset + 3] = source[outputOffset + 3];
        continue;
      }

      const sigma = radius / 3;
      const centerWeight = gaussian(0, sigma);
      const center = bilinearSample(source, width, height, x, y, normalizeEdges)!;
      let weightedRed = center[0] * centerWeight;
      let weightedGreen = center[1] * centerWeight;
      let weightedBlue = center[2] * centerWeight;
      let weightedAlpha = center[3] * centerWeight;
      let totalWeight = centerWeight;
      const interval = Math.max(1, radius / Math.max(1, maxSamples));
      const axisX = axis === 'horizontal';

      for (let sampleIndex = 1; sampleIndex <= 64; sampleIndex += 1) {
        const distance = sampleIndex * interval;
        if (distance > radius) break;
        const weight = gaussian(distance, sigma);
        const offsetX = axisX ? distance : 0;
        const offsetY = axisX ? 0 : distance;
        const positive = bilinearSample(
          source,
          width,
          height,
          x + offsetX,
          y + offsetY,
          normalizeEdges,
        );
        const negative = bilinearSample(
          source,
          width,
          height,
          x - offsetX,
          y - offsetY,
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

      output[outputOffset] = weightedRed / totalWeight;
      output[outputOffset + 1] = weightedGreen / totalWeight;
      output[outputOffset + 2] = weightedBlue / totalWeight;
      output[outputOffset + 3] = weightedAlpha / totalWeight;
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
  if (source.length !== width * height * 4) {
    throw new RangeError('source length must equal width * height * 4.');
  }
  if (!Number.isFinite(options.radius) || options.radius < 0) {
    throw new RangeError('radius must be a finite number greater than or equal to 0.');
  }

  const gradient: Required<BlurGradient> | undefined = options.gradient
    ? (() => {
        const start = clamp(options.gradient.start ?? 0, 0, 1);
        const end = clamp(options.gradient.end ?? 1, 0, 1);
        return {
          start,
          end:
            Math.abs(end - start) < 0.0001
              ? start >= 1
                ? Math.max(0, start - 0.0001)
                : Math.min(1, start + 0.0001)
              : end,
          direction: options.gradient.direction ?? 'top-to-bottom',
        };
      })()
    : undefined;
  const supportRadius = options.radius * 3;
  const firstAxis = options.verticalPassFirst ? 'vertical' : 'horizontal';
  const secondAxis = options.verticalPassFirst ? 'horizontal' : 'vertical';
  const firstPass = blurPass(
    source,
    width,
    height,
    supportRadius,
    options.maxSamples,
    options.mask,
    gradient,
    firstAxis,
    options.normalizeEdges ?? true,
  );
  return blurPass(
    firstPass,
    width,
    height,
    supportRadius,
    options.maxSamples,
    options.mask,
    gradient,
    secondAxis,
    options.normalizeEdges ?? true,
  );
}

export function createGradientMask(
  width: number,
  height: number,
  gradient: BlurGradient = {},
): Float32Array {
  const normalized: Required<BlurGradient> = {
    start: clamp(gradient.start ?? 0, 0, 1),
    end: clamp(gradient.end ?? 1, 0, 1),
    direction: gradient.direction ?? 'top-to-bottom',
  };
  const mask = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const strength = gradientStrength(y, height, normalized);
    for (let x = 0; x < width; x += 1) {
      mask[y * width + x] = strength;
    }
  }
  return mask;
}
