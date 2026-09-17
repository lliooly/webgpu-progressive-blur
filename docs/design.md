# WebGPU 渐进模糊 npm 库：Inferno 移植设计

## 目标与范围

为个人博客导航栏研究高质量渐进模糊。最终交付可由博客项目安装引用的 npm 库，含框架无关的 TypeScript/WebGPU 内核、导航栏背景适配、可运行对比页面、算法说明和许可证文件。先完成内核验证，再完成博客适配，不能把前一阶段等同于最终交付。以文字滚过顶部导航栏的质感为主要验收依据。

首版输入为图片、Canvas 或调用者提供的 GPUTexture；库同时提供元素级 DOM 封装和可替换的捕获接口。真实博客的跨域资源策略与最终视觉结果仍需在目标站点单独验收。

## 已核实的参考实现

主要参考仓库：https://github.com/twostraws/Inferno

历史来源：https://github.com/daprice/Variablur

固定参考提交：a40c7a0bdec03aae1bd0b96c41d6a75451bafd2c

- `Sources/Inferno/Shaders/Blur/VariableGaussianBlur.metal`：一维高斯采样、遮罩 Alpha 调半径、有效权重归一化。
- `Sources/Inferno/SwiftUI/VisualEffect+variableBlur.swift`：两遍图层滤镜，控制横纵顺序；公开 radius 乘以 3 再传 shader。
- `Sources/Inferno/SwiftUI/View+variableBlur.swift`：生成遮罩并提供 View 接口。
- `Sandbox/Inferno/ShaderPreviews/ProgressiveBlurPreview.swift`：以白色到透明的线性渐变生成 Alpha 遮罩。
- `LICENSE`：MIT，Copyright (c) 2023 Paul Hudson and other authors；shader 文件标注 Created by Dale Price。

算法：公开 radius 表示 sigma，采样范围为 3 sigma；间隔为 max(1, supportRadius / maxSamples)，正负对称采样，最终除以有效权重和。遮罩读取的是 Alpha，而非 RGB 灰度。shader 对小于 1 的采样范围直接返回原像素。

原实现的两遍可变模糊可能产生条纹和拖抹，源码明确说明了这一点。与之前读取的 Variablur 相比，Inferno 的 View 图像遮罩重载已正确传递 normalizeEdges。核心采样逻辑仍相同。Metal 中一处注释写“half the blur radius”，实际表达式为 radius / 3，移植以运算为准。

## 方案选择

1. 推荐：参考实现移植 + 导航栏专用模式 + 小图二维参考计算。可追踪差异，也能验证画质。
2. 仅逐行移植：开发最少，但会继承原实现的近似与边界问题。
3. 所有画面使用直接二维采样：参考价值高，但大半径成本随采样网格面积增长，初版不作为默认渲染路径。

## 架构

- TypeScript 层：设备初始化、纹理上传、尺寸与 DPR 换算、参数更新、资源释放。
- WGSL 层：归一化高斯采样、遮罩或解析纵向曲线、两遍渲染。
- 对比页面：原始图像、移植模式、导航栏模式；文字、细线、彩色边缘、透明边缘及模拟滚动。
- 文档：Swift/Metal 到 TypeScript/WGSL 的对应关系、已知近似、来源与改动记录。

数据流：输入纹理 → 第一遍 → 浮点中间纹理 → 第二遍 → Canvas。

## 两种运行模式

### 参考移植模式

保留原算法的采样间隔、半径阈值和横纵顺序切换。使用 f32 计算并记录与原 half 精度的差异，不宣称与 Metal 逐像素一致。

### 导航栏模式

模糊半径仅为纵坐标的函数。优先验证纵向第一遍、横向第二遍：横向采样不会跨越不同半径的行，可避免横向先行时读取不同半径中间结果的问题。这一结论依赖半径仅随 y 变化；不能推广到任意二维遮罩。

保留连续半径曲线，分别验证小半径和采样数量变化时的连续性。通过与直接二维离散高斯参考比较决定是否采用采样调整，不能仅凭肉眼确认数值正确。

## 颜色、边界和错误处理

