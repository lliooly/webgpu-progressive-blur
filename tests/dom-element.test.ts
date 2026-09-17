import { describe, expect, it } from 'vitest';
import {
  normalizeOverlayBleed,
  resolveBlurProfile,
} from '../src/dom/element';
import type { BlurSource } from '../src/core/types';

describe('DOM element blur helpers', () => {
  it('normalizes uniform and per-side overlay bleed', () => {
    expect(normalizeOverlayBleed(12)).toEqual({
      top: 12,
      right: 12,
      bottom: 12,
      left: 12,
    });
    expect(normalizeOverlayBleed({ bottom: 48, left: 4 })).toEqual({
      top: 0,
      right: 0,
      bottom: 48,
      left: 4,
    });
  });

  it('rejects invalid overlay bleed values', () => {
    expect(() => normalizeOverlayBleed(Number.NaN)).toThrow(RangeError);
    expect(() => normalizeOverlayBleed({ right: Number.POSITIVE_INFINITY })).toThrow(RangeError);
  });

  it('maps convenient profiles to the existing renderer modes', () => {
    expect(resolveBlurProfile('uniform')).toMatchObject({
      mode: 'reference',
      mask: undefined,
    });
    expect(resolveBlurProfile({
      type: 'linear',
      start: 0.2,
      end: 0.8,
      direction: 'bottom-to-top',
    })).toEqual({
      mode: 'navbar',
      gradient: { start: 0.2, end: 0.8, direction: 'bottom-to-top' },
      mask: undefined,
    });
  });

  it('preserves caller-provided mask sources', () => {
    const source = {} as BlurSource;
    const resolved = resolveBlurProfile({ type: 'mask', source });
    expect(resolved.mode).toBe('reference');
    expect(resolved.mask).toBe(source);
  });
});
