# React / Astro 源码组件分发：规格与实现计划

> 交付目标：用户从预设效果台选择效果，用一条 `npx` 命令把可编辑组件加入自己的项目，再在页面中导入。
>
> 本文是实现交接文档，不是功能完成声明。只支持 React 和 Astro，不支持 Vue。本轮只新增本文件，不修改实现或发布包。

- 编写日期：2026-09-17。
- 工作区：`webgpu-progressive-blur`，检查时 HEAD 为 `22a73fa`，另有未提交改动。
- 已确认发布的基础版本：`0.1.1`。
- 当前工作区 `package.json` 已是 `0.2.0`，包含 CLI 与模板草稿；本文不据此认定 `0.2.0` 已发布。
- 实施前检查 `git status` 和 npm registry；若目标版本已发布，使用新的版本号，不覆盖不可变的 npm 版本。
- 本文的命令以目标版本 `0.2.0` 举例；后续若更换版本，统一替换。

## 1. 已确定的产品边界

### 1.1 必须实现

1. `add` 不指定预设时，添加全部六类组件。
2. 指定预设时，只添加对应组件及必要共享文件。
3. 组件写入应用的 `src/components/progressive_blur/`；项目没有 `src/` 时写入 `components/progressive_blur/`。
4. 支持 `--dir` 自定义输出目录。
5. 识别 React / Astro，也支持 `--framework` 明确指定。
6. 用户可修改生成的组件源码；再次执行命令默认保留修改。
7. CLI 安装必要的运行时依赖；组件从 npm 包调用 WebGPU 内核。
8. React 处理挂载、卸载和参数变化；Astro 处理普通页面、客户端路由和节点移除。
9. 效果台生成与当前预设、框架、参数一致的命令和组件用法。
10. 用发布 tarball 在独立 React / Astro 项目中验证，而非只验证仓库内部的路径别名。

### 1.2 本次明确不做

- Vue、Svelte、Solid、Angular 等模板。
- 创建完整业务导航、菜单逻辑、播放器或聊天框；我们提供效果容器，不替用户实现业务组件。
- 把 WGSL、renderer 和 html2canvas 全部复制到用户项目。
- `npm install` 后静默向用户源码目录写文件；不使用 `postinstall` 生成组件。
- 修改 Shader 算法、重做 DOM 捕获方案、系统性性能优化。
- 自动更新已生成源码、自动合并用户组件修改、自动迁移项目框架。
- 自动安装 React、React DOM、Astro 或配置它们的集成。
- 全功能 shadcn registry、`components.json` 兼容层或 Tailwind 依赖。
- 同一输出目录混放 React 和 Astro 组件；混合项目应使用不同 `--dir`。
- 在所有 monorepo 子项目中扫描并安装。CLI 只操作当前应用目录。
- 首版源码 CLI 不提供圆形、八方向组件名；形状实验保留 DOM API 代码导出。

### 1.3 三层职责

| 层 | 存放位置 | 职责 | 更新方式 |
| --- | --- | --- | --- |
| 渲染内核 | npm 包 `dist/` | WebGPU、遮罩、DOM 捕获和资源管理 | 升级 npm 依赖 |
| 可编辑组件 | 用户项目 `components/progressive_blur/` | 生命周期封装、布局和预设默认值 | 用户编辑；CLI 默认不覆盖 |
| CLI 与模板 | npm 包 `cli/`、`templates/` | 检测项目、生成源码、安装依赖 | 执行指定版本的 CLI |

升级 npm 包不会自动更新本地组件。必须在 README 与 CLI 输出中说明这个区别。

## 2. 当前代码基线与缺口

以下结论来自文件检查，不等同于已验证功能正确。

| 文件 | 已有内容 | 后续重点 |
| --- | --- | --- |
| [package.json](../../../package.json) | `0.2.0`、`bin`、`cli/templates` 发布清单、Node engines | 核验发布版本、bin 权限、tarball 内容、运行时版本规则 |
| [cli/index.mjs](../../../cli/index.mjs) | 参数解析、框架检测、生成目录、包管理器选择、跳过覆盖 | 拆分预检查；依赖兼容性；索引冲突；失败恢复；dry-run |
| [cli/templates.mjs](../../../cli/templates.mjs) | 六预设映射、模板读取、包装组件与 export 生成 | 收紧预设 props 类型；与效果台共用组件命名规则 |
| [templates/shared/lifecycle.ts](../../../templates/shared/lifecycle.ts) | 同节点 Promise 串行挂载、异步销毁 | 状态上报、刷新契约、失败后重挂载、BFCache 行为 |
| [templates/shared/layout.ts](../../../templates/shared/layout.ts) | 六预设基础布局 | 明确内联 style 优先级，不误称普通 class 可覆盖内联值 |
| [templates/react/progressive-blur.tsx](../../../templates/react/progressive-blur.tsx) | useEffect 挂载、props 变化重建 | StrictMode 异步竞态；ref；错误与刷新接口；消费项目编译 |
| [templates/astro/progressive-blur.astro](../../../templates/astro/progressive-blur.astro) | 自定义元素、slot、data-options | 页面切换、持久节点刷新、异常 JSON、重复注册 |
| [examples/navbar/studio.ts](../../../examples/navbar/studio.ts) | 已有框架切换与代码生成草稿 | import 路径、预设/框架映射、默认布局和导出测试 |
| [tests/cli.test.ts](../../../tests/cli.test.ts) | 添加全部/单个、保留文件、目录、参数、symlink、包管理器测试 | 扩展为本文验收矩阵 |
| [src/dom/element.ts](../../../src/dom/element.ts) | 公开 attach / refresh / render / destroy API | 尽量保持不变；发现框架接入所需的实际缺陷才做最小修复 |

