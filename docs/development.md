# 开发维护

## 环境与构建

运行环境和包管理器版本以根目录的 `package.json`、`.node-version` 和 `.nvmrc` 为准。安装匹配版本后，在项目根目录执行：

```sh
pnpm install --frozen-lockfile
pnpm build
```

生成的 `dist/` 可按 [用户安装说明](../README.md#安装与使用) 加载。修改构建产物对应的源码后，重新构建再加载扩展。

持续开发可运行 `pnpm dev` 监听源码并重新构建。更新后在扩展管理页点击「重新加载」，并刷新测试网页，让旧的内容脚本退出；仅重新加载扩展不足以确保当前网页使用新脚本。

## 打包 CRX

本机安装 Chrome 或 Chromium 后，在项目根目录执行：

```sh
pnpm pack-crx
```

命令先执行生产构建，再使用 Chrome 的打包功能生成 `release/pip-any.crx`。首次打包会生成 `.keys/pip-any.pem`，后续打包复用该私钥以保持扩展 ID。私钥与产物目录均已加入忽略列表。

妥善备份私钥，仅分发 `.crx` 文件。私钥缺失且已有 CRX 产物时，命令会停止，避免意外生成另一扩展身份；如确实需要全新身份，可移走旧 CRX 后重新打包。升级已分发的扩展时，还需增加 `public/manifest.json` 中的版本号。

浏览器不在标准安装位置时，设置 `CHROME_PATH` 指向可执行文件；已有签名密钥可用 `CRX_KEY_PATH` 指向已有 PEM 文件。例如在 macOS / Linux 中：

```sh
CHROME_PATH="/path/to/chrome" CRX_KEY_PATH="/path/to/existing.pem" pnpm pack-crx
```

打包使用独立临时目录，不占用日常浏览器配置；结束时清理临时文件。Chrome 查找、打包或写入失败时，命令以非零状态退出。

生成 CRX 不等于可在所有平台直接安装。Windows、macOS 的自托管安装受到 Chrome 企业策略限制；本地调试仍可加载 `dist/`。参考 [Chrome 打包说明](https://developer.chrome.com/docs/extensions/how-to/distribute/host-on-linux) 与 [分发限制](https://developer.chrome.com/docs/extensions/how-to/distribute)。

## 依赖维护

更新依赖时用项目固定的 pnpm 生成锁文件；可通过冻结锁文件安装验证可复现性。CI 的安装与检查入口见 [工作流](../.github/workflows/check.yml)。

迁移 pnpm 11 时，原先的 Oxfmt、Vitest 版本因发布时间尚未达到默认等待期而被拒绝安装，因此选择了满足校验的相邻版本。后续维护保留发布时间校验，正常评估依赖升级；具体版本以 `package.json` 为准。

`pnpm-workspace.yaml` 在本项目用于保存依赖安装脚本的执行策略。esbuild 使用随依赖安装的平台二进制，安装脚本保持不执行。

## 修改与验证

按改动选择验证方式，参考 [自测指南](testing.md)。涉及交互或支持范围调整时，结合 [设计说明](design.md) 检查用户说明是否同步；涉及领域用语时查阅 [术语表](GLOSSARY.md)。

### UI 资源维护

- 选择提示区的固定结构和样式分别维护在 `src/overlay.html`、`src/overlay.css`；`src/overlay-view.ts` 负责同步实例化与控件校验，`src/overlay.ts` 负责事件绑定和状态更新。抽象边界见 [设计说明](design.md#插件-ui-模板维护方案)。
- 逻辑使用 `data-ui` 而不是样式 class 绑定控件；增删或改变控件标签时，同步调整绑定和测试。动态文案继续使用 `textContent`，不要向 HTML 片段插入网页数据。
- overlay HTML/CSS 使用 `?raw` 在构建时作为文本嵌入，不进行运行时资源加载。CSS 直接写入 ShadowRoot 中的 style，保持普通 CSS，不添加需要解析或加载外部资源的 `@import`、`url()`；模板不添加脚本或内联事件。
- popup 的结构与样式维护在 `public/popup.html`、`public/popup.css`，两者原样复制进 `dist/`。修改后重新构建并重载扩展；不要直接维护构建产物。
