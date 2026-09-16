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

function makeConstant(width: number, height: number, color: [number, number, number, number]) {
  const image = new Float32Array(width * height * 4);
  for (let index = 0; index < image.length; index += 4) {
    image.set(color, index);
  }
  return image;
}

function makeImpulse(width: number, height: number, x: number, y: number): Float32Array {
  const image = new Float32Array(width * height * 4);
  image[(y * width + x) * 4] = 1;
  image[(y * width + x) * 4 + 3] = 1;
  return image;
}

describe('progressiveBlurReference', () => {
  it('keeps zero-radius and subpixel-radius input unchanged', () => {
    const input = makeImage(5, 4);
    for (const radius of [0, 0.2]) {
      const output = progressiveBlurReference(input, 5, 4, {
        radius,
        maxSamples: 15,
        mask: new Float32Array(20).fill(1),
      });
      expect(Array.from(output)).toEqual(Array.from(input));
    }
  });

  it('preserves a constant color with normalized edges', () => {
    const input = makeConstant(7, 5, [0.17, 0.42, 0.91, 0.73]);
    const output = progressiveBlurReference(input, 7, 5, {
      radius: 12,
      maxSamples: 15,
      mask: new Float32Array(35).fill(1),
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

  it('uses the same axis direction as the Metal one-dimensional pass', () => {
    const horizontalInput = makeImpulse(7, 1, 3, 0);
    const horizontalOutput = progressiveBlurReference(horizontalInput, 7, 1, {
      radius: 2,
      maxSamples: 15,
      mask: new Float32Array(7).fill(1),
      verticalPassFirst: true,
      normalizeEdges: true,
    });
    expect(horizontalOutput[2 * 4]).toBeGreaterThan(0);
    expect(horizontalOutput[3 * 4]).toBeLessThan(1);

    const verticalInput = makeImpulse(1, 7, 0, 3);
    const verticalOutput = progressiveBlurReference(verticalInput, 1, 7, {
      radius: 2,
      maxSamples: 15,
      mask: new Float32Array(7).fill(1),
      verticalPassFirst: false,
      normalizeEdges: true,
    });
    expect(verticalOutput[2 * 4]).toBeGreaterThan(0);
    expect(verticalOutput[3 * 4]).toBeLessThan(1);
  });

  it('renormalizes normalized edges and keeps transparent exterior weight otherwise', () => {
    const input = makeConstant(9, 1, [1, 1, 1, 1]);
    const normalized = progressiveBlurReference(input, 9, 1, {
      radius: 2,
      maxSamples: 15,
      mask: new Float32Array(9).fill(1),
      verticalPassFirst: true,
      normalizeEdges: true,
    });
    const transparentExterior = progressiveBlurReference(input, 9, 1, {
      radius: 2,
      maxSamples: 15,
      mask: new Float32Array(9).fill(1),
      verticalPassFirst: true,
      normalizeEdges: false,
    });
    expect(normalized[0]).toBeCloseTo(1, 6);
    expect(transparentExterior[0]).toBeLessThan(transparentExterior[4 * 4]);
  });

  it('creates a gradient mask using pixel-center UVs', () => {
    const mask = createGradientMask(3, 5, { start: 0, end: 1 });
    expect(mask[0]).toBeCloseTo(0.9);
    expect(mask[2 * 3]).toBeCloseTo(0.5);
    expect(mask[4 * 3]).toBeCloseTo(0.1);
  });

  it('keeps progressive strength monotonic in the mask', () => {
    const mask = createGradientMask(2, 9, { start: 0, end: 1 });
    for (let y = 1; y < 9; y += 1) {
      expect(mask[y * 2]).toBeLessThan(mask[(y - 1) * 2]);
    }
  });

  it('makes pass order an explicit part of the variable-radius result', () => {
    const input = makeImage(7, 7);
    const mask = createGradientMask(7, 7, { start: 0, end: 1 });
    const horizontalFirst = progressiveBlurReference(input, 7, 7, {
      radius: 5,
      maxSamples: 15,
      mask,
      verticalPassFirst: false,
      normalizeEdges: true,
    });
    const verticalFirst = progressiveBlurReference(input, 7, 7, {
      radius: 5,
      maxSamples: 15,
      mask,
      verticalPassFirst: true,
      normalizeEdges: true,
    });
    expect(Array.from(horizontalFirst)).not.toEqual(Array.from(verticalFirst));
  });
});

describe('WGSL structure', () => {
  it('keeps the pixel-space Inferno kernel and variable-radius paths', () => {
    expect(variableBlurWgsl).toContain('const MAX_SAMPLES: u32 = 64u');
    expect(variableBlurWgsl).toContain('@builtin(position)');
    expect(variableBlurWgsl).toContain('fn blur1D');
    expect(variableBlurWgsl).toContain('textureSampleLevel(maskTexture');
    expect(variableBlurWgsl).toContain('params.normalizeEdges');
    expect(variableBlurWgsl).toContain('return weightedColor / max(totalWeight');
  });
});
