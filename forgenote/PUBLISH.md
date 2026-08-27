# 锦囊笔记 ForgeNote 发布说明（v1.0.0）

本地开源 AI 知识库笔记。本文档记录 v1.0.0 的发布内容、构建与升级方式。

## 一、版本信息

- **版本号**：1.0.0
- **构建工具**：electron-vite + electron-builder
- **发布通道**：GitHub Releases（私有仓库 `panhuachao/forge-note`）
- **支持平台**：macOS（dmg / zip）、Windows（nsis）

## 二、v1.0.0 主要更新

### 功能增强
- **灵感页（Inspiration）优化**
  - 使用公共标题组件，页面宽度自动占满。
  - 右侧内容区改为白底，突出内容、优化展示，提升使用意愿。
  - 点击「存为笔记」直接唤起快速笔记弹窗，并自动填充当前灵感内容。
- **Markdown 渲染**
  - 支持 `---` 渲染为分隔划线（不再作为段落终止符，保证正文连续显示）。
- **主菜单布局调整**
  - 灵感图标移至「快速笔记」之后，与其归为一组。
  - 笔记图标更换为 folder 图标。
  - 知识图谱移至笔记之后，图标更换为 share 图标。
- **知识图谱筛选**
  - 右侧目录筛选仅提取一级目录，减少层级噪音。
- **笔记页左侧快捷区（新增）**
  - 新增「新建笔记」「新建文件夹」快捷按钮。
  - 新增「AI 诊断」入口：打开诊断页（保持左栏知识库），对整体知识库进行诊断，包括：缺失双链建议、笔记归属纠错、目录结构补全建议等；用户可逐一确认并由 AI 自动修正。

### 稳定性与健壮性
- **应用内自动更新**
  - 集成 electron-updater，支持静默检查更新与「设置」页手动更新/安装。
  - `App.tsx` / `SettingsPage.tsx` 对 `window.forge.app` 增加判空与 noop 防御，避免旧 preload 构建下因 `app` 段缺失导致白屏崩溃。

## 三、构建与打包

```bash
# 安装依赖（含原生模块重建）
npm install

# 开发预览
npm run dev

# 生产构建 + 打包
npm run package          # 按当前平台打包
npm run package:mac       # 仅 macOS
npm run package:win       # 仅 Windows

# 仅构建（不打包）
npm run build
```

产物输出至 `release/` 目录。

### 发布到 GitHub
`package.json` 已配置 `publish` 指向 `panhuachao/forge-note`（私有仓库）。打包时可附加 `--publish=always` 自动上传：

```bash
npm run package:mac -- --publish=always
```

## 三-1、如何发布「同一版本」的多平台安装包（macOS + Windows）

一个 GitHub Release 可以同时挂载 macOS（`.dmg`/`.zip`）和 Windows（`.exe`）安装包，供不同系统用户下载。由于 electron-builder **无法在单一操作系统上交叉产出另一系统的包**（尤其 Windows 包需 Windows 环境），需按平台分别打包、再上传到同一个 Release。

### 方案 A：本机 + 一台 Windows 机器（手动，适合偶尔发布）

1. **在 macOS 上打包并上传 macOS 包**
   ```bash
   npm run package:mac -- --publish=always
   ```
   产物：`ForgeNote-<version>-universal.dmg` / `.zip`（已在 `package.json` 配置 `--universal`，同时兼容 Apple Silicon 与 Intel Mac）。

2. **在一台 Windows 机器上打包并上传 Windows 包**
   同一份代码（或切到同一 git tag），在 Windows 上：
   ```bash
   npm install
   npm run package:win -- --publish=always
   ```
   产物：`ForgeNote-<version>.exe`（nsis）及 `latest.yml`。
   它会自动上传到同一个 `panhuachao/forge-note` Release，与 macOS 包并列。

> 要点：两次上传都使用**相同的版本号**（读 `package.json` 的 `version`），electron-builder 会把资产追加到同一个 tag 的 Release，不会新建重复 Release。

### 方案 B：GitHub Actions 自动跨平台发布（推荐，一次提交出齐）

已在仓库 `.github/workflows/release.yml` 实现：推送版本 tag（如 `v1.0.0`）即在 `macos-latest` 与 `windows-latest` 两个运行器并行构建，各自 `--publish=always` 上传到同一 Release。无需手动切换机器。

**使用步骤：**
1. 在仓库 **Settings → Secrets and variables → Actions** 新增仓库密钥 `GH_TOKEN`（PAT classic，拥有 `repo` 权限）。
2. 更新 `package.json` 的 `version` 为目标版本（如 `1.0.1`）。
3. 提交并打 tag 推送：
   ```bash
   git add -A
   git commit -m "release: v1.0.1"
   git tag v1.0.1
   git push origin v1.0.1
   ```
4. GitHub Actions 自动跑两个 job：macOS 产 `ForgeNote-<version>-universal.dmg`/`.zip`，Windows 产 `ForgeNote-<version>.exe`，二者归入同一 Release。

> 说明：macOS 用 `package:mac`（`--universal` + 经 dotenv 读 `.env`），CI 中由 workflow 注入 `.env`；`ELECTRON_MIRROR` 已通过 workflow `env` 全局设置以加速 x64 Electron 下载。Windows 用 `package:win` 直接读 `GH_TOKEN` 环境变量。

### 发布前检查清单
- 确认 `package.json` 的 `version` 已是目标版本号。
- 确认 `.env`（或 CI Secrets）中的 `GH_TOKEN` 具有 `repo` 权限。
- macOS 打 universal 包时，需能下载 x64 Electron 二进制；国内网络可在 `.env` 设置 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 加速。
- Windows 包必须在 Windows 环境产出，macOS 本机无法直接生成。

## 四、升级方式

- **已安装用户**：应用启动后自动静默检查更新；发现新版本时右下角提示，前往「设置 → 关于」点击「下载并安装」即可，无需手动下载。
- **首次安装**：从 GitHub Releases 下载对应平台安装包（`.dmg` / `.exe`）。

## 五、注意事项

- preload 脚本（contextBridge 暴露的 `window.forge`）改动**不会热重载**，dev 模式下修改后需完全重启 `npm run dev`。
- macOS 首次打开若提示「无法验证开发者」，请在「系统设置 → 隐私与安全性」中允许，或执行 `npm run postinstall` 解除隔离属性。
- 知识库数据默认存储于用户目录下的应用数据位置，升级不会清除本地笔记。
