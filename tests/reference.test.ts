import { describe, expect, it } from 'vitest';
import { createGradientMask, progressiveBlurReference } from '../src/index';
import { variableBlurWgsl } from '../src/shaders/variable-blur.wgsl';

function makeImage(width: number, height: number): Float32Array {
  const image = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      image[offset] = x / Math.max(1, width - 1);
      image[offset + 1] = y / Math.max(1, height - 1);
      image[offset + 2] = (x + y) / Math.max(1, width + height - 2);
      image[offset + 3] = 1;
    }
  }
  return image;
}

describe('progressiveBlurReference', () => {
  it('keeps zero-radius input unchanged', () => {
    const input = makeImage(5, 4);
    const output = progressiveBlurReference(input, 5, 4, {
      radius: 0,
      maxSamples: 15,
      gradient: { start: 0, end: 1 },
    });
    expect(Array.from(output)).toEqual(Array.from(input));
  });

  it('preserves a constant color after both passes', () => {
    const input = new Float32Array(7 * 5 * 4);
    for (let index = 0; index < input.length; index += 4) {
      input[index] = 0.17;
      input[index + 1] = 0.42;
      input[index + 2] = 0.91;
      input[index + 3] = 0.73;
    }
    const output = progressiveBlurReference(input, 7, 5, {
      radius: 12,
      maxSamples: 15,
      gradient: { start: 0, end: 1 },
      normalizeEdges: true,
    });
    for (let index = 0; index < output.length; index += 1) {
      expect(output[index]).toBeCloseTo(input[index], 6);
    }
  });

  it('does not blur pixels where the alpha mask is transparent', () => {
    const input = makeImage(6, 6);
    const mask = new Float32Array(36);
    mask.fill(1, 0, 18);
    const output = progressiveBlurReference(input, 6, 6, {
      radius: 8,
      maxSamples: 15,
      mask,
      normalizeEdges: true,
    });
    for (let index = 18 * 4; index < output.length; index += 1) {
      expect(output[index]).toBe(input[index]);
    }
    expect(Array.from(output.slice(0, 18 * 4))).not.toEqual(
      Array.from(input.slice(0, 18 * 4)),
    );
  });

  it('creates a continuous top-to-bottom gradient mask', () => {
    const mask = createGradientMask(3, 5, { start: 0, end: 1 });
    expect(mask[0]).toBeCloseTo(1);
    expect(mask[2 * 3]).toBeCloseTo(0.5);
    expect(mask[4 * 3]).toBeCloseTo(0);
  });
});

describe('WGSL source', () => {
  it('keeps the variable-radius and edge normalization paths in the shader', () => {
    expect(variableBlurWgsl).toContain('const MAX_SAMPLES: u32 = 64u');
    expect(variableBlurWgsl).toContain('textureSampleLevel(maskTexture');
    expect(variableBlurWgsl).toContain('params.normalizeEdges');
    expect(variableBlurWgsl).toContain('let blurredColor = weightedColor / max(totalWeight');
  });
});
