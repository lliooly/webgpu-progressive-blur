# Inferno 参考源码

仓库：https://github.com/twostraws/Inferno

固定提交：`a40c7a0bdec03aae1bd0b96c41d6a75451bafd2c`

原始路径映射见 SOURCE.json。此目录的 .metal、.swift 和 LICENSE 从该提交直接下载，未修改。

## 阅读顺序

1. `ProgressiveBlurPreview.swift`：白色到透明的渐变产生 Alpha 遮罩。
2. `View+variableBlur.swift`：视图接口及遮罩生成。
3. `VisualEffect+variableBlur.swift`：公开 radius 乘 3，并执行两遍 layerEffect。
4. `VariableGaussianBlur.metal`：读取 Alpha，计算每个位置的采样范围与高斯权重。

## 移植注意

- 公开 radius 对应 sigma；shader 的 radius 对应约 3 sigma 采样范围。
- 采样间隔为 max(1, radius / maxSamples)，正负双向采样并归一化。
- 半径小于 1 时直接返回原像素，这个阈值针对内部采样范围。
- 半径随位置变化时，两遍顺序会影响结果；原作者明确说明可能发生拖抹。
- 一处注释写 half radius，实际运算是 radius / 3，以代码为准。
- Inferno 已正确传递 normalizeEdges；不要照搬旧 Variablur 的参数传递问题。
- WGSL 端需明确纹理坐标、像素中心、DPR、预乘 Alpha、颜色空间和有效边界。

## 署名

shader 作者为 Dale Price，项目版权声明为 Paul Hudson and other authors。完整许可见本目录 LICENSE。
