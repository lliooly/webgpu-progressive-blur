# 更新记录

## 0.1.1 — 首次 npm 发布

- 提供框架无关的 WebGPU 渐变模糊渲染器、DOM 挂载入口与 WGSL 导出。
- 新增 navbar、sidebar、bottom-bar、caption、edge、panel 六类组件预设，自动处理渐隐外延与遮罩尺寸。
- 支持 radial、directional 程序化 profile，保留原有 uniform、navbar、linear 和自定义 mask。
- 预设效果台实时生成安装命令、JavaScript、HTML / CSS，并支持复制。
- 补齐 ESM 入口、TypeScript 声明、WebGPU 类型兼容说明、打包前构建和发布前检查。
- 增加预设几何、真实 Canvas 遮罩与 DOM 生命周期验证。

已知限制：默认 DOM 捕获依赖 html2canvas 和场景快照；动态背景需刷新，复杂 CSS、跨域图片与视频需单独验证。无 WebGPU 时保留原页面，不自动执行 CPU 模糊。
