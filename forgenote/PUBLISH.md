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
npm run package:mac:arm64  # 仅 macOS（Apple Silicon）
npm run package:mac:x64    # 仅 macOS（Intel）
npm run package:mac        # macOS 同时产出 arm64 + x64 两个包
npm run package:win       # 仅 Windows

# 仅构建（不打包）
npm run build
```

产物输出至 `release/` 目录。

### 发布到 GitHub
`package.json` 已配置 `publish` 指向 `panhuachao/forge-note`（私有仓库）。打包时可附加 `--publish=always` 自动上传：

```bash
npm run package:mac:arm64 -- --publish=always
npm run package:mac:x64 -- --publish=always
```

## 三-1、如何发布「同一版本」的多平台安装包（macOS + Windows）

一个 GitHub Release 可以同时挂载 macOS（`.dmg`/`.zip`）和 Windows（`.exe`）安装包，供不同系统用户下载。由于 electron-builder **无法在单一操作系统上交叉产出另一系统的包**（尤其 Windows 包需 Windows 环境），需按平台分别打包、再上传到同一个 Release。

### 方案 A：本机 + 一台 Windows 机器（手动，适合偶尔发布）

1. **在 macOS（Apple Silicon）上打包并上传 arm64 包**
   ```bash
   npm run package:mac:arm64 -- --publish=always
   ```
   产物：`ForgeNote-<version>-arm64.dmg` / `.zip`。

2. **在 macOS（Intel）或 Rosetta 环境打包 x64 包**
   ```bash
   npm run package:mac:x64 -- --publish=always
   ```
   产物：`ForgeNote-<version>-x64.dmg` / `.zip`。

   > 注意：**x64 包务必在 x64（Intel）原生环境打包**，避免在 Apple Silicon 上交叉编译导致原生模块（better-sqlite3）架构错配、窗口空白。CI 已用 `macos-13`（Intel）runner 专门产出 x64 包。

3. **在一台 Windows 机器上打包并上传 Windows 包**
   同一份代码（或切到同一 git tag），在 Windows 上：
   ```bash
   npm install
   npm run package:win -- --publish=always
   ```
   产物：`ForgeNote-<version>.exe`（nsis）及 `latest.yml`。
   它会自动上传到同一个 `panhuachao/forge-note` Release，与 macOS 包并列。

> 要点：两次上传都使用**相同的版本号**（读 `package.json` 的 `version`），electron-builder 会把资产追加到同一个 tag 的 Release，不会新建重复 Release。

### 方案 B：GitHub Actions 自动跨平台发布（推荐，一次提交出齐）

已在仓库 `.github/workflows/release.yml` 实现：推送版本 tag（如 `v1.0.0`）即在三个运行器并行构建：

- `release-mac-arm64`：`macos-latest`（Apple Silicon）用 `package:mac:arm64` 产出 arm64 包。
- `release-mac-x64`：`macos-13`（Intel）用 `package:mac:x64` 产出 x64 包（**原生 Intel 环境，避免交叉编译窗口空白**）。
- `release-win`：`windows-latest` 产出 Windows nsis 包。

三者各自 `--publish=always` 上传到同一 Release。无需手动切换机器。

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
4. GitHub Actions 自动跑三个 job，macOS 产出 `ForgeNote-<version>-arm64.dmg`/`.zip` 与 `ForgeNote-<version>-x64.dmg`/`.zip`，Windows 产 `ForgeNote-<version>.exe`，三者归入同一 Release。

> 说明：macOS 用 `package:mac:*` 经 dotenv 读 `.env`（CI 中由 workflow 注入）；`ELECTRON_MIRROR` 已通过 workflow `env` 全局设置以加速 Electron 下载。Windows 用 `package:win` 直接读 `GH_TOKEN` 环境变量。

### 发布前检查清单
- 确认 `package.json` 的 `version` 已是目标版本号。
- 确认 `.env`（或 CI Secrets）中的 `GH_TOKEN` 具有 `repo` 权限。
- macOS arm64 / x64 分别由各自原生 runner 打包，原生模块（better-sqlite3）架构匹配，避免窗口空白。
- Windows 包必须在 Windows 环境产出，macOS 本机无法直接生成。

## 三-2、Apple 正式发布：开发者签名 + 公证（notarization）

macOS 上未经签名与公证的 Electron 应用，用户从网络下载安装时会被 Gatekeeper 拦截（提示「已阻止恶意软件 / 无法验证开发者」）。本项目已接入 **Developer ID Application 证书签名 + Apple 公证**，使 GitHub Releases 下载的 dmg 可被正常安装。

### 前置条件（一次性准备）
1. 拥有有效的 **Apple Developer Program** 个人/公司账号。
2. 在 `developer.apple.com → Certificates` 创建并下载 **Developer ID Application** 证书，安装到本机钥匙串（Keychain）。
3. 在 `appleid.apple.com` 生成一个 **App-Specific Password**（用于公证上传，不是 Apple ID 登录密码）。
4. 记录 **Team ID**（10 位字母数字，`developer.apple.com → Membership` 页面）。

### 在 GitHub 配置仓库 Secrets
`仓库 Settings → Secrets and variables → Actions → Repository secrets` 新增以下 5 项：

| Secret 名 | 说明 |
|---|---|
| `APPLE_ID` | 你的 Apple ID 邮箱 |
| `APPLE_APP_PASSWORD` | 上述 app-specific password |
| `APPLE_TEAM_ID` | Membership 页的 Team ID |
| `APPLE_CERT_BASE64` | Developer ID Application 证书导出的 `.p12` 经 base64 编码后的字符串 |
| `APPLE_CERT_PASSWORD` | 导出 `.p12` 时设置的密码 |

导出证书为 base64 的方法（在本机执行）：
```bash
# 1. 确认证书已存在
security find-identity -v -p codesigning | grep "Developer ID Application"

