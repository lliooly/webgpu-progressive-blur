# Inferno Metal 严格移植实现计划

> 依据：`docs/superpowers/specs/2026-09-16-inferno-metal-port-design.md`
> 范围：核心算法、CPU 参考、真实 WebGPU 验收；不修改博客和展示页。

## 1. 建立共享的参数和 pass 契约

文件：

- 新增 `src/core/blur-params.ts`；
- 新增 `src/core/blur-pass.ts`；
- 修改 `src/core/renderer.ts`。

工作内容：

1. 把物理尺寸、`supportRadius`、axis、mask mode、渐变和边界开关的 uniform 打包集中到一个纯函数，保证生产 renderer 和 GPU harness 使用同一布局。
2. 把 bind group 创建、uniform 写入和单遍 render-pass 编码抽成内部 helper；不从根入口导出，不改变公开 API。
3. 保留现有资源生命周期、`rgba16float` intermediate、canvas 输出和 source 上传路径。
4. 让测试 harness 能把同一单遍 pass 写入 `rgba16float` offscreen target，而不是复制另一份 shader 或参数逻辑。

验证：先运行 `npm run typecheck`，确认抽取没有改变现有 renderer 的类型契约。

## 2. 重写 WGSL 为像素空间 Inferno kernel

文件：

- 修改 `src/shaders/variable-blur.wgsl.ts`。

工作内容：

1. fragment 使用 `@builtin(position).xy`，以 `uv = position * texelSize` 读取 source/mask。
2. 添加像素空间采样辅助函数，统一处理中心、正向、负向采样和 layer 外部透明语义。
3. 保留 Metal 的完整 Gaussian 公式、`radius / 3` sigma、`max(1, radius/maxSamples)`、64 次循环上限、`radius < 1` 恒等分支和有效权重归一化。
4. 用统一的 inclusive bounding rect 判断实现 `normalizeEdges`；开启时跳过越界样本，关闭时计入透明外部样本。
5. reference mask 只取 Alpha；navbar 渐变沿同一 `uv.y` 计算。
6. 删除依赖顶点插值 UV 的 blur 坐标路径，保留 fullscreen triangle 仅用于覆盖 render target。

验证：新增 shader 编译验证入口；静态字符串断言只保留必要的常量检查，不再把“包含某段字符串”当作算法验证。

## 3. 让 CPU 参考逐项对应 shader

文件：

- 修改 `src/core/reference.ts`。

工作内容：

1. 用 `(x + 0.5, y + 0.5)` 像素中心重写双线性采样。
2. 采用与 WGSL 相同的连续 UV、mask、inclusive bounds 和透明层外部规则。
3. 使用完整 Gaussian 权重，并固定最多 64 个方向样本。
4. 使单遍 axis、两遍顺序、radius threshold、mask alpha 和边缘归一化均与 shader 同构。
5. 保留 `createGradientMask`，但让它使用相同的 `uv.y` 定义，避免 CPU 与 GPU 各自采用一套渐变坐标。

验证：测试先在 CPU 参考上固定期望值，再用于 GPU 结果比较，避免以当前错误实现作为 oracle。

## 4. 补齐 CPU 行为测试

文件：

- 修改 `tests/reference.test.ts`；
- 必要时新增 `tests/reference-kernel.test.ts`。

工作内容：

1. 覆盖零半径、小于一个像素、常色、Alpha=0 mask、连续渐变和渐变方向。
2. 使用非方形 source 验证 horizontal/vertical 单遍方向，防止 x/y 互换或整体偏移。
3. 使用边缘 impulse 和常色验证 `normalizeEdges=true/false` 的不同采样与归一化。
4. 验证 `maxSamples` 的间隔规则和两遍顺序确实影响对应结果。
5. 删除只检查 WGSL 文本存在某个片段的弱断言，替换为纯函数行为断言。

验证命令：`npm test`。

## 5. 添加真实 GPU offscreen 验收 harness

文件：

- 新增 `tests/gpu/index.html`；
- 新增 `tests/gpu/main.ts`；
- 新增 `tests/gpu/harness.ts`；
- 新增 `vite.gpu.config.ts`；
- 修改 `package.json` 添加 `test:gpu` 入口。

工作内容：

1. 在真实浏览器 WebGPU 环境申请 adapter/device，创建 11×7 非方形 source、mask、intermediate 和 `rgba16float` output texture。
2. 通过共享 pass helper 执行单遍和两遍渲染；source/mask 使用与 CPU fixture 相同的量化数据。
3. 用 staging buffer `copyTextureToBuffer` 读回 output，按 256 字节行对齐解码 half float。
4. 逐通道调用 `progressiveBlurReference` 比较结果，输出最大绝对误差、平均绝对误差、NaN/Inf 和方向检查结果。
5. 使用 `GPUDevice.pushErrorScope`/`popErrorScope` 捕获 shader validation 和 render validation 错误；失败时让 harness 以失败状态结束。
6. 测试矩阵覆盖全 0/全 1/二值/连续 mask、navbar 两个方向、radius 0/小半径/正常/大半径、maxSamples 1/15/64、两种 pass 顺序和两种边缘策略。

验证标准：最大绝对误差 `<= 0.003`、平均绝对误差 `<= 0.00075`，无 NaN/Inf；坐标编码 fixture 不得出现半像素或一像素整体平移。

## 6. 运行回归并更新状态文档

文件：

- 修改 `docs/design.md`；
- 修改 `docs/roadmap.md`；
- 视实现结果更新 `README.md` 的当前状态描述。

工作内容：

1. 运行 `npm test`、`npm run typecheck`、`npm run build`。
2. 启动 GPU harness，在真实 Chrome WebGPU 环境运行并保存终端结果；没有 WebGPU 时明确报告未通过，不降级为“通过”。
3. 运行 `npm pack --dry-run`，确认新增 core 文件和测试辅助不会污染公开包，且不把博客改动纳入提交。
4. 只有 CPU/GPU 验收都通过后，才把 roadmap 中旧的“已完成”改成真实状态；不在本阶段更新博客验证结论。

## 7. 提交边界

实现提交至少分为两类：

1. `refactor(核心算法)`：共享参数/pass、WGSL 和 CPU 参考；
2. `test(核心算法)`：CPU/GPU harness 和验收测试。

每次提交前检查 `git status --short`，确保只包含核心仓库变更。不得创建 worktree，不得修改 `/Users/shishishi/Desktop/blog-astro`。