尤其注意：当前主项目的 `tsconfig.json` 不包含 `templates/`，所以 `npm run typecheck` 通过不能证明生成的 `.tsx` / `.astro` 能编译。

当前草稿需要检查的具体问题：

- `cli/index.mjs` 硬编码运行时 `^0.1.1`，不能据此自动保证后续模板兼容。
- 只要 `dependencies` 已包含包名就跳过安装，没有检查版本是否满足模板。
- 包管理器合法性在部分写入之后才检查，应前移。
- `index.ts` 用组件名称正则判断是否已导出，注释或其他变量中的同名文本可能误判。
- 仅用 `existsSync` 检查 symlink 会漏掉悬空符号链接，应用 `lstat` 并处理 ENOENT。
- 共享生命周期仅在初始化后更新一次 `data-blur-state`，后续刷新状态可能不同步。
- React 草稿对参数变化采用重建策略；本版本可以接受，但不能宣称原地高性能更新。
- Astro 的连接/断开回调不足以覆盖所有 `transition:persist` 场景；背景换页后仍需要刷新。
- 效果台的统一相对 import 字符串不能假定在所有页面目录中都可直接使用。

## 3. CLI 的最终契约

### 3.1 命令

```bash
# 全部六类预设
npx webgpu-progressive-blur@0.2.0 add

# 一个或多个预设
npx webgpu-progressive-blur@0.2.0 add navbar
npx webgpu-progressive-blur@0.2.0 add navbar sidebar

# 显式指定框架与目录
npx webgpu-progressive-blur@0.2.0 add navbar --framework react
npx webgpu-progressive-blur@0.2.0 add navbar --framework astro --dir src/components/progressive_blur

# 只预览、不写文件、不安装
npx webgpu-progressive-blur@0.2.0 add navbar --dry-run

# 不执行依赖安装
npx webgpu-progressive-blur@0.2.0 add navbar --no-install

# 明确覆盖本次涉及的源码文件
npx webgpu-progressive-blur@0.2.0 add navbar --force
```

`npm install webgpu-progressive-blur navbar` 不是有效的预设选择语法：npm 会把它视为两个依赖。普通 `npm install webgpu-progressive-blur` 继续只安装库，不生成源码。

| 输入 | 规定行为 |
| --- | --- |
| 无参数、`-h`、`--help` | 显示帮助，退出 0，不写文件 |
| `add` 无名称 | 按固定顺序添加六个预设 |
| 重复名称 | 去重，保留首次出现顺序 |
| 未知名称/命令/flag、缺少 flag 值 | 清楚报错，退出 1，零写入 |
| `--framework vue` | 明确只支持 React/Astro，退出 1，零写入 |
| 当前目录无 package.json 或 JSON 损坏 | 报错，零写入；不向上寻找其他应用 |
| 重复的 `--dir` 或 `--framework` | 报错，避免隐式最后一个覆盖前一个 |
| 安装成功但仅跳过已有文件 | 退出 0，输出保留列表 |
| 包管理器安装失败 | 退出 1，说明文件是否已写入及恢复命令 |

### 3.2 框架识别

优先级固定为：

1. 显式 `--framework`。
2. 当前应用 dependencies/devDependencies 含 `astro` → Astro。
3. 含 `react` → React。
4. 无法识别 → 报错并给出两个合法命令，不静默假定 React。

Astro 项目可能同时有 React 集成，因此自动检测 Astro 优先。显式 `--framework react` 可用于 Astro 的 React islands，但 CLI 不负责添加 `@astrojs/react`。普通项目没有对应框架依赖时，显式参数仍可生成模板，但输出“框架依赖需由项目自行准备”的提示。

### 3.3 输出结构

仅添加 React navbar：

```text
src/components/progressive_blur/
  lifecycle.ts
  layout.ts
  progressive-blur.tsx
  progressive-blur-navbar.tsx
  index.ts
```