# 2. 导出 p12（按提示设置导出密码，请牢记）
security export -t certs -f pkcs12 \
  -k ~/Library/Keychains/login.keychain-db \
  -o /tmp/devid.p12 -P "你的p12密码"

# 3. 转 base64 并复制到剪贴板
base64 -i /tmp/devid.p12 | pbcopy
rm -f /tmp/devid.p12
# 剪贴板内容即 APPLE_CERT_BASE64
```

### CI 自动签名 + 公证流程
`.github/workflows/release.yml` 的 `release-mac` job（`macos-latest` 上运行 `npm run package:mac`，即 `--x64 --arm64` 一次产出两个包）包含：
1. **导入证书**：将 `APPLE_CERT_BASE64` 解码为 p12 并导入到临时钥匙串（`build.keychain`），供 `codesign` 使用。
2. **签名**：`package.json` 的 `mac.identity` 设为 `"Developer ID Application"`，electron-builder 打包时对 `.app` 做 Developer ID 签名。
3. **公证**：`mac.notarize: true` 读取 `APPLE_ID` / `APPLE_APP_PASSWORD` / `APPLE_TEAM_ID` 环境变量，将产物提交 Apple 公证；通过后把 ticket stapled 到 dmg。
4. **发布**：`--publish=always` 上传已公证的 dmg/zip 到同一 Release。

> 公证通常需要 1–5 分钟，CI 会等待结果，属正常现象。

### 本地手动签名 + 公证（可选）
若想在本机直接产出已公证的包（需本机钥匙串已含 Developer ID 证书）：
```bash
export APPLE_ID="你的邮箱"
export APPLE_APP_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="你的TeamID"
npm run package:mac:arm64 -- --publish=always
npm run package:mac:x64 -- --publish=always
```

### 故障排查
- **公证失败 `App not found` / teamId 错误**：检查 `APPLE_TEAM_ID` 是否为 10 位 Team ID（非个人账号邮箱）。
- **`Invalid certificate` / 找不到 identity**：确认 `APPLE_CERT_BASE64` 是 **Developer ID Application**（非 Apple Distribution），且 `APPLE_CERT_PASSWORD` 正确；`security find-identity` 能看到该证书。
- **`APPLE_APP_PASSWORD` 报错**：必须是 app-specific password，不是账号密码；且 Apple ID 需开启双重认证。
- **仍被 Gatekeeper 拦截**：多为公证信息缺失导致。可手动放行：`xattr -cr /Applications/锦囊笔记.app`，或右键 App →「打开」→「仍要打开」。正式分发应确保 CI 五个 Secrets 均配置正确、且公证步骤成功（查看 CI 日志 `notarize` 相关输出）。

## 四、升级方式

- **已安装用户**：应用启动后自动静默检查更新；发现新版本时右下角提示，前往「设置 → 关于」点击「下载并安装」即可，无需手动下载。
- **首次安装**：从 GitHub Releases 下载对应平台安装包（`.dmg` / `.exe`）。

## 五、注意事项

- preload 脚本（contextBridge 暴露的 `window.forge`）改动**不会热重载**，dev 模式下修改后需完全重启 `npm run dev`。
- **macOS 已配置 Apple 开发者签名 + 公证（notarization）**：CI 自动用 Developer ID Application 证书签名并公证，用户从 GitHub 下载的 dmg 可正常安装、不再被 Gatekeeper 拦截。需在仓库 Secrets 配置：`APPLE_ID`（Apple ID 邮箱）、`APPLE_APP_PASSWORD`（app-specific password）、`APPLE_TEAM_ID`（Team ID）、`APPLE_CERT_BASE64`（Developer ID Application 证书 p12 的 base64）、`APPLE_CERT_PASSWORD`（p12 密码）。`mac` 配置见 `identity: "Developer ID Application"` 与 `notarize` 字段。
  - 若公证信息缺失导致仍被拦，可手动放行：安装后 `xattr -cr /Applications/锦囊笔记.app`，或右键 App →「打开」→「仍要打开」。
- 知识库数据默认存储于用户目录下的应用数据位置，升级不会清除本地笔记。
