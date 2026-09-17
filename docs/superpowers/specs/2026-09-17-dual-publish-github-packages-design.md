# npm 与 GitHub Packages 双发布

当前仓库已发布无 scope 的 npm 包 `webgpu-progressive-blur`。本设计保留现有 npm 包的安装路径，同时在 GitHub Packages 发布同一份库产物的 scoped 别名 `@lliooly/webgpu-progressive-blur`，避免改变已有用户的依赖声明。

## 发布身份与范围

- npm 继续使用 `webgpu-progressive-blur`，现有 `package.json` 的默认 `publishConfig.registry` 保持为 `https://registry.npmjs.org/`。
- GitHub Packages 使用 `@lliooly/webgpu-progressive-blur`，registry 为 `https://npm.pkg.github.com`。GitHub npm registry 只接受 scoped package，因此 GitHub 侧不能继续使用完全相同的无 scope 名称。
- `repository` 字段继续指向 `lliooly/webgpu-progressive-blur`，让 GitHub Packages 将发布包关联到当前仓库。
- 不修改源码 API、版本号策略、lockfile 或现有 npm 消费者的安装方式。

## GitHub Actions 工作流

新增 `.github/workflows/publish-packages.yml`，包含两个相互独立的发布 job：

1. `publish-npm`：在 GitHub Release 发布事件中运行，使用 `NPM_TOKEN` 发布当前未加 scope 的 npm 包。
2. `publish-github`：在同一 Release 事件中运行，先完成依赖安装、类型检查、测试和构建，再只在 runner 工作区临时将 package name 改为 `@lliooly/webgpu-progressive-blur`、将 registry 改为 GitHub Packages，最后使用仓库的 `GITHUB_TOKEN` 发布。

两个 job 独立运行，避免 npm 发布成功而 GitHub Packages 发布失败时无法单独重试。工作流还提供手动触发入口，默认只发布 GitHub Packages，用于把已经存在于 npm 的当前版本补发布到 GitHub，而不会因为重复版本导致 npm job 失败。

每次发布前校验 `package.json` 版本与 Release tag（允许 `v` 前缀）一致。工作流使用 Node.js 20，权限最小化为 `contents: read` 与 `packages: write`；npm 侧的 `NPM_TOKEN` 不写入仓库文件。

## 可见性与消费方式

首次发布后在 GitHub Package settings 中将包设置为 public（如需公开分发），并确认继承当前仓库权限。GitHub Packages 的 npm 包即使公开，消费方通常仍需配置认证，因此 npm 仍作为默认公开分发入口。

消费方可使用：

```bash
npm install webgpu-progressive-blur
npm install @lliooly/webgpu-progressive-blur --registry=https://npm.pkg.github.com
```

GitHub Actions 发布使用 `GITHUB_TOKEN`；本地手工发布则需要具有 `write:packages` 权限的 GitHub classic PAT。发布内容由当前 npm 包的 `files` 白名单和既有构建流程决定，不引入第二份构建逻辑。

## 错误处理与验证

- npm 发布失败时，GitHub Packages job 仍可独立完成；反之亦然。
- 已发布版本重新执行时，registry 返回的重复版本错误会保留为显式失败，不覆盖任何已发布内容；手动入口用于只补发 GitHub Packages。
- 本地验证包括 YAML 语法/结构检查、`npm run typecheck`、`npm test`、`npm run build` 与 `npm pack --dry-run`，确认临时 scope 变更不会进入提交的 `package.json`。
- 不在本次范围内实现 registry 代理、npm 包自动同步、版本自动递增或 GitHub Release 自动创建。