仅添加 Astro navbar：

```text
src/components/progressive_blur/
  lifecycle.ts
  layout.ts
  progressive-blur.astro
  progressive-blur-navbar.astro
  index.ts
```

添加全部时，额外生成 `sidebar`、`bottom-bar`、`caption`、`edge`、`panel` 对应包装文件。只有必要的共享文件，不复制其他预设包装。

`index.ts` 是便利导出；Astro 文档优先展示直接导入 `.astro` 文件，减少对 barrel import 支持的依赖。React 支持统一导出及单文件导入。

### 3.4 路径与文件保护

- `--dir` 相对当前应用根目录解析，只允许其内部子目录；拒绝根目录本身、目录穿越和项目外路径。
- 预检查目录链和每个目标文件，拒绝符号链接、悬空链接以及目录/文件类型冲突。`--force` 不豁免这些检查。
- 重复生成时，默认保留已有基础组件、共享文件和预设文件，明确输出 `Kept`。
- `--force` 仅覆盖本次文件集合，不能清理目录或删除未选择预设。
- 在输出中明确提醒：单个预设使用 `--force` 也可能覆盖该目录的共享 `lifecycle.ts` / `layout.ts`，影响其他已安装组件。
- 发现另一框架的基础文件时拒绝写入，即使有 `--force`；要求使用独立目录。
- 写入前完成参数、框架、路径、索引、依赖计划与包管理器检查。
- 使用同目录临时文件 + rename，防止单文件内容被中断截断。整个批次不承诺跨文件原子事务；I/O 失败必须输出已写入文件列表。

### 3.5 索引合并

不要再通过“文件中出现组件名称”判断导出是否存在。

建议使用受管理区块：

```ts
// progressive-blur:exports:start
export { ProgressiveBlur } from './progressive-blur';
export type { ProgressiveBlurProps } from './progressive-blur';
export { ProgressiveBlurNavbar } from './progressive-blur-navbar';
// progressive-blur:exports:end
```

- 初次创建时使用这个区块。
- 后续读取已有受管理导出并合并新预设，保留其他预设，去重并稳定排序。
- 区块外的用户代码逐字保留。
- 区块重复、损坏、含无法识别的用户逻辑时停止，不能猜测改写。
- 旧草稿生成的无区块索引：只识别完全匹配已知模板的完整 export 行；可迁移这些行，其余内容保留。
- 遇到同名用户 export 且无法确认指向正确文件时，报冲突并提示手工调整；`--force` 也不覆盖区块外逻辑。
- 最终不能导出不存在的文件。

### 3.6 包管理器、版本与安装

检测顺序：package.json 的 `packageManager` → 单一 lockfile → 默认 npm。支持 npm、pnpm、Yarn、Bun。

- 多种 lockfile 且无明确 packageManager：报错，请用户明确项目包管理器，不擅自选一个。
- 未识别的 packageManager 在文件写入前报错。
- `--no-install` / `--dry-run` 不调用任何包管理器；未知包管理器不妨碍纯生成，但应提示。
- 不自动安装或启用 Corepack，不生成额外 lockfile。
- spawn 使用参数数组；不拼接用户输入到 shell 字符串。
- 必须测试 Windows 的 npm.cmd / pnpm.cmd 启动。可采用跨平台 spawn 库；不要默认 Unix 成功就代表 Windows 可用。

为模板定义 `minimumRuntimeVersion`：当前模板只使用 `0.1.1` 已有 API，因此可从 `0.1.1` 起兼容，但必须在 fixture 中验证。新安装默认安装与 CLI 相同的确切版本，例如 `webgpu-progressive-blur@0.2.0`，避免硬编码旧版。

已有依赖规则：

1. dependencies 中已有满足最低版本的已安装运行时：保留，不静默升级。
2. 仅有声明而未安装：核验声明范围，必要时安装该项目声明的版本；无法确认时要求先完成项目依赖安装。
3. 已安装版本低于最低版本：写文件前停止，给出升级命令，不自动修改版本范围。
4. 只有 devDependency：将相同已兼容范围移动为生产 dependency，保留项目版本意图；验证包管理器确实完成移动。
5. `file:`、`workspace:`、Git 依赖等特殊来源：保留；若无法验证实际版本，提示用户确认，允许 `--no-install` 生成，不擅自替换为 registry 版本。
6. 语义版本范围使用可靠的 semver 解析，不用字符串大小比较。

安装失败不删除生成的文件，不回滚用户的 lockfile。给出实际使用的包管理器、失败阶段、重试命令。再次执行应可恢复，并保留已有文件。

## 4. 组件公共契约

### 4.1 预设和组件名

