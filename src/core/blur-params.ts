import type { BlurParameters } from './types.js';

export const MAX_SAMPLES = 64;
export const BLUR_UNIFORM_BYTE_SIZE = 48;

export interface BlurUniformOptions {
  width: number;
  height: number;
  pixelRatio: number;
  axis: number;
  parameters: BlurParameters;
}

/**
 * Packs the shader contract shared by the production renderer and the GPU
 * validation harness. Radius is public CSS sigma; the shader receives the
 * corresponding physical 3-sigma support radius.
 */
export function createBlurUniformValues(options: BlurUniformOptions): Float32Array {
  const { width, height, pixelRatio, axis, parameters } = options;
  return new Float32Array([
    width,
    height,
    1 / width,
    1 / height,
    parameters.radius * 3 * pixelRatio,
    parameters.maxSamples,
    axis,
    parameters.mode === 'navbar' ? 1 : 0,
    parameters.gradient.start,
    parameters.gradient.end,
    parameters.gradient.direction === 'bottom-to-top' ? 1 : 0,
    parameters.normalizeEdges ? 1 : 0,
  ]);
}
