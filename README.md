# WebGPU Progressive Blur

面向博客顶部导航栏的 WebGPU 渐进模糊 npm 库。参考 Inferno 的 Swift/Metal 实现，用 TypeScript 和 WGSL 重写，提供参考 Alpha mask 模式和导航栏纵向渐变模式。

## 当前状态

核心 blur kernel 已按固定提交的 Inferno Metal 规则重写：使用像素空间坐标、3σ 支持半径、单轴对称采样、边缘权重归一化和独立的两遍 uniforms。CPU 参考与真实 Chrome WebGPU 读回验收均已通过，8 个非方形/渐进 mask case 的最大误差为 0.00093，低于 0.003 阈值。

博客、DOM 捕获和导航栏展示暂不属于本阶段验收。`webgpu-progressive-blur` 仍是本地暂定名称，`private: true` 保留以避免误发布。

## 文档

- [设计与验收](docs/design.md)
- [工作清单](docs/roadmap.md)
- [参考源码导读](references/inferno/README.md)
- [第三方许可与致谢](THIRD_PARTY_NOTICES.md)

## 开发

```bash
npm install
npm test
npm run typecheck
npm run build
npm run dev
```

`npm run dev` 会启动 `examples/navbar` 展示页。页面右下角的 live instrument 可以切换模式、半径、采样数量、渐变范围、pass 顺序和边界归一化。

## 核心 API

模块导入阶段不会访问 `window`、`document` 或 `navigator`；在客户端显式创建 renderer：

```ts
import { createProgressiveBlur } from 'webgpu-progressive-blur';

const blur = await createProgressiveBlur({
  canvas: outputCanvas,
  source: backgroundCanvas,
  mode: 'navbar',
  radius: 16,
  maxSamples: 15,
  verticalPassFirst: true,
  normalizeEdges: true,
  gradient: { start: 0, end: 1, direction: 'top-to-bottom' },
});

blur.render();
blur.setParameters({ radius: 22 });
blur.resize(cssWidth, cssHeight, devicePixelRatio);
blur.destroy();
```

`radius` 的公开语义是 Gaussian sigma，shader 内部使用 `3 × radius` 的支持范围。`reference` 模式读取 mask 的 Alpha；`navbar` 模式直接解析纵向渐变，不需要上传 mask，因此滚动时只更新源纹理。

`webgpu-progressive-blur/dom` 导出 `ProgressiveBlurDomAdapter`。适配器负责字体等待、缓存、resize/theme refresh、滚动同步、错误状态和销毁；DOM 快照由调用者提供，以便博客可以选择适合自身图片、字体和跨域策略的捕获实现。

## 实现取舍

- 中间纹理使用 `rgba16float`，避免两遍之间量化到 8 位。
- WGSL 使用最多 64 个方向样本并在运行时提前退出；采样间隔遵循 Inferno 的 `max(1, supportRadius / maxSamples)`。
- Alpha mask 和有效边缘样本重新归一化；零半径或小于一个物理像素时直接返回原像素。
- 对 `HTMLCanvasElement` / `OffscreenCanvas` 源优先使用带行对齐的 `queue.writeTexture`，保留 DOM 快照的 Alpha；其他外部图像继续走 `copyExternalImageToTexture`。
- 导航栏模式只沿 Y 改变半径，默认先做纵向 pass，再做横向 pass，避免横向 pass 读取不同半径行的中间结果。
- 不支持 WebGPU 时展示页保留清晰的底色并报告 fallback 状态，不伪装为成功渲染。

## 目录

- `src/core/`：设备、纹理、渲染和生命周期。
- `src/shaders/`：WGSL 高斯采样与渐进模糊。
- `src/dom/`：博客背景捕获、缓存及滚动同步。
- `examples/navbar/`：导航栏画质对比及实际接入示例。
- `tests/`：二维参考计算、GPU 和消费项目验证。
- `scripts/`：构建与打包辅助工具。
- `references/inferno/`：固定提交的上游原始文件，仅作学习参考。

## 交付目标

ESM 与 TypeScript 类型声明，内嵌 WGSL，无框架绑定，支持服务端构建时安全导入。核心算法通过后，再进行 npm 包消费和真实 DOM 导航栏验收。

## 许可

计划以 MIT 发布。上游原始许可已保留。新代码作者署名确认后补齐项目根目录 LICENSE，再进行发布检查。