| CLI 名称 | React / Astro 组件名 | 合法 placement | 布局起点 |
| --- | --- | --- | --- |
| navbar | ProgressiveBlurNavbar | top | fixed 顶部，min-height 72px |
| sidebar | ProgressiveBlurSidebar | left / right | fixed 侧边，width 200px |
| bottom-bar | ProgressiveBlurBottomBar | bottom | fixed 底部，min-height 80px |
| caption | ProgressiveBlurCaption | bottom / top | absolute，min-height 120px |
| edge | ProgressiveBlurEdge | 四边 | absolute，边缘厚度 16px，pointer-events none |
| panel | ProgressiveBlurPanel | 不暴露 | relative，width min(320px,90vw)，min-height 200px |

组件名称、预设名称与效果台应有单一映射来源或一致性测试，避免 `BottomBar` 等命名漂移。

### 4.2 Props

通用基础组件默认 `preset='panel'`；包装组件固定自己的 preset，并在类型层删除外部 `preset` 参数。包装 spread 顺序必须保证 JS 调用者也不能覆盖固定 preset。

| 参数 | 类型 / 默认 | 语义 |
| --- | --- | --- |
| radius | number / 24 | CSS px 单位的高斯 σ |
| transition | number / 48 | 外部渐隐长度；panel 无渐隐，建议 panel 类型不暴露该参数 |
| placement | 受预设约束 | 组件位置，不是渐变向量 |
| maxSamples | number / 32 | 沿用核心采样预算 |
| children / slot | 框架内容 | 前景内容不参与背景捕获 |
| className / class | 原生属性 | 用户自定义样式 |
| style | 框架原生格式 | 覆盖默认内联布局 |
| refreshKey | React：string 或 number | 背景变化后显式触发重捕获 |

React 透传原生 div 属性、aria/data 属性与事件。Astro 透传原生 div 属性，使用默认 slot；不增加命名 slot 体系。

收紧每个包装组件的 placement 类型，例如 Sidebar 只允许 `left | right`。基础组件可以保留完整 BlurPreset/BlurPlacement 类型，运行时仍由核心检查组合合法性。

### 4.3 样式优先级

当前共享布局返回内联 style。因此实际优先级应写成：`默认内联 style → 用户 style`，后者覆盖前者。普通 class 无法直接覆盖同名内联属性；不要在文档里承诺 class 能覆盖所有布局。用户也可直接编辑生成的 `layout.ts`。

不要求 Tailwind，不改变全局样式。默认透明背景，允许渐隐外延，不强制 `overflow:hidden`。caption/edge 的父容器需要合适的定位上下文。SSR 时输出正常前景，不等待 WebGPU。

用户主动设置不透明背景或裁剪可能遮挡/裁掉效果，属于布局约束，应在效果台和 README 标注。

### 4.4 刷新与高级用法边界

- 源码组件首版不透传整个 ProgressiveBlurAttachOptions，以免 API 无限扩展。
- React 通过 `refreshKey` 显式刷新；Astro 对目标 DOM 派发 `progressive-blur:refresh` 事件。
- 自定义 capture、captureRoot、scrollTarget 等高级参数，首版通过编辑组件源码或直接调用 DOM API 实现，文档给出链接。
- 不承诺页面任意背景变化都会自动反映到快照。
- 错误不导致前景消失；不自动加 CPU 或 CSS 模糊 fallback。

## 5. 共享异步生命周期

这是首版最重要的正确性工作，不能只写 `useEffect(() => { attach() }, [])`。

### 5.1 推荐接口

在用户目录的 `lifecycle.ts` 中保留框架无关的管理器：

```ts
interface BlurMountHandle {
  destroy(): void;
  refresh(): Promise<void>;
}

function mountProgressiveBlur(
  element: HTMLElement,
  options: ProgressiveBlurAttachOptions,
): BlurMountHandle;
```

这是生成模板内部接口，不属于 npm 运行时的公开 API。允许调整当前草稿的返回值，但 React 和 Astro 必须同时修改。

### 5.2 状态与串行化

每个 DOM 节点维护串行初始化队列和 generation/取消标记：

1. 挂载时登记队列任务。
2. 前一次挂载未结束时，后一次不能同时 attach 同一节点。
3. 开始前检查取消状态与 `element.isConnected`。
4. await attach；期间 cleanup 可以将本任务标记为取消。
5. Promise 返回后再次检查。如果已过期，立即 destroy 返回的实例，不能把它保存为当前实例。
6. destroy 必须幂等；未初始化完成也可以调用。
7. 前一次初始化失败不能让队列永久 rejected；下一次挂载必须仍可执行。
8. 旧任务不得更新新任务的 dataset、状态事件或实例引用。

概念伪代码：

