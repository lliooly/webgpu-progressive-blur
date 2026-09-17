# 工作清单

## 已完成

- [x] 明确 WebGPU、画质优先及博客导航栏用途。
- [x] 阅读 Inferno 的 Metal shader、Swift 封装及渐变示例。
- [x] 固定上游提交并保存原始源码及 MIT 许可。
- [x] 整理设计与 npm 包交付要求。
- [x] 建立本地准备目录。

## 实现顺序

- [x] 配置 TypeScript、构建及 WebGPU 开发环境。
- [x] 移植 Inferno 参考模式，记录与原运算的差异。
- [x] 实现纵向渐变的导航栏模式，验证两遍顺序。
- [x] 加入小图二维高斯参考与透明边缘测试。
- [x] 通过真实 Chrome WebGPU offscreen readback，验证 Inferno kernel 的坐标、横纵轴、渐进 mask、边界和两遍顺序。
- [x] 读取 `blog-astro`，确定正文与导航栏结构。
- [x] 实现 provider-based DOM 适配、刷新和销毁流程。
- [x] 实现 `attachProgressiveBlur(element, options)` 元素级封装、默认 html2canvas 捕获器、覆盖层和共享 session。
- [x] 将 navbar demo 与内容卡片迁移到统一的元素级 API。
- [x] 构建 ESM、类型声明与内嵌 shader。
- [x] npm pack 并在独立项目安装验证。
- [x] 增加 React / Astro 源码组件 CLI、受管索引、依赖检查和用户文件保护。
- [x] 增加 React 18/19、Astro 静态页与 ClientRouter / `transition:persist` 消费项目编译验证。
- [x] 效果台同步生成框架命令、组件用法和布局说明。
- [ ] 发布 `0.2.0` 并从 npm registry 做全新项目安装验收。
- [ ] 博客真实接入与画质验收（核心算法通过后再重新开始）。

## 当前阶段

- 核心算法严格移植和 CPU/GPU 验收已完成。
- 当前核心、通用 DOM 封装与源码组件分发实现已完成；下一阶段处理 `0.2.0` 发布、真实博客接入、跨域资源策略和目标页面画质验收。

## 发布前信息

- 博客本地路径与目标浏览器。
- 新库作者署名、最终包名及 npm scope。
- 确认公开发布时机，再配置仓库地址及发布流程。
