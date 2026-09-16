# WebGPU Progressive Blur

为个人博客导航栏开发的 WebGPU 渐进模糊 npm 库。参考 Inferno 的 Swift/Metal 实现，用 TypeScript 和 WGSL 重写。

## 当前状态

项目准备阶段。已整理设计、参考源码和许可证，尚未实现 WGSL、构建流程或 DOM 捕获。当前不能作为可运行的模糊库使用。

`webgpu-progressive-blur` 是本地暂定名称，未核验 npm 名称可用性；`private: true` 防止准备阶段误发布。未安装依赖，未初始化 Git，未创建远程仓库。

## 文档

- [设计与验收](docs/design.md)
- [工作清单](docs/roadmap.md)
- [参考源码导读](references/inferno/README.md)
- [第三方许可与致谢](THIRD_PARTY_NOTICES.md)

## 目录

- `src/core/`：设备、纹理、渲染和生命周期。
- `src/shaders/`：WGSL 高斯采样与渐进模糊。
- `src/dom/`：博客背景捕获、缓存及滚动同步。
- `examples/navbar/`：导航栏画质对比及实际接入示例。
- `tests/`：二维参考计算、GPU 和消费项目验证。
- `scripts/`：构建与打包辅助工具。
- `references/inferno/`：固定提交的上游原始文件，仅作学习参考。

## 交付目标

ESM 与 TypeScript 类型声明，内嵌 WGSL，无框架绑定，支持服务端构建时安全导入。以 npm pack 生成的包进行独立安装测试，最终验证博客真实 DOM 导航栏。

## 许可

计划以 MIT 发布。上游原始许可已保留。新代码作者署名确认后补齐项目根目录 LICENSE，再进行发布检查。
