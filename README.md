# Note for CT

> 轻巧稳定的 Markdown 笔记桌面应用，基于 Electron + Vue 3 + Element Plus 构建。支持多种文件预览、Git 同步与日志记录，并集成 GitHub Releases 自动更新。

## 特性

- 简洁编辑体验：内置 Markdown 编辑器，支持主题与就近保存图片
- 多文件预览：Markdown / 图片 / PDF / HTML / 纯文本
- 安全架构：渲染进程不直接访问 file://，统一经主进程 IPC 读取
- Git 同步：支持本地仓库，远程仓库可按需配置
- 日志可追踪：按天分文件记录在用户数据目录的 logs 下
- 自动更新：生产环境启用 electron-updater（发布源为 GitHub Releases）
- 跨平台：Windows / macOS / Linux

## 截图

开发中（欢迎在 Releases 安装体验）。

## 快速开始

### 环境要求

- Node.js >= 18
- pnpm >= 8

### 安装依赖

```bash
pnpm install
```

### 开发运行

```bash
pnpm dev
```

### 构建打包

```bash
# Windows
pnpm build:win

# macOS
pnpm build:mac

# Linux
pnpm build:linux
```

构建产物与安装包将在 `dist/` 下生成。

## 自动更新与发布（GitHub Releases）

本项目使用 electron-builder 配置 GitHub 作为发布源。手动发布流程如下：

1. 本地构建产物（例如 Windows）：
   ```bash
   pnpm build:win
   ```
2. 在 GitHub 仓库的 Releases 页面创建对应版本（例如 `v0.0.1`），上传以下资产：
   - `dist/latest.yml`
   - 对应平台安装包（如 `dist/note-for-ct-0.0.1-setup.exe`）
3. 用户安装旧版本后启动，应用会自动检查更新并下载安装包，完成静默安装（仅生产环境）。

提示：若需要自动化发布，可使用 CI 或脚本调用 GitHub API/gh CLI 上传资产并更新 `latest.yml`（本仓库当前采用手动发布）。

## 目录结构（简要）

```
src/
  main/       # Electron 主进程
  preload/    # 预加载脚本（隔离上下文）
  renderer/   # 渲染进程（Vue 3）
    src/
      pages/  # 页面（含 About/Notes/Setup 等）

resources/    # 应用图标等资源
dist/         # 打包输出（构建后生成）
```

## 日志位置

应用使用 `electron-log`，按天记录日志，位于用户数据目录下的 `logs/`：

- Windows: `%APPDATA%/note-for-ct/logs`
- macOS: `~/Library/Application Support/note-for-ct/logs`
- Linux: `~/.config/note-for-ct/logs`

你也可以在应用“关于”页面直接打开日志文件夹。

## 技术栈

- Electron, Vite, electron-builder
- Vue 3, Element Plus, Tailwind CSS
- pnpm, ESLint, Prettier

## 开发建议

- 推荐编辑器：VS Code（扩展：ESLint、Prettier、Volar）
- 仅生产环境启用自动更新；开发环境会跳过更新检查
- 如遇白屏或加载异常，请先查看日志并在 Issues 中附带日志片段

## 许可证

MIT
