# 首版组件预设与效果台

用户已确认首版沿用 webgpu-progressive-blur@0.1.1，并要求效果台提供与当前配置一致的安装和接入代码。当前工作区直接开发，不创建 worktree。

## API 与范围

DOM attachProgressiveBlur 增加 preset、placement、transition。预设包括 navbar、sidebar、bottom-bar、caption、edge、panel。组件内部保持全强度，按 placement 的反方向增加 transition CSS px 外延，在外延区域渐隐。panel 为均匀模糊。预设与 profile / overlay.bleed 互斥，已有 API 保持兼容。

新增 radial / directional profile，内部管理与缓存遮罩；不改变 Shader 或核心渲染契约。尺寸、DPR 和配置变化使遮罩失效。

## 效果台

默认显示 navbar，支持六类组件预设和形状实验。组件预览直接调用公开 DOM 预设 API，并注入照片 Canvas 捕获器。代码面板由同一配置生成 npm install、JavaScript 和 HTML / CSS，包含挂载、刷新、清理提示及剪贴板失败处理。接入示例默认使用 DOM 场景捕获，不复制 demo 专用 Canvas 捕获器。

## 发布

修正 main/types，公开 ESM exports，不强制注入 WebGPU 全局类型，旧版 TS 按文档补充 @webgpu/types；prepack 构建库，prepublishOnly 执行类型、单测、构建。发布前检查真实 GPU、预设生命周期、移动端、复制代码和独立消费项目。账号登录由用户完成，已授权公开发布 0.1.1。

后续优化以真实页面捕获性能、滚动刷新和图像质量为重点，本次不引入框架组件或重写算法。
