import { describe, expect, it } from 'vitest';
import { componentName, presets } from '../cli/templates.mjs';
import {
  generateExample,
  sourceComponentName,
  type ExperimentConfig,
} from '../examples/navbar/codegen';
import type { BlurPlacement, BlurPreset } from '@webgpu-progressive-blur/dom';

const placementFor: Record<BlurPreset, BlurPlacement> = {
  navbar: 'top',
  sidebar: 'left',
  'bottom-bar': 'bottom',
  caption: 'bottom',
  edge: 'top',
  panel: 'top',
};

const experiment: ExperimentConfig = {
  shape: 'circle',
  radius: 24,
  size: 60,
  transition: 80,
  dx: 1,
  dy: 1,
  reverse: false,
};

describe('effect studio code generation', () => {
  it('keeps component names in sync with the CLI mapping', () => {
    for (const preset of presets as BlurPreset[])
      expect(sourceComponentName(preset)).toBe(componentName(preset));
  });

  it.each(['react', 'astro'] as const)('generates %s source examples for every preset', (framework) => {
    for (const preset of presets as BlurPreset[]) {
      const generated = generateExample({
        version: '0.2.0',
        framework,
        preset,
        placement: placementFor[preset],
        radius: 24,
        transition: 48,
        maxSamples: 32,
      });
      expect(generated.mode).toBe('source');
      expect(generated.install).toContain(`@0.2.0 add ${preset} --framework ${framework}`);
      expect(generated.usage).toContain(sourceComponentName(preset));
      expect(generated.notes).toContain(
        framework === 'react' ? 'src/App.tsx' : 'src/pages/index.astro',
      );
      if (preset === 'panel') {
        expect(generated.usage).not.toContain('placement=');
        expect(generated.usage).not.toContain('transition=');
      }
    }
  });

  it('uses the no-name CLI contract when adding all presets', () => {
    const generated = generateExample({
      version: '0.2.0',
      framework: 'react',
      preset: 'navbar',
      placement: 'top',
      radius: 24,
      transition: 48,
      maxSamples: 32,
      addAll: true,
    });
    expect(generated.install).toBe(
      'npx webgpu-progressive-blur@0.2.0 add --framework react',
    );
  });

  it('routes shape experiments to the DOM API instead of inventing a CLI preset', () => {
    const generated = generateExample({
      version: '0.2.0',
      framework: 'react',
      preset: 'experiment',
      placement: 'top',
      radius: 24,
      transition: 48,
      maxSamples: 32,
      experiment,
    });
    expect(generated.mode).toBe('dom');
    expect(generated.framework).toBe('dom');
    expect(generated.install).toBe('npm install webgpu-progressive-blur@0.2.0');
    expect(generated.usage).toContain('profile');
    expect(generated.notes).toContain('不提供 circle 命令');
  });
});