```text
previous = queues.get(node) or resolvedPromise
ready = previous.catch(ignore).then(async:
    if cancelled or disconnected: return
    instance = await attach(node, options)
    if cancelled or disconnected: instance.destroy(); return
    save instance
)
queues.set(node, ready.catch(reportCurrentError))
cleanup = mark cancelled + destroy saved instance
```

不要仅通过设置一个 cleanup 变量处理异步初始化，这不能防止 StrictMode 的第二次 attach 与第一次竞争。

### 5.3 刷新和状态事件

- `refresh()` 等待本次挂载初始化完成，再调用当前实例的 refresh；已经销毁则 no-op。
- 并发刷新合并为“当前一次 + 最多一次待执行”，避免每次事件都启动捕获。
- `data-blur-state` 写在实际 target 上，通过核心 onStatus 同步 initializing、refreshing、ready、unsupported、error 等状态。
- 异常派发 `progressive-blur:error`，detail 为 Error，事件可冒泡；不打印源图或用户内容。
- 需要被网页监听时可派发 `progressive-blur:status`，detail 为状态对象。旧任务不派发新事件。
- `unsupported` 是可显示的状态，不伪装成 ready，也不抛出未处理的 Promise rejection。
- 页面 BFCache 返回必须检查实例是否仍可用；已失效时销毁并重建，仍可用时 refresh。不能只看节点仍连接就认定设备有效。

## 6. React 实现

### 6.1 基础组件

- `.tsx` 顶部保留 `'use client'`，兼容 Next.js 客户端边界。
- 模块求值和服务端 render 阶段不得访问 window、document、navigator 或创建 GPU device。
- 用一个真实 div 作为 target，内部渲染 children。
- useEffect 中挂载，cleanup 同步调用 handle.destroy。
- 首版采用明确的“配置变化 → 清理旧实例 → 串行重挂载”策略，降低状态切换风险。后续性能版本再评估 setParameters 原地更新。
- effect 依赖使用 preset、placement、radius、transition、maxSamples 的原始值，不依赖每次 render 都新建的 options 对象。
- refreshKey 变化调用 handle.refresh，不要求修改普通半径参数才能重新捕获。
- ref 使用兼容 React 18/19 的 forwardRef + 内部 ref 合并，暴露实际 HTMLDivElement；不引入 React 19 专属 ref API。
- `key`、ref、refreshKey 和模糊 props 不得透传成 DOM attributes。

