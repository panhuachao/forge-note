# 锦囊笔记 ForgeNote V1.1

> **Forge your knowledge.** 你的知识锦囊，随时取用一条妙计。

一款**文件优先、本地主权、开源免费**的个人知识管理桌面应用。基于 Electron + TypeScript + React 构建，实现「物理目录 + 双向链接」双知识组织体系，搭载本地 AI 知识管家，**V1.1 新增知识库模板系统（内置姜胡说 PARA+ 7 目录）**。

---

## 核心特性

- 📁 **文件优先**：所有笔记为本地原生 Markdown 文件，APP 仅为视图 + AI 增强，不私有封装数据。
- 🌳 **双结构组织**：物理目录树 + 双向链接网状关联，兼顾规整性与关联性。
- 🤖 **本地 AI 管家**：支持 Ollama 本地大模型 / OpenAI 兼容远端模型；离线降级为本地规则引擎。
- 📋 **V1.1 知识库模板**：内置姜胡说 PARA+ 7 目录模板，AI 自动归纳推荐目录、智能链接推荐、知识卡片锻造。
- 🔍 **强大检索**：全文搜索 + 标签 + 双链 + 模板目录过滤。
- 🌐 **知识图谱**：可视化笔记之间的关联，支持模板目录着色。
- 🛡 **隐私安全**：contextIsolation + sandbox + 加密 API Key + AI 操作审计 + 一键撤销。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 桌面壳 | Electron 31 |
| 渲染层 | React 18 + TypeScript + Vite |
| 编辑器 | CodeMirror 6 |
| 文件监听 | chokidar |
| 向量索引 | LanceDB（V1.1 后续） / 内存倒排（V1.1 MVP） |
| 嵌入 | transformers.js（V1.1 后续） |
| 图谱 | 自研 Canvas 2D 力导向图 |
| 数据库 | better-sqlite3（配置 + 审计） |
| LLM | Ollama / OpenAI 兼容 |
| 样式 | TailwindCSS |
| 打包 | electron-vite + electron-builder |

## 目录结构

```
forgenote/
├── src/
│   ├── main/           # Electron 主进程
│   │   ├── services/   # 业务服务（kb、fs、template、ai、search、audit）
│   │   ├── utils/      # 工具（markdown 解析、原子写、路径安全）
│   │   ├── ipc.ts      # IPC 处理器注册
│   │   └── index.ts    # 主进程入口
│   ├── preload/        # 预加载脚本（contextBridge 暴露类型化 API）
│   ├── renderer/       # React 渲染层
│   │   ├── components/ # UI 组件
│   │   ├── pages/      # 页面
│   │   ├── stores/     # Zustand 状态
│   │   ├── utils/      # 工具
│   │   └── styles/     # 样式
│   └── shared/         # 主/渲染进程共享类型
├── resources/
│   └── templates/
│       └── para-plus/  # 内置姜胡说 PARA+ 7 目录模板
├── electron.vite.config.ts
├── tailwind.config.js
└── package.json
```

## 快速开始

### 环境要求
- Node.js >= 18
- npm / pnpm / yarn

### 安装
```bash
cd forgenote
npm install
```

### 开发模式
```bash
npm run dev
```
启动后会自动打开 Electron 窗口，并启用热更新。

### 类型检查
```bash
npm run typecheck
```

### 打包
```bash
# 当前平台
npm run package

# macOS
npm run package:mac

# Windows
npm run package:win
```
产物输出到 `release/` 目录。

## 使用指引

1. **添加知识库**：点击「首页 → 选择文件夹」，选择本地任意目录。
2. **应用模板**：进入「模板」标签页，选择「姜胡说 PARA+」一键应用，APP 会在知识库根目录创建 7 个标准目录及说明文件。
3. **配置 AI 模型**：进入「设置 → AI 模型配置」：
   - 关闭：所有 AI 操作降级为本地规则引擎。
   - Ollama：填入 `http://127.0.0.1:11434` 与模型名（需先启动 Ollama 服务并 `ollama pull qwen2.5:7b`）。
   - 远端（DeepSeek 等）：填入 base URL、模型名、API Key。
4. **新建笔记**：在左侧目录树右键新建（或点击新建按钮）。在模板目录下新建会自动套用目录笔记模板。
5. **AI 归纳推荐**：编辑器顶部点击「📂 归档」按钮，AI 会根据 AI_CONFIG.md 规则推荐最合适的目录，用户确认后移动。
6. **AI 链接推荐**：编辑器顶部点击「🔗 链接」按钮，AI 推荐 3-5 条可建立的双向链接，用户勾选后插入。
7. **锻造知识卡片**：在「00 灵感库」中打开笔记，点击「⚒ 锻造」，AI 按四铁律提炼为标准化卡片，确认后写入目标目录。
8. **查看图谱**：顶部标签页「🌐 图谱」按力导向图可视化展示所有笔记关联。
9. **操作审计与撤销**：顶部「🕓 历史」查看所有 AI 操作的审计记录，可一键撤销。

## 设计原则（不可违反）

1. **文件优先**：APP 不二次封装、不篡改源文件。
2. **安全只读**：所有 AI 行为「建议 + 用户确认」后才落盘。
3. **双结构共存**：物理目录 + 逻辑双链互相独立、双向打通。
4. **本地优先**：本地模型 > 远端模型；离线时降级本地规则引擎。
5. **模板可塑 + 流向引导**：内置模板是起点而非枷锁，用户可自由修改 `README.md` / `AI_CONFIG.md`。

## 路线图

- ✅ V1.0 MVP：本地文件内核、双结构、基础 AI、图谱
- ✅ V1.1 知识库模板系统：PARA+ 模板、归纳推荐、链接推荐、卡片锻造、AI_CONFIG 动态注入、模板导入/导出
- 🔜 V1.2：万级文件性能优化、批量 AI 整理、PDF/TXT 解析、PWA 移动端、更多官方模板

## 协议

MIT License - 详见 [LICENSE](./LICENSE)
