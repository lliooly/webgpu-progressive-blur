# WebGPU Progressive Blur

[![License](https://img.shields.io/github/license/lliooly/webgpu-progressive-blur)](LICENSE)

一个无框架绑定的 TypeScript + WebGPU 渐进模糊库，面向博客导航栏和其他需要「前景保持可读、背景持续变化」的界面。

项目参考 [Inferno](https://github.com/twostraws/Inferno/tree/a40c7a0bdec03aae1bd0b96c41d6a75451bafd2c) 的 Swift/Metal 实现，并使用 WGSL 重写核心采样逻辑。

## 项目状态

当前版本为 `0.1.1` public preview：

- 已完成 CPU 参考实现、WebGPU 两遍渲染内核、TypeScript 类型声明和 ESM 构建。
- 支持 Alpha mask 的 `reference` 模式，以及按纵向渐变解析半径的 `navbar` 模式。
- 提供 `webgpu-progressive-blur/dom` 的 `attachProgressiveBlur()`，可直接应用到任意 DOM 元素并自动管理覆盖层。
- 核心验收覆盖非方形纹理、横纵轴、渐进 mask、边界归一化、pass 顺序和 DPR 缩放。
- 最近一次 Chrome WebGPU 验收共 10 个 case，全部通过；单 case 最大绝对误差为 `0.00231`，低于 `0.003` 阈值。
- `examples/navbar` 是左右布局的渐变模糊效果调试台，支持圆形径向渐变、方形八方向渐变、拖动、参数调节、本地换图与原图对比。
- 真实博客项目的 DOM 捕获、跨域图片策略和最终画质仍需在目标站点单独验收。

仓库已配置为可公开发布的 npm 包；是否执行 `npm publish` 由维护者在确认包名和发布时机后决定。

## 特性

- 可直接使用的 ESM API 和 TypeScript 声明。
- 模块导入阶段不访问 `window`、`document` 或 `navigator`，适合服务端构建流程。
- 两遍可分离高斯采样，中间纹理使用 `rgba16float`。
- `radius` 使用 Gaussian sigma 语义，shader 的支持半径为 `3 × radius`。
- 支持最多 64 个轴向采样、边缘权重重新归一化和透明外部采样。
- 支持 `HTMLCanvasElement`、`OffscreenCanvas`、外部图像源和调用者持有的 `GPUTexture`。
- 提供可选的 DOM 生命周期适配器；DOM 捕获实现由调用者注入。

## 安装

```bash
npm install webgpu-progressive-blur
```

如果 npm registry 尚未提供对应版本，可以先在仓库内构建并检查本地包：

```bash
npm run pack:check
```

## 快速开始

`createProgressiveBlur` 需要一个用于接收结果的 WebGPU canvas。调用者可以传入已有的 `GPUDevice`，也可以让库自行请求设备。

```ts
import { createProgressiveBlur } from 'webgpu-progressive-blur';

const outputCanvas = document.querySelector<HTMLCanvasElement>('#blur-output')!;
const sourceCanvas = document.querySelector<HTMLCanvasElement>('#background')!;

const blur = await createProgressiveBlur({
  canvas: outputCanvas,
  source: sourceCanvas,
  mode: 'navbar',
  radius: 16,
  maxSamples: 15,
  verticalPassFirst: true,
  normalizeEdges: true,
  // 仅当 sourceCanvas 是不透明内容时启用，避免 CPU 回读。
  canvasUploadMode: 'external',
  gradient: {
    start: 0,
    end: 1,
    direction: 'top-to-bottom',
  },
});

blur.render();
blur.setParameters({ radius: 22 });
blur.resize(outputCanvas.clientWidth, outputCanvas.clientHeight, window.devicePixelRatio);
blur.destroy();
```

`source` 的尺寸应与 renderer 当前的物理尺寸一致。画布尺寸变化后，先调用 `resize`，再更新源纹理并渲染。

Canvas 源默认使用 `canvasUploadMode: 'readback'`，通过 2D 回读保留已有的 alpha 兼容行为；确认源画布是不透明内容时，可以显式设置为 `'external'`，让浏览器直接执行 `copyExternalImageToTexture()`。`cacheMask: true` 可以缓存非 GPU 的 reference mask；如果调用方原地修改了 mask，需要随后调用 `invalidateMask()`。

## 渲染模式

| 模式 | 说明 |
| --- | --- |
| `navbar` | 根据纵向渐变解析每个像素的模糊半径，不需要上传 mask，适合固定导航栏。 |
| `reference` | 从 mask 的 Alpha 通道读取每个像素的模糊强度，适合验证和自定义渐进区域。 |

### DOM 适配器

核心库不绑定具体的 DOM 截图库。`webgpu-progressive-blur/dom` 提供刷新、滚动重绘、resize/theme 监听、取消过期捕获和销毁流程；捕获函数由调用者选择，以适配自己的字体、图片和跨域策略。

```ts
import html2canvas from 'html2canvas';
import { createProgressiveBlur } from 'webgpu-progressive-blur';
import { ProgressiveBlurDomAdapter } from 'webgpu-progressive-blur/dom';

const canvas = document.querySelector<HTMLCanvasElement>('#blur-output')!;
const page = document.querySelector<HTMLElement>('#page')!;

const renderer = await createProgressiveBlur({
  canvas,
  mode: 'navbar',
});

const adapter = new ProgressiveBlurDomAdapter({
  renderer,
  element: page,
  capture: ({ element, width, height, pixelRatio }) =>
    html2canvas(element, {
      backgroundColor: null,
      height,
      logging: false,
      scale: pixelRatio,
      width,
      windowHeight: height,
      windowWidth: width,
    }),
});

await adapter.start();
// 主题或页面内容变化后可以手动刷新：
await adapter.refresh('theme');
adapter.destroy();
```

`html2canvas` 是默认 DOM 入口的运行时依赖；核心入口不会加载 DOM 捕获代码。对于生产博客，应根据实际页面的跨域资源和字体加载情况选择或实现捕获方案。

### 任意 DOM 元素

如果希望少写一层 canvas、source 和生命周期代码，可以直接把效果挂到任意元素：

```ts
import { attachProgressiveBlur } from 'webgpu-progressive-blur/dom';

const card = document.querySelector<HTMLElement>('.glass-card')!;
const blur = await attachProgressiveBlur(card, {
  radius: 18,
  profile: 'uniform',
});

// 页面内容或主题变化后重新捕获；滚动会复用已缓存的场景快照。
await blur.refresh();
blur.setParameters({ radius: 22 });
blur.destroy();
```

`attachProgressiveBlur()` 默认使用 `html2canvas` 捕获 `document.body`，自动插入一个不可交互的覆盖 canvas，并在滚动时只裁剪当前元素区域。多个元素使用相同的 `captureRoot` 和滚动目标时会共享场景快照与默认 WebGPU device。

`profile` 支持均匀模糊、线性渐进和自定义 Alpha mask：

```ts
await attachProgressiveBlur(card, {
  profile: {
    type: 'linear',
    start: 0,
    end: 1,
    direction: 'top-to-bottom',
  },
});
```

导航栏需要在元素下方延伸一段渐隐区域时，可以使用 overlay bleed：

```ts
await attachProgressiveBlur(nav, {
  profile: 'navbar',
  overlay: {
    bleed: { bottom: 48 },
  },
});
```

默认 DOM 捕获器适合快速接入和普通页面。跨域图片、视频、复杂 CSS 或特殊滚动容器可以注入自己的 `capture`；捕获器收到的 `output` canvas 会被复用，返回的 source 应已裁剪到当前 overlay 尺寸。

## API 概览

- `createProgressiveBlur(options)`：创建异步 WebGPU renderer。
- `attachProgressiveBlur(element, options)`：将效果直接挂载到 DOM 元素。
- `setSource(source)`：替换源纹理或外部图像。
- `setMask(mask)`：替换或清除 `reference` 模式使用的 Alpha mask。
- `invalidateMask()`：通知启用缓存的非 GPU mask 在下一帧重新上传。
- `setParameters(parameters)`：更新半径、采样数、模式、渐变和 pass 顺序。
- `resize(cssWidth, cssHeight, pixelRatio)`：按 CSS 尺寸重新配置输出和中间纹理。
- `render()`：提交当前帧的两遍渲染。
- `destroy()`：释放 GPU 资源；销毁后不能继续使用 renderer。

完整类型定义见 [`src/core/types.ts`](src/core/types.ts)、[`src/dom/element.ts`](src/dom/element.ts) 和 [`src/dom/adapter.ts`](src/dom/adapter.ts)。

## 本地开发

环境要求：支持 ESM 的 Node.js，以及用于展示页和 GPU 验收的 WebGPU 浏览器。

```bash
npm install
npm test
npm run typecheck
npm run build
npm run dev
```

常用命令：

- `npm run dev`：启动 `examples/navbar` 展示页，默认地址为 `http://127.0.0.1:4173`。
- `npm run test:gpu`：启动 GPU 验收页，使用支持 WebGPU 的浏览器打开终端输出地址并查看 JSON 结果。
- `npm run pack:check`：构建库和展示页，并执行 `npm pack --dry-run` 检查发布内容。

## 验收与限制

CPU 测试用于验证参考算法和边界行为；GPU harness 使用真实浏览器 WebGPU 执行 offscreen readback，并与 CPU 参考结果比较。WebGPU 不可用时，核心 renderer 会报告明确错误，展示页会保留 fallback 状态。

当前项目仍是实验性 public preview：

- 需要浏览器支持 WebGPU 和 `rgba16float` 中间纹理。
- 默认 DOM API 使用 html2canvas；页面快照的准确性仍受跨域资源和复杂 CSS 的限制，也可以由调用者注入捕获实现。
- Inferno 的可变半径两遍近似可能产生条纹或拖抹；不同页面仍需进行实际画质验收。

## 目录结构

- `src/core/`：设备、纹理、参数、渲染生命周期和 CPU 参考实现。
- `src/shaders/`：内嵌 WGSL 渐进高斯采样 shader。
- `src/dom/`：可选的 DOM 刷新、滚动和生命周期适配器。
- `examples/navbar/`：可交互渐变模糊调试台（保留原有目录与启动入口）。
- `tests/`：CPU 单元测试和真实浏览器 GPU 验收入口。
- `docs/`：设计、验收记录和开发路线图。
- `references/inferno/`：固定版本的上游参考源码与许可证。

## 许可与致谢

本项目采用 [MIT License](LICENSE)。核心算法参考 Inferno；上游版权、许可证和来源说明见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。
