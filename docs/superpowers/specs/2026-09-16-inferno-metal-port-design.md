# Inferno Metal 严格移植与 CPU/GPU 验收设计

- 日期：2026-09-16
- 状态：设计已获用户批准，等待规格审查后进入实现计划
- 范围：`webgpu-progressive-blur` 核心算法
- 参考：Inferno `a40c7a0bdec03aae1bd0b96c41d6a75451bafd2c`

## 1. 目标与边界

本阶段只解决“模糊算法是否正确”，不修改博客、DOM 捕获、导航栏布局或展示页。目标是让 WebGPU 路径在算法控制流和坐标语义上严格对应 Inferno 的 `VariableGaussianBlur.metal` 与 SwiftUI 两遍封装，并用 CPU 参考和真实 GPU 读回结果验收。

不追求 Metal `half` 与 WGSL `f32` 的逐位相等；需要做到的是同一组输入、采样位置、权重、边界规则和两遍顺序下的可解释数值接近。两遍可变模糊本身可能产生 Inferno 源码所说明的 streak/smear，这不是本阶段通过改算法消除的对象。

## 2. 参考实现到 WebGPU 的对应关系

| Inferno | WebGPU 设计 |
| --- | --- |
| `gaussian(half distance, half sigma)` | WGSL `gaussian(f32, f32)`，保留完整高斯归一化因子；最终仍按有效权重和归一化 |
| `gaussianBlur1D(position, boundingRect, layer, ...)` | 单轴 `blur1D`，使用像素空间位置，采样间隔和正负样本顺序保持一致 |
| `variableBlur(...)` | fragment 入口；先读 mask alpha，再计算当前像素半径，小于 1 时返回原像素 |
| Swift `adjustedRadius = radius * 3` | CPU/renderer 将公开 sigma 转换为物理像素的 `supportRadius = radius * pixelRatio * 3` |
| 两次 `layerEffect` | 第一遍和第二遍使用同一 mask、同一参数，唯一差异是 axis 和目标纹理 |
| `mask.sample(...).a` | reference 模式只读取 mask Alpha，不读取 RGB |

保留现有 `navbar` 解析渐变模式，但它只是 mask 纹理的方便形式，不作为 Inferno 严格等价性的唯一依据。严格验收以 `reference` 模式为主。

## 3. 坐标、采样和边界契约

### 3.1 像素中心

GPU fragment 使用 `@builtin(position).xy` 作为当前像素中心位置，目标纹理物理尺寸为 `params.size`，纹理坐标统一定义为：

```text
uv = pixelPosition / params.size
```

所有 blur offset 都是物理像素，转换到纹理坐标时乘以 `texelSize`。不再通过顶点插值 UV 反推像素位置，以便直接对应 Metal 的 `position` 和 `boundingRect`，并避免非方形纹理、DPR 和边界位置产生隐藏偏移。

CPU 参考使用 `(x + 0.5, y + 0.5)` 作为像素中心，并用同一套连续坐标双线性采样。这样 GPU 的 linear sampler 在整数像素中心和 CPU 参考取样完全对应。

### 3.2 mask 和渐变

reference 模式在 `uv` 上用 linear sampler 读取 mask Alpha。navbar 模式直接对相同的 `uv.y` 求渐变强度；CPU 参考也使用该定义，不能再混用 `y / (height - 1)` 和 `uv.y` 两种坐标。

mask 强度始终 clamp 到 `[0, 1]`，当前像素半径为 `maskAlpha * supportRadius`。半径小于 1 个物理像素时直接返回当前源像素，不进行任何邻域采样。

### 3.3 采样公式

每一遍的核心流程固定为：

```text
interval = max(1, pixelRadius / maxSamples)
sigma = pixelRadius / 3
sum = sample(center) * gaussian(0, sigma)
weightSum = gaussian(0, sigma)

for distance = interval; distance <= pixelRadius; distance += interval:
    weight = gaussian(distance, sigma)
    sample(position + axis * distance) if valid
    sample(position - axis * distance) if valid
    add each accepted sample and weight

return sum / weightSum
```

循环上限保持 64 个方向样本。WGSL 使用 `f32`，但不删除 Metal 中的高斯归一化常数；这让 CPU 参考、shader 和源码阅读都表达同一个公式。

### 3.4 边界

bounding rect 固定为 `[0, 0, width, height]`，比较规则保留 Metal 的 inclusive upper bound：小于最小值或大于最大值才算越界。

- `normalizeEdges = true`：越界 sample 不加入颜色和权重，剩余样本重新归一化。
- `normalizeEdges = false`：越界 sample 保留在权重和中，并通过 WebGPU 的 layer 采样辅助函数按透明层外部处理，避免把纹理最后一列机械复制到边界；这一语义会单独测试。
- 当前 fragment 的 center 必须始终有效；若测试 harness 发现 center 越界，直接报告坐标契约错误，而不是静默使用 clamp。