- 明确输入颜色空间、预乘 Alpha 和输出转换，中间缓冲使用 rgba16float，避免两遍之间反复量化到 8 位。
- 对浏览器 2D canvas 源使用带 256 字节行对齐的 `queue.writeTexture`，避免部分 Chrome 外部图像拷贝路径丢失 Alpha；ImageBitmap 等其他源保留零拷贝外部图像上传路径。
- radius 使用 CSS 像素语义，在渲染层转换到纹理像素。
- 区分原图边界与导航栏显示裁剪，保留必要的采样余量。
- 为有效范围内采样重新归一化；明确 clamp 与透明边缘的不同语义。
- 不支持 WebGPU、设备丢失、输入无效时返回明确状态；演示展示原始背景及失败原因，不伪装成成功渲染。
- 不发布 npm 包、不创建远程仓库；当前目录下进行首版实现，不使用 worktree。

## 验证

- 常色图模糊后颜色保持；零半径恒等；透明边缘不引入黑边。
- 小纹理使用 CPU 二维离散高斯参考，对比相同采样、边界、颜色空间下的数值误差。
- 验证纵向先行的导航栏模式与二维参考，横向先行作为对照。
- 检查 WGSL 编译与 GPU 验证错误，实际浏览器运行后再报告画质结果。
- 视觉验收：清晰端残影、灰团突变、条纹、滚动时闪烁、顶部边界异常。
- 记录设备、DPR、尺寸、半径、采样数量和帧耗时，不以降低画质换取预设性能指标。

## 2026-09-16 核心算法复验

- WGSL fragment 改用 `@builtin(position)` 的像素空间坐标，CPU 参考使用同一像素中心和双线性采样定义。
- uniform/pass 编码已共享；两遍分别使用独立 uniform buffer，避免提交前第二次 `queue.writeBuffer` 覆盖第一遍的 axis 和参数。
- 新增真实 WebGPU offscreen readback harness，覆盖非方形纹理、横纵单轴、reference Alpha mask、navbar 双方向、渐进半径、边缘归一化和透明外部。
- Chrome WebGPU 验收通过 8 个 case，最大绝对误差 `0.00093`，平均误差均低于 `0.00075`，无 NaN/Inf。
- 该结果只证明核心 kernel；博客 DOM 捕获、导航栏对齐和展示页仍需在核心稳定后单独验收。

## 许可证与致谢

新库建议采用 MIT。THIRD_PARTY_NOTICES 保留 Inferno 的版权及完整 MIT 许可，shader 适配说明保留 Dale Price 作者信息，并记载 Variablur 的历史来源；若使用其独有代码，同样保留相应许可。README 引用 Inferno 的固定提交、文件与修改说明。上述文件必须进入 npm 发布产物。新库署名使用用户确认的身份。

若后续引入其他实现，单独核对相应版本与许可证。致谢不能代替保留许可文本。


## npm 包与博客接入

- 使用单个 npm 包，核心入口和 `/dom` 适配入口分开；只使用 GPU 内核时不会加载 DOM 捕获代码，DOM 入口提供默认 html2canvas 捕获器。
- 输出 ESM JavaScript 与 TypeScript 声明；WGSL 内嵌为字符串，调用项目无需配置 shader loader。
- 模块导入阶段不访问 window、document 或 navigator；客户端显式初始化，支持博客的服务端构建流程。
- 提供创建、更新参数、替换输入、调整尺寸、销毁的生命周期接口；DOM 入口额外提供 `attachProgressiveBlur`、refresh、overlay 管理、共享场景快照和错误状态。
- DOM 适配负责背景捕获、缓存、滚动位置映射、图片/字体加载、主题变化与尺寸变化后的刷新。具体捕获依赖需先在真实博客验证视觉一致性再选定。
- GPU 内核与 DOM 捕获通过纹理来源接口连接，允许博客提供自己的背景来源。
- 不支持 WebGPU 时，导航栏应保留可读的底色并报告能力状态。
- 建库时使用临时本地包名；公开包名和 npm scope 在发布前确定。
- 必须通过 npm pack 检查包内容，并在独立消费项目安装生成的 tgz，验证类型、构建和浏览器执行。直接引用源码不算包安装验证。
- 最终验收包含真实 DOM 滚动正文、图片加载、主题切换、resize、销毁重建，并验证 npm 包确实被博客消费。
- 已读取本地 `blog-astro` 博客仓库并确认导航结构；通用 DOM 封装使用 html2canvas 默认捕获器和滚动裁剪，真实博客的跨域资源与最终视觉结果仍需在目标站点单独验收。
- 实现、打包和本地安装验证属于开发范围；发布注册表及创建远程仓库是后续步骤。
