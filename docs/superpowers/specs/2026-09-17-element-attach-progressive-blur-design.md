# 元素级 `attachProgressiveBlur` 设计

## 目标

在现有 WebGPU 两遍渐进模糊内核之上，提供一个面向 DOM 的高层 API，使任意元素都能以最少配置获得背景模糊效果：

```ts
const effect = await attachProgressiveBlur(element, {
  radius: 18,
  profile: 'uniform',
});
```

高层 API 自动创建覆盖 canvas、同步尺寸和 DPR、捕获元素背后的页面内容、处理滚动与 resize、报告 WebGPU 状态，并在销毁时清理自身资源和样式。核心 `createProgressiveBlur` API 保持不变。

## 范围

### 包含

- 新增 `attachProgressiveBlur(element, options)`。
- 默认使用 `html2canvas` 捕获 `captureRoot`，支持文档快照缓存。
- 滚动时复用快照，只把当前 overlay 的区域裁剪到 source canvas，再提交 WebGPU 渲染。
- `uniform`、线性渐进和自定义 Alpha mask 三种 profile。
- overlay 的 class、圆角、z-index 和可选 bleed 配置。
- 多个元素共享同一 capture session 和默认 WebGPU device。
- 保留现有 `ProgressiveBlurDomAdapter` 作为低层兼容 API。
- 将 navbar demo 改为使用高层 API，并继续保留 navbar 的渐进和底部 bleed 视觉。

### 不包含

- 直接读取浏览器合成后的真实 backdrop 像素；WebGPU 没有该 DOM 能力。
- 默认使用 `backdrop-filter` 作为替代实现。
- 对任意 CSS、视频、跨域图片、Shadow DOM 的完美截图保证；这些情况仍可通过自定义 `capture` 处理。
- 首版完整的单一 atlas/compositor；共享 session 先解决截图与 device 重复，输出 renderer 仍按元素独立。

## API

### `attachProgressiveBlur`

```ts
const effect = await attachProgressiveBlur(element, {
  radius: 16,
  profile: 'uniform',
  captureRoot: document.body,
  captureStrategy: 'document',
  overlay: { bleed: { bottom: 48 } },
});
```

默认 profile 是 `uniform`，表示整个元素使用相同模糊强度。

```ts
type BlurProfile =
  | 'uniform'
  | {
      type: 'linear';
      start?: number;
      end?: number;
      direction?: 'top-to-bottom' | 'bottom-to-top';
    }
  | {
      type: 'mask';
      source: BlurSource;
    };
```

返回的控制器提供：

- `renderer`：初始化成功时的底层 renderer；WebGPU fallback 时为 `undefined`。
- `canvas`：自动创建的 overlay canvas。
- `status`：`initializing`、`refreshing`、`ready`、`unsupported`、`error` 或 `destroyed`。
- `refresh()`：重新捕获场景，适用于内容、主题或字体变化。
- `render()`：使用缓存的 source 立即重绘。
- `setParameters()`：更新半径、采样数、profile 和边界策略。
- `destroy()`：取消捕获、断开观察者、销毁 renderer、移除 canvas，并恢复库修改的 inline style。

### 捕获接口

默认捕获器接收一个可复用的目标 output canvas，并返回同一个 canvas，避免滚动时分配新 bitmap：

```ts
interface DomElementCaptureRequest {
  element: HTMLElement;
  captureRoot: HTMLElement;
  rect: DOMRectReadOnly;
  width: number;
  height: number;
  pixelRatio: number;
  output: HTMLCanvasElement;
  excludeElements: readonly HTMLElement[];
  reason: 'initial' | 'manual' | 'resize' | 'theme' | 'scroll';
  signal: AbortSignal;
  scroll: DomScrollMetrics;
}

type DomElementCapture = (
  request: DomElementCaptureRequest,
) => Promise<BlurSource> | BlurSource;
```

自定义捕获器可以返回自己的 `HTMLCanvasElement`、`ImageBitmap` 或其他 `GPUCopyExternalImageSource`；返回的 source 必须已经裁剪为当前 overlay 尺寸。

## 渲染和坐标数据流

```text
captureRoot
    ↓  (initial/theme/manual/必要的 resize)
cached scene snapshot
    ↓  (scroll/resize 时根据 overlay DOMRect 裁剪)
reusable source canvas
    ↓  copyExternalImageToTexture
ProgressiveBlurRenderer
    ↓
overlay canvas inside target element
```

overlay canvas 插入目标元素的第一个子节点。目标元素如果没有定位上下文则临时设置 `position: relative`，并设置 `isolation: isolate`；canvas 使用 `position: absolute`、`z-index: -1`、`pointer-events: none`，位于目标背景与前景内容之间。所有临时 inline style 都在 `destroy()` 时恢复。

默认快照使用文档坐标：`document.body`/`documentElement` 的原点为 `(0, 0)`，其它 capture root 根据自身 `DOMRect` 和滚动量换算。目标 overlay 的当前 viewport rect 加滚动量后映射到快照坐标。`captureStrategy: 'document'` 默认只在场景变化时重新截图；`viewport` 策略只保存视口大小快照，滚动时按需重新捕获，适合超长页面但滚动成本更高。

## 性能策略

- 默认 capture session 按 `captureRoot + scrollTarget + captureStrategy` 复用，多个 effect 不重复生成同一场景快照。
- 默认 WebGPU device 在 DOM 入口内部复用；调用者显式传入 `device`/`adapter` 时沿用调用者所有权。
- scroll handler 只安排一个 `requestAnimationFrame`，不在事件同步执行截图。
- source canvas、mask canvas 和 renderer 资源按尺寸复用；同尺寸 resize 为 no-op。
- 默认 source 上传使用 `external`，避免每帧 `getImageData()`；需要保留透明 alpha 兼容行为时可显式使用 `readback`。
- 主题或内容变化只通过 `refresh()` 触发场景重捕获；不默认监听整个页面的 MutationObserver，避免把业务 DOM 更新变成截图风暴。

## 错误与 fallback

- WebGPU 不可用或设备请求失败：返回 `unsupported` 状态并隐藏 overlay，目标元素正常显示。
- html2canvas、跨域资源或自定义 capture 失败：状态为 `error`，保留原始目标内容，并把错误通过 `onStatus` 和 `refresh()` rejection 暴露。
- 已销毁控制器上的方法抛出明确错误。
- 捕获进行中如果开始新的 refresh，旧请求通过 `AbortController` 取消；旧结果不能覆盖新结果。

## 验证

- 纯函数测试：profile 解析、overlay bleed、文档坐标到快照坐标映射、共享 session 生命周期。
- 类型、CPU 单测和 ESM 构建通过。
- navbar demo 通过高层 API 启动、滚动、resize、主题切换和销毁。
- GPU harness 继续验证现有两遍 kernel，新增高层 API 的浏览器 smoke test，确认 overlay canvas 尺寸、source 更新、WebGPU ready/fallback 和无重复截图的滚动路径。

