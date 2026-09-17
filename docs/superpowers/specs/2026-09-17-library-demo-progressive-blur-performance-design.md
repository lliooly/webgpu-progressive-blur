# 库与 Demo 的渐进模糊性能优化设计

## 背景

当前渐进模糊渲染器在每帧执行时，会重复创建两个 blur pass 的 bind group，并在同尺寸 resize 请求中重复重建中间纹理与上传纹理。Canvas 源还默认走 `getImageData()` CPU 回读路径；这条路径兼容性较好，但会把浏览器的 GPU 内容拉回 CPU，再重新上传到 GPU，在大负载下会放大延迟。

博客版本已经验证了一套更轻的滚动热路径：滚动时只更新必要的源切片，使用 `copyExternalImageToTexture()` 把不透明 Canvas 直接上传到 GPU，并缓存不变的引用遮罩。核心库和 navbar demo 需要在不破坏已有调用方 alpha 语义的前提下吸收这套逻辑。

## 目标

1. 在核心库中缓存稳定的 GPU bind group，避免每个 blur pass 每帧重新创建。
2. 让同一物理尺寸和 DPR 的重复 `resize()` 变成 no-op。
3. 为 Canvas 源增加可选的直传模式，同时保留默认 CPU 回读模式，避免改变已有 alpha 行为。
4. 为非 GPU 引用遮罩增加可选缓存和显式 `invalidateMask()`，让调用方控制遮罩内容何时变化。
5. 让 navbar demo 的滚动处理只调度渲染，不在 scroll handler 里重复绘制源切片。
6. 保持库的现有 GPUTexture、Canvas、ImageBitmap 等输入方式和公开 API 向后兼容。

## 非目标

- 本次不改变 shader 的采样算法、模糊视觉效果或参数含义。
- 本次不把所有 Canvas 默认切换到直传模式；默认值仍然优先保障已有 alpha 语义。
- 本次不引入 `backdrop-filter` 或依赖浏览器原生实时 backdrop 计算。
- 本次不修改 blog-astro；blog 版本作为已验证的参考实现保留。

## 公开 API 设计

在 `ProgressiveBlurOptions` 增加：

```ts
canvasUploadMode?: 'readback' | 'external';
cacheMask?: boolean;
```

- `canvasUploadMode` 默认是 `'readback'`。`'readback'` 保持当前 Canvas CPU 回读行为；`'external'` 使用 `copyExternalImageToTexture()`，适合内容不依赖透明度的 Canvas 源。
- `cacheMask` 默认是 `false`。启用后，非 GPU 的 mask 在首次上传后复用，直到 `setMask()`、resize 或 `invalidateMask()`。

在 `ProgressiveBlurRenderer` 增加：

```ts
invalidateMask(): void;
```

调用方在原地修改了 Canvas、ImageBitmap 等 mask 内容后调用该方法，通知渲染器下一帧重新上传。

## 核心库实现

### 1. Bind group 缓存

每个 blur pass 保留一条缓存记录，记录 source texture、mask texture 和 bind group。只要两张纹理身份不变，就复用 bind group；`setSource()`、`setMask()`、resize 和 destroy 会清空缓存。参数更新只写 uniform buffer，不会使 bind group 失效。

`blur-pass.ts` 把 bind group 创建提取为可复用的 `createBlurBindGroup()`。`encodeBlurPass()` 仍支持没有缓存的调用，保持 GPU 测试 harness 和内部调用的兼容性。

### 2. resize 去重

`resize()` 先把 CSS 尺寸和 DPR 归一化为物理宽高；如果已有资源且三者都没有变化，直接返回，不重新配置 context，也不销毁和创建纹理。真正发生尺寸变化时，重建资源并使 mask 上传状态失效。

上传纹理增加 `RENDER_ATTACHMENT` usage，以满足 Chromium/Dawn 对 `copyExternalImageToTexture()` 目标纹理的校验，同时保留 `COPY_DST` 和 `TEXTURE_BINDING`。

### 3. Canvas 上传模式

GPUTexture 直接作为 source/mask 使用时保持不变。Canvas、ImageBitmap、VideoFrame 等外部源在 `'external'` 模式下直接使用 `copyExternalImageToTexture()`；默认 `'readback'` 仍先尝试 Canvas 2D `getImageData()`，失败时回退到 external copy。

### 4. mask 缓存

GPUTexture mask 不需要上传。非 GPU mask 在 `cacheMask: true` 时记录源身份和 dirty 状态：首次使用或显式失效时上传，后续帧复用上传纹理。resize 和 setMask 自动标记 dirty。

## navbar demo 实现

- source Canvas 是不透明页面快照，renderer 使用 `canvasUploadMode: 'external'`。
- demo 使用 `cacheMask: true`；只有 reference 模式且渐变几何发生变化时才重绘 mask，并在内容更新后调用 `invalidateMask()`。
- scroll handler 只调用 `scheduleRender()`。每帧由 render loop 统一执行源切片、必要的尺寸同步、必要的参数更新和最终渲染。
- 参数输入、模式切换、resize 会设置 dirty 标记；没有变化的帧不重复调用 `setParameters()`。
- demo 自己也去重 renderer resize，核心库的 resize 去重作为第二道保护。

## 兼容性与风险控制

- 默认 Canvas 上传模式不变，避免透明 Canvas 的 alpha 合成结果被直传路径改变。
- 直传模式由调用方显式选择；demo 的 source Canvas 明确为不透明快照，因此适合该模式。
- `cacheMask` 默认关闭，已有调用方每帧更新 mask 的行为不变；启用缓存后由调用方通过 `invalidateMask()` 管理原地修改。
- 需要验证 TypeScript 类型、单元测试、npm 构建，以及在支持 WebGPU 的浏览器中验证 direct upload 和 demo 滚动交互。

## 验证计划

1. `npm run typecheck`
2. `npm test`
3. `npm run build:lib`
4. `npm run build` 或对 demo 执行等价 Vite 构建
5. `npm run test:gpu`，确认公开 renderer 的 direct Canvas upload 路径仍能输出有效像素
6. 启动 navbar demo，在浏览器中滚动、resize、切换 mode 并调整 radius/edge，确认无 console error 且渲染状态保持 ready