源颜色按四个通道原样参与高斯平均；测试输入会明确使用不透明或预乘 RGBA，避免把色彩空间转换问题误判成 blur kernel 问题。此阶段不引入新的色彩管理或非线性颜色转换。

## 4. 核心结构调整

### WGSL

将 shader 拆成可读的像素采样辅助函数：

- `pixelPositionToUv`：统一位置到 UV 的转换；
- `sampleSourceAtPixel`：处理 linear sample、越界和透明层外部语义；
- `sampleMaskStrength`：reference Alpha 与 navbar 解析渐变共用坐标契约；
- `gaussian` 与 `blur1D`：只负责 Inferno 的权重和单轴循环；
- fragment 只负责当前半径、axis 和两遍所需的 uniforms。

uniform 继续传递 physical size、texel size、support radius、max samples、axis、mode、gradient 和 normalizeEdges，但参数命名和注释要明确它们是物理像素语义。

### CPU 参考

把现有参考实现改成 shader 的同一坐标模型，而不是另写一个“视觉上相似”的二维算法。双线性采样、mask 坐标、边界判断、透明层外部和两遍顺序都由同一套规则覆盖。

参考函数仍然是慢速测试基准，不作为 WebGPU fallback。其输入半径解释为输入纹理像素中的 sigma；GPU 对 CSS radius 的 DPR 转换在测试调用处显式完成。

### Renderer 与 GPU 测试通路

从 renderer 中抽出共享的 pass 编码和 uniform 打包逻辑，生产渲染和测试 harness 使用同一份 shader、bind group 和参数布局，避免“测试 shader”和“实际 shader”分叉。

新增仅供测试使用的 offscreen GPU 路径：

1. 创建非方形小纹理作为 source 和 mask；
2. 使用 `rgba16float` intermediate/output，避免 8 位 canvas 量化掩盖误差；
3. `copyTextureToBuffer` 读回两遍结果，解码 half float；
4. 与 CPU 参考逐通道比较，并检查 WebGPU validation/compilation error。

该通路不改变公开 API，不接入 `examples/navbar`，也不承担 DOM 或页面截图。

## 5. 验收测试

### CPU 单元测试

- 零半径和小于 1 像素半径保持恒等；
- 常色 RGBA 在两遍后保持不变；
- Alpha mask 为 0 的区域不采样模糊邻域；
- mask/渐变强度按坐标连续且单调；
- 横向 pass 只改变同一行的邻域，纵向 pass 只改变同一列的邻域；
- `normalizeEdges` 的越界剔除、权重归一化和透明层外部行为分别覆盖；
- 两遍顺序在纵向渐变 mask 上产生可解释的不同结果，且顺序参数确实改变 axis。

### GPU 对 CPU 验收

使用至少一个非方形、带坐标编码和局部高频细线的 11×7 fixture，覆盖：

- reference Alpha mask：全 0、全 1、二值边界、连续渐变；
- navbar top-to-bottom 与 bottom-to-top；
- radius 为 0、低于 1 像素、正常半径和大半径；
- `maxSamples` 为 1、15、64；
- horizontal-first、vertical-first；
- normalizeEdges 开启和关闭；
- 物理宽高不相等，防止 x/y 错位被方形测试掩盖。

对同一 source/mask 和同一参数比较 CPU/GPU：`rgba16float` 读回结果的最大绝对误差不超过 `0.003`，平均绝对误差不超过 `0.00075`，且不得出现 NaN/Inf。阈值解释 f32 计算、GPU linear filtering 和 half-float 输出量化，不允许用模糊的肉眼截图替代。

额外验证：坐标编码输入的输出不能整体平移半个或一个像素；固定 source 和渐变 mask 时，改变 pass 顺序只能产生算法规定的顺序差异，不能产生 axis 交换或 UV 翻转。

## 6. 错误处理和交付边界

- shader 编译或 WebGPU validation 失败时，GPU 验收命令失败并报告错误，不把“没有 GPU”视为通过；
- 本地没有 WebGPU 运行环境时，CPU 测试仍可运行，但交付状态必须明确标记 GPU 验收未完成；
- 本阶段不修改 `examples/navbar`、`src/dom`、博客仓库和导航栏视觉样式；
- 不引入二维全卷积、不尝试消除 Inferno 已知的两遍 streak/smear、不做性能优化优先于数值正确性；
- 实现完成后再更新 `docs/design.md`、`docs/roadmap.md` 和 README 中当前状态，避免文档先宣称未验证的 GPU 结果。

## 7. 成功标准

只有同时满足以下条件才算本阶段完成：

1. WGSL 的采样流程、坐标、半径和边界控制流与 Inferno Metal 对齐；
2. CPU 参考覆盖上述规则且测试通过；
3. 真实 WebGPU 读回通过误差阈值、方向、渐进和边界测试；
4. 生产 renderer 与 GPU harness 使用同一份 shader/pass 编码；
5. 没有用博客展示页的“看起来能动”替代核心算法验收。