React effect 会在开发 StrictMode 中额外执行 setup/cleanup；按 [React 官方 useEffect 文档](https://react.dev/reference/react/useEffect) 验证清理对称性。

### 6.2 包装组件

包装组件只负责固定 preset、收紧参数类型与转发 ref，不重复编写生命周期。`ProgressiveBlurSidebar` 的 props 要对 placement 提供正确提示；`ProgressiveBlurPanel` 不暴露无意义的 placement/transition。

### 6.3 可复制示例

假设文件位于 `src/App.tsx`：

```tsx
import { ProgressiveBlurNavbar } from './components/progressive_blur';

export default function App() {
  return (
    <>
      <main>{/* 页面背景内容 */}</main>
      <ProgressiveBlurNavbar radius={24} transition={48}>
        <nav aria-label="主导航">我的导航内容</nav>
      </ProgressiveBlurNavbar>
    </>
  );
}
```

不自动安装 React。React 18 和 19 是计划验证矩阵；测试通过前不要声称都已支持。Next.js 仅在 fixture 验证 SSR/client boundary 后列入支持范围，不以 `'use client'` 字符串存在作为兼容证明。

## 7. Astro 实现

### 7.1 服务端部分

- `.astro` frontmatter 只做 props、类型、布局和序列化处理。
- 不在 frontmatter 中调用 attachProgressiveBlur。
- 输出一个自定义元素 host 和内部实际 div target，slot 位于 target 内。
- 通过 `data-options={JSON.stringify(options)}` 传标量配置，使用 Astro 的正常属性转义；不要把用户字符串拼进可执行 script。
- 只序列化约定的 preset、placement、radius、transition、maxSamples，不能序列化函数、DOM 引用或整个 Astro.props。
- `<script>` 保持由 Astro 处理，以便打包本地 TS import；不加 `is:inline` 承载裸 npm import。

Astro 对组件脚本的处理和页面内去重见 [Scripts and event handling](https://docs.astro.build/en/guides/client-side-scripts/)。

### 7.2 自定义元素与路由

沿用 `progressive-blur-host`，`customElements.define` 前检查是否已注册。

- connectedCallback 延迟到 microtask 后取得直系 target，防止子节点尚未解析；检查 generation 与 isConnected。
- disconnectedCallback 立即使待处理任务失效并 destroy。
- JSON 解析、结构验证和挂载错误都进入可见错误状态，不能直接抛到全局。
- 监听目标的 `progressive-blur:refresh` 事件，调用 handle.refresh。
- 在 `astro:page-load` 后处理持久保留的 host：若实例已存在则 refresh，不存在则 mount。
- 在 `astro:before-swap` 清理旧效果，包括持久节点的旧背景快照；在 page-load 重建/刷新。即使持久节点没有触发 disconnectedCallback，也不能继续显示旧页面背景。
- 注册 document 级监听器时，每个 host 要有明确的取消逻辑，或使用单例 registry，不能每次连接都增加无法移除的监听器。
- 普通全页导航不依赖 Astro 事件也能工作。
- BFCache 的 pageshow/pagehide 与 generation 逻辑一起测试；重连时不得创建重复实例。

路由事件顺序、脚本重执行与持久元素语义以 [Astro View transitions 文档](https://docs.astro.build/en/guides/view-transitions/) 为依据。`transition:persist` 必须有专门用例，不能只测普通节点替换。

### 7.3 不使用 React hydration

原生 `.astro` 组件不需要 `client:load`，也不要求 React integration。浏览器行为由 Astro 打包的 script 管理。自定义 host 是客户端生命周期载体，不是 React island。

### 7.4 可复制示例

假设文件位于 `src/pages/index.astro`：

```astro
---
import ProgressiveBlurNavbar from '../components/progressive_blur/progressive-blur-navbar.astro';
---

<main><!-- 页面背景内容 --></main>
<ProgressiveBlurNavbar radius={24} transition={48}>
  <nav aria-label="主导航">我的导航内容</nav>
</ProgressiveBlurNavbar>
```

手动刷新示例：给组件设置 `id="site-nav"`，然后在客户端执行：

```ts
document.querySelector('#site-nav')?.dispatchEvent(
  new CustomEvent('progressive-blur:refresh'),
);
```

不要声称 slot 内所有动态更新都会自动刷新背景。首版对 data-options 的任意运行时直接编辑不提供响应式 API；需要重建或自行修改源码。

## 8. 效果台改造

### 8.1 控件与行为

保留现有预设、参数、画布与原图对比。代码区提供：

1. 框架选择：React、Astro、原生 DOM。默认 React；DOM 入口继续兼容已有用户。
2. “添加组件 / 安装”页签。
3. “组件用法 / JavaScript”页签。
4. “布局与刷新说明 / HTML CSS”页签。
5. 一键复制当前页签，失败时保留可手动选择的代码。

选中具体预设时命令默认只添加当前预设；额外提供“添加全部预设”操作或独立命令。CLI 不指定名称添加全部的语义不能被效果台隐藏。

### 8.2 代码生成规则

- 从 package.json 读取版本，禁止在多个文件硬编码。
- 命令 pin 到产生该模板的版本，例如 `npx webgpu-progressive-blur@0.2.0 add sidebar --framework astro`。
- 运行命令只添加标准源码；用户调好的 radius/transition 等体现在用法代码中。首版不新增 `--radius` 等 CLI flag。
- React 示例注明“放入 src/App.tsx”；Astro 示例注明“放入 src/pages/index.astro”，使用与这两个位置匹配的相对 import。
- 自定义输出目录通过命令 `--dir` 使用；首版效果台可以只展示默认目录示例，清楚提示需要同步调整 import，不伪造全项目通用路径。
- 不假设 `@/` 别名存在，不修改用户 tsconfig。
- 不输出 panel 的无效 placement/transition props。
- 形状实验不生成不存在的 `add circle` 命令；切换到 DOM 导出并明确提示原因。
- 安装命令、组件名、props、布局说明必须随框架和预设一起变化，复制按钮读取当前值。

### 8.3 可测试结构

建议把 `studio.ts` 中字符串生成逻辑抽成纯函数模块 `examples/navbar/codegen.ts`：

```ts
interface GeneratedExample {
  install: string;
  usage: string;
  notes: string;
}
```

输入为版本、框架、选中预设和当前参数，输出文本。DOM 代码只负责渲染、切 tab 与复制。给每个框架 × 预设建立断言，并将输出片段放进真实 fixture 编译；不要只做字符串快照。

本次不要求用 React/Astro 重新实现整个效果台，组件预览继续复用公开 DOM 预设 API。

## 9. 文件级实施任务与顺序

| 阶段 | 文件 / 工作 | 完成条件 |
| --- | --- | --- |
| P0 基线 | package.json、已有 CLI/模板、git 状态 | 确认哪些为已有草稿，保留未提交内容；记录目标版本与现有测试结果 |
| P1 CLI 计划 | cli/index.mjs，必要时拆 parser/project/plan/writer/install 模块 | 所有输入可形成明确文件和安装计划；dry-run 零副作用 |
| P2 文件保护 | writer/index 合并逻辑、tests/cli.test.ts | 保留用户改动、幂等、拒绝越界/链接/冲突，失败报告准确 |
| P3 生命周期 | templates/shared/lifecycle.ts | 异步串行化、取消、刷新、错误状态用例通过 |
| P4 React | react 基础模板、包装生成、layout | StrictMode、参数、ref、SSR、消费项目编译通过 |
| P5 Astro | astro 基础模板、包装生成 | 普通页、ClientRouter、persist、BFCache、多实例通过 |
| P6 效果台 | studio.ts、codegen.ts、index.html、必要样式 | 两框架代码同步；示例路径明确；全部/单个命令可用 |
| P7 打包与文档 | package.json、README、CHANGELOG、docs/roadmap.md | tarball 包含 CLI 模板；文档无旧版不可用命令 |
| P8 发布验收 | 独立 fixtures、npm registry | 从 tarball/registry 运行 CLI、构建、浏览器效果验证 |

P3 是 P4/P5 的共同前置；P6 依赖 P4/P5 的最终 props，避免先输出尚未实现的用法。本次交接不要求新建 worktree；如果后续决定使用 dev 分支，应遵守仓库约定先提醒用户。

## 10. 测试矩阵与发布门槛

### 10.1 CLI 自动测试

至少覆盖：

- React/Astro 各自单个、多个、全部预设，重复名称去重。
- Astro + React 混合依赖的优先级和显式覆盖。
- 无 src、自定义目录、有空格路径、Unicode 路径。
- 无 manifest、损坏 manifest、未知框架/预设/参数、flag 缺值及重复 flag。
- 幂等执行、用户修改保留、force 范围、共享文件覆盖提示。
- index 注释同名不误判、受管理区块合并、用户 export 冲突、损坏区块。
- 路径越界、普通/悬空 symlink、输出文件实际为目录；失败前零写入。
- 跨框架输出目录冲突。
- 包管理器显式声明、每种 lockfile、多 lockfile 冲突、命令不存在、非零退出。
- dependencies/devDependencies、低版本、特殊来源、no-install、dry-run。
- 通过真实 `node_modules/.bin` symlink 启动。
- 从 npm pack tarball 启动，验证模板定位不依赖仓库 cwd。
- Windows 至少完成 CLI 添加/目录/包管理器 smoke test；若未验证，要如实标注，不宣称全面支持。

### 10.2 生命周期与浏览器

| 场景 | 必须观察到的结果 |
| --- | --- |
| 初始化前卸载 | Promise 完成后实例立即销毁，无遗留 overlay |
| StrictMode setup → cleanup → setup | 同节点最多一个活跃实例，无重复 attach 异常 |
| 连续参数变化 | 最终参数生效，旧任务不覆盖状态 |
| 多个组件 | 各自独立；卸载其中一个不破坏其他实例 |
| 初始化失败后重挂载 | 队列不锁死，可以恢复 |
| 显式背景刷新 | 背景变化反映到画布 |
| WebGPU 不支持/设备请求失败 | 前景保留，状态明确，无未处理 rejection |
| resize/DPR | 输出和遮罩尺寸匹配，无拉伸错位 |
| Astro 普通导航 | 进入有组件页面时初始化，离开释放 |
| ClientRouter A→B→A | 每次至多一个实例，无重复监听 |
| transition:persist | 不显示上一页面快照，重新刷新或挂载 |
| BFCache 返回 | 无永久 destroyed 状态，能恢复显示 |
| 动态插入/移除节点 | 挂载和资源清理正确 |

用可控的 deferred Promise 对挂载时序做单元测试；用真实浏览器验证 GPU 和框架生命周期。不能只靠 timeout 等待后检查“没报错”。

### 10.3 独立消费项目

建议加入 `tests/fixtures/` 或独立验收脚本，明确不作为 npm 包文件发布：

1. React 18 + Vite + TS。
2. React 19 + Vite + TS。
3. Next.js SSR/client boundary fixture；未做则不在 README 标注正式支持 Next.js。
4. Astro 静态页面 fixture。
5. Astro ClientRouter 两页面 fixture，包含普通组件与 persist 场景。

各 fixture 执行：安装本地 tarball → 调用包的 CLI → 粘贴效果台用法 → 类型/框架检查 → production build → 浏览器验证。Astro 必须包含 `astro check` 或等效完整组件类型检查，不能仅靠 build。

冻结 fixture 的实际依赖版本与 lockfile。本文不预先声称兼容所有 Astro 主版本；README 只列真正通过的版本。

### 10.4 原有能力不能回归

```bash
npm run typecheck
npm test
npm run build
npm run test:gpu
npm run pack:check
```

主项目检查之外，还必须运行生成源码 fixtures。GPU 页面检查明确的 passed，而不是把 unsupported 当成功。原有 DOM 调用和三条包 exports 保持可用。

## 11. 打包、文档与发布

### 11.1 包配置

- bin 指向 `./cli/index.mjs`，包含 Node shebang，并验证 executable 权限/安装后 shim。
- files 必须包含 dist、cli、templates、README、LICENSE、THIRD_PARTY_NOTICES、CHANGELOG。
- templates 必须原样打包，不能被 TypeScript build 的 include/exclude 意外遗漏。
- 保留现有 ESM exports；CLI 的 Node fs/child_process 不能进入浏览器根入口或 DOM 入口。
- React/Astro 不是内核运行时 dependencies；相应框架由使用者项目提供。
- 如果新增 semver 或跨平台 spawn 库，仅作为 CLI 所需依赖，并确认浏览器打包不把它们带入。
- prepack 构建库；发布前检查需增加模板 fixture 验收入口，或明确由 release 命令统一执行。
- 当前 engines 为 Node >=20.19.0，应在该下限与一个更新版本上实际跑 CLI。浏览器运行库与 CLI 的 Node 要求分别说明。

### 11.2 README 必须补充

1. npm 安装内核 vs npx 添加源码的区别。
2. 单个/全部/多预设、框架识别、默认目录与自定义目录。
3. React 与 Astro 各一段可复制用法，标明示例文件位置。
4. 组件 props、预设布局、style 优先级、刷新方式和错误状态。
5. 已有文件保护、force 对共享文件的影响、安装失败恢复。
6. 本地源码不会随 npm update 自动更新。
7. 不支持 Vue；形状实验暂走 DOM API。
8. 浏览器/WebGPU/DOM 捕获限制沿用真实情况，不宣传无需任何初始化条件。
9. CLI 是新增版本能力；不能让 `0.1.1` 用户运行该版本不存在的 bin。
10. 新截图显示框架选择、添加命令、组件用法。

更新 CHANGELOG 和现有过时 roadmap，避免路线图仍把已完成的 DOM API 描述成下一阶段。

### 11.3 发布顺序

1. 核验 registry 未占用目标版本；必要时调整版本。
2. 全部测试、fixture 和 production build 通过。
3. `npm pack --json`，检查清单、CLI、模板、类型与授权文件。
4. 在空白消费项目中安装该 tarball，真实执行 `npx webgpu-progressive-blur add navbar --framework react` 及 Astro 等价命令。
5. 预发布 tarball 测试使用 `--no-install` 或包管理器本地 override，避免 CLI 试图下载尚未发布的同版本运行时；发布后另测默认自动安装路径。
6. 更新 README/CHANGELOG，确保发布内容与测试版本一致。
7. `npm publish --access public --registry=https://registry.npmjs.org/`；账号 2FA 由维护者完成，不在代码或文档存 token。
8. `npm view ... version bin dist.integrity` 核验结果。
9. 全新临时应用从 registry 执行固定版本 npx，分别验证 React/Astro 单个预设及自动安装依赖。
10. 验证 latest 标签符合本次稳定发布意图，效果台展示的版本可真实安装，再对外宣布完成。

失败时保留已发布的旧版本；不要 unpublish 正常版本来重试，也不要重复发布同一版本。

## 12. 完成定义

只有全部满足才算本次完成：

- [ ] CLI 无名称添加全部，名称选择只带必要共享文件。
- [ ] React 与 Astro 生成物能编译、导入和真实渲染。
- [ ] StrictMode、异步卸载、Astro 路由/persist/BFCache 无泄漏或重复挂载。
- [ ] 参数、默认布局、刷新与错误状态按本文契约工作。
- [ ] 用户源码默认保留，索引与依赖操作幂等且失败信息准确。
- [ ] 效果台命令和组件示例与实际 CLI/template 同步。
- [ ] 旧 DOM API、核心入口和 GPU 验证无回归。
- [ ] 类型检查覆盖实际生成物，而不仅是仓库 src。
- [ ] tarball 和 registry 安装路径均通过。
- [ ] 文档标明已验证版本、已知限制和未支持范围。

## 13. 发布后的优化清单（不阻塞本次，除非暴露正确性问题）

优先收集真实页面数据，再决定优化方向：

1. 对 radius 等简单变化使用 setParameters 原地更新，减少 React 重建。
2. 背景捕获按脏区域更新，减少整页快照和图片上传。
3. 多组件共享捕获与 GPU 资源的峰值内存控制。
4. 滚动期间捕获调度、DPR/质量配置、低性能设备策略。
5. 生成源码的显式升级/diff 命令，不默认覆盖修改。
6. 可选 React/Astro 高级捕获参数封装。
7. 真实业务预设示例与可访问性进一步验证。

不预先承诺帧率、内存下降比例或全浏览器支持。记录捕获耗时、渲染提交成本和页面交互表现，再做有依据的优化。
