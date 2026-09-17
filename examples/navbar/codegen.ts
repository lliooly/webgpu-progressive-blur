import type { BlurPlacement, BlurPreset } from '@webgpu-progressive-blur/dom';

export type CodegenFramework = 'react' | 'astro' | 'dom';

export interface ExperimentConfig {
  shape: 'circle' | 'square';
  radius: number;
  size: number;
  transition: number;
  dx: number;
  dy: number;
  reverse: boolean;
}

export interface GeneratedExample {
  install: string;
  usage: string;
  html: string;
  notes: string;
  mode: 'source' | 'dom';
  framework: CodegenFramework;
}

export interface GenerateExampleInput {
  version: string;
  framework: CodegenFramework;
  preset: BlurPreset | 'experiment';
  placement: BlurPlacement;
  radius: number;
  transition: number;
  maxSamples: number;
  experiment?: ExperimentConfig;
  addAll?: boolean;
}

export function sourceComponentName(name: BlurPreset): string {
  return (
    'ProgressiveBlur' +
    name
      .split('-')
      .map((part) => part[0].toUpperCase() + part.slice(1))
      .join('')
  );
}

function domOptions(input: GenerateExampleInput): Record<string, unknown> {
  if (input.preset === 'experiment') {
    const experiment = input.experiment;
    if (!experiment) throw new Error('Shape experiment parameters are required.');
    return {
      radius: experiment.radius,
      maxSamples: input.maxSamples,
      profile:
        experiment.shape === 'circle'
          ? {
              type: 'radial',
              transition: experiment.transition / 100,
              reverse: experiment.reverse,
            }
          : {
              type: 'directional',
              direction: [experiment.dx, experiment.dy],
              transition: experiment.transition / 100,
              reverse: experiment.reverse,
            },
    };
  }
  return {
    preset: input.preset,
    placement: input.placement,
    transition: input.preset === 'panel' ? 0 : input.transition,
    radius: input.radius,
    maxSamples: input.maxSamples,
  };
}

function domGeometry(input: GenerateExampleInput): string {
  if (input.preset === 'experiment') {
    const experiment = input.experiment!;
    return `position: relative; width: ${experiment.size}vmin; height: ${experiment.size}vmin;${experiment.shape === 'circle' ? ' border-radius: 50%;' : ''}`;
  }
  const side = input.placement;
  switch (input.preset) {
    case 'navbar':
      return 'position: fixed; top: 0; left: 0; right: 0; min-height: 72px;';
    case 'sidebar':
      return `position: fixed; ${side}: 0; top: 0; bottom: 0; width: 200px;`;
    case 'bottom-bar':
      return 'position: fixed; bottom: 0; left: 0; right: 0; min-height: 80px;';
    case 'caption':
      return `position: absolute; ${side}: 0; left: 0; right: 0; min-height: 120px;`;
    case 'edge':
      return `position: absolute; ${side}: 0; ${side === 'top' || side === 'bottom' ? 'left: 0; right: 0; height: 16px;' : 'top: 0; bottom: 0; width: 16px;'} pointer-events: none;`;
    case 'panel':
      return 'position: relative; width: min(320px, 90vw); min-height: 200px; border-radius: 16px;';
  }
}

function domExample(input: GenerateExampleInput): GeneratedExample {
  const api = JSON.stringify(domOptions(input), null, 2);
  const experiment = input.preset === 'experiment';
  const usage = `import { attachProgressiveBlur } from 'webgpu-progressive-blur/dom';

// 在客户端、元素挂载后运行。背景需位于目标元素后方。
const element = document.querySelector('.blur-target');
if (!(element instanceof HTMLElement)) throw new Error('Missing .blur-target');

const effect = await attachProgressiveBlur(element, ${api});

// 背景内容变化后：await effect.refresh();
// 组件卸载时：effect.destroy();
// effect.status.state === 'unsupported' 时保留原页面。`;
  const html = `<!-- 放入你已有的页面；caption / edge 的父容器需 position: relative。 -->
<div class="blur-target">
  ${input.preset === 'edge' ? '<!-- 装饰性边缘；内容放在后方的容器内。 -->' : '<!-- 在这里放置你的导航项、按钮或标题。 -->'}
</div>

<style>
.blur-target {
  ${domGeometry(input)}
  z-index: 10;
  background: transparent;
  color: white;
  /* 保留渐隐延伸区域，避免 overflow: hidden。 */
}
</style>`;
  return {
    install: `npm install webgpu-progressive-blur@${input.version}`,
    usage,
    html,
    notes: experiment
      ? '形状实验只导出 DOM API：源码 CLI 首版不提供 circle 命令。尺寸与位置请在 HTML / CSS 中调整。'
      : 'DOM 入口在客户端挂载后初始化；背景更新后调用 effect.refresh()，组件卸载时调用 effect.destroy()。',
    mode: 'dom',
    framework: 'dom',
  };
}

function componentAttributes(input: GenerateExampleInput): string {
  const attributes = [`radius={${input.radius}}`];
  if (input.preset !== 'panel') {
    attributes.push(`transition={${input.transition}}`);
    attributes.push(`placement="${input.placement}"`);
  }
  return attributes.join(' ');
}

function sourceExample(input: GenerateExampleInput): GeneratedExample {
  if (input.preset === 'experiment') return domExample(input);
  const name = sourceComponentName(input.preset);
  const attributes = componentAttributes(input);
  const install = input.addAll
    ? `npx webgpu-progressive-blur@${input.version} add --framework ${input.framework}`
    : `npx webgpu-progressive-blur@${input.version} add ${input.preset} --framework ${input.framework}`;
  const usage =
    input.framework === 'react'
      ? `import { ${name} } from './components/progressive_blur';

export default function Example() {
  return (
    <${name} ${attributes}>
      {/* 放置导航、标题或按钮；背景内容放在组件后方。 */}
    </${name}>
  );
}`
      : `---
import ${name} from '../components/progressive_blur/progressive-blur-${input.preset}.astro';
---

<${name} ${attributes}>
  <!-- 放置导航、标题或按钮；背景内容放在组件后方。 -->
</${name}>`;
  return {
    install,
    usage,
    html: '',
    notes: `将安装命令放在项目根目录执行。React 示例放入 src/App.tsx；Astro 示例放入 src/pages/index.astro。默认写入 src/components/progressive_blur（无 src 时写入 components）。组件源码可编辑，用户 style 会覆盖默认内联布局；普通 class 不会覆盖相同的内联属性。背景需位于组件后方，caption / edge 的父容器需 position: relative；不要用 overflow: hidden 裁掉渐隐外延。背景变化后，React 改变 refreshKey，Astro 派发 progressive-blur:refresh。`,
    mode: 'source',
    framework: input.framework,
  };
}

export function generateExample(input: GenerateExampleInput): GeneratedExample {
  return input.framework === 'dom' ? domExample(input) : sourceExample(input);
}
