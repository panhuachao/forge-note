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

## 四、升级方式

- **已安装用户**：应用启动后自动静默检查更新；发现新版本时右下角提示，前往「设置 → 关于」点击「下载并安装」即可，无需手动下载。
- **首次安装**：从 GitHub Releases 下载对应平台安装包（`.dmg` / `.exe`）。

## 五、注意事项

- preload 脚本（contextBridge 暴露的 `window.forge`）改动**不会热重载**，dev 模式下修改后需完全重启 `npm run dev`。
- macOS 首次打开若提示「无法验证开发者」，请在「系统设置 → 隐私与安全性」中允许，或执行 `npm run postinstall` 解除隔离属性。
- 知识库数据默认存储于用户目录下的应用数据位置，升级不会清除本地笔记。
