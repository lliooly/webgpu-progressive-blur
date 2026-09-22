# 更新记录

## 0.2.1 — 修复 DOM 捕获

- 修正非文档捕获根的目标裁剪坐标，避免嵌套滚动容器中的模糊背景发生错位。
- 默认 DOM 捕获改用 `html2canvas-pro`，支持现代 CSS 颜色函数并减少复杂页面捕获失败。

## 0.2.0 — 已发布

- 新增 `webgpu-progressive-blur add` 源码组件 CLI，支持 React / Astro、单个/多个/全部预设、`--dir`、`--dry-run`、`--no-install` 和安全的已有文件保护。
- React 模板支持 React 18/19 兼容的 `forwardRef`、StrictMode 异步清理、参数重挂载和 `refreshKey`；Astro 模板支持普通页面、ClientRouter、`transition:persist`、BFCache 和可见错误状态。
- 增加共享异步生命周期、受管导出索引、semver 运行时检查、消费项目 fixtures 和效果台纯函数代码生成。
- 更新效果台、README 与路线图，明确本地可编辑源码不会随 npm 更新自动覆盖。

## 0.1.1 — 首次 npm 发布

- 提供框架无关的 WebGPU 渐变模糊渲染器、DOM 挂载入口与 WGSL 导出。
- 新增 navbar、sidebar、bottom-bar、caption、edge、panel 六类组件预设，自动处理渐隐外延与遮罩尺寸。
- 支持 radial、directional 程序化 profile，保留原有 uniform、navbar、linear 和自定义 mask。
- 预设效果台实时生成安装命令、JavaScript、HTML / CSS，并支持复制。
- 补齐 ESM 入口、TypeScript 声明、WebGPU 类型兼容说明、打包前构建和发布前检查。
- 增加预设几何、真实 Canvas 遮罩与 DOM 生命周期验证。

已知限制：默认 DOM 捕获依赖 html2canvas-pro 和场景快照；动态背景需刷新，复杂 CSS、跨域图片与视频需单独验证。无 WebGPU 时保留原页面，不自动执行 CPU 模糊。
