# 锦囊笔记 ForgeNote V1.1 — 技术方案（dev.md）

> 目标读者：工程团队 / 后续接手开发者
> 技术栈：Electron + TypeScript + React + Vite + 本地文件内核
> 文档版本：与产品 PRD V1.1 对齐

---

## 一、总体目标与设计原则

### 1.1 工程目标
1. 桌面端（Windows / macOS）一站式实现「本地文件优先 + 目录/双链双结构 + AI 知识管家 + 知识库模板系统」。
2. 10000+ Markdown 文件下保持流畅：启动 < 2s，目录树/编辑器打开 < 0.5s，文件变动监听延迟 < 1s，AI 归纳/链接推荐本地 < 3s / 远端 < 5s。
3. 完全离线可用：本地向量库 + 本地大模型（Ollama）作为默认能力，远端模型（DeepSeek / OpenAI）作为可选增强。
4. 数据主权：本地磁盘 Markdown 文件为唯一真实数据源，APP 仅作为视图 + AI 增强，所有 AI 行为「建议 + 用户确认」。

### 1.2 五大设计原则（来自 PRD，全局不可违反）
1. **文件优先**：APP 不二次封装、不篡改源文件，删除 APP 不会丢失任何数据。
2. **安全只读**：AI 的归纳、链接、锻造操作必须由用户在 UI 显式确认后才落盘。
3. **双结构共存**：物理目录树 + 逻辑双链索引互相独立、各自索引、双向打通。
4. **本地优先**：向量索引 / AI 计算 / 搜索 / 推荐均优先本地执行。
5. **模板可塑 + 流向引导**：内置模板（姜胡说 PARA+ 7 目录）是「起点而非枷锁」，用户可任意修改 `README.md` / `AI_CONFIG.md` / `.kb_template.json` / `.template.md`，APP 必须实时响应。

---

## 二、技术选型总览

| 层 | 选型 | 选型理由 |
| --- | --- | --- |
| 桌面壳 | **Electron 30+** | PRD 明确要求；多端可移植；文件系统与子进程能力成熟 |
| 渲染层 | **React 18 + TypeScript + Vite** | 社区成熟；与 Electron 集成路径标准化（electron-vite） |
| 状态管理 | **Zustand + Immer** | 轻量、TS 友好；目录树/编辑器/AI 状态分片管理 |
| 路由 | **React Router v6** | 多视图切换（首页 / 笔记详情 / 图谱 / 模板向导 / 设置） |
| 样式 | **TailwindCSS + Radix UI** | 快速落地设计稿、无障碍友好；与 Obsidian 风格接近 |
| 编辑器 | **CodeMirror 6** | 轻量、Markdown 原生、GFM、`[[wiki]]` 链接可扩展、增量渲染 |
| Markdown 解析 | **unified / remark / mdast** | 标准化 AST；用于双链解析、TOC、FrontMatter |
| 文件监听 | **chokidar** | 跨平台稳定、支持原子写入、外部编辑器兼容 |
| 向量索引 | **lancedb（本地嵌入式列存向量库）** | 纯本地、零依赖服务、增量写入、毫秒级检索 |
| Embedding | **transformers.js（@xenova/transformers）** | 浏览器/Node 端本地 BGE-small / m3e-small，无需联网 |
| 图谱 | **Cytoscape.js** | 千级节点性能可控、力导向布局、支持点击跳转 |
| 桌面端持久化 | **better-sqlite3**（配置 / 操作日志 / 模板元数据） | 同步 API、零配置、体积小；不存放笔记原文 |
| 本地 LLM | **Ollama HTTP API** | 拉模型即用；ForgeNote 通过 `http://127.0.0.1:11434` 拉取 |
| 远端 LLM | **OpenAI 兼容协议**（DeepSeek / OpenAI / Moonshot） | 统一 `chat.completions` 客户端 |
| 模板打包 | **fflate**（纯 JS ZIP） | `.kbtemplate` 模板包导入导出 |
| 国际化 | **i18next** | 中英双语 |
| 测试 | **Vitest + Playwright** | 单元 + 端到端 |
| 打包 | **electron-builder** | Windows / macOS 安装包、代码签名 |

### 2.1 目录结构建议

```
forgenote/
├── apps/
│   ├── main/                 # Electron 主进程（Node 环境）
│   │   ├── ipc/              # 渲染进程 ↔ 主进程 IPC 通道
│   │   ├── fs/               # 文件系统服务（chokidar、原子写入）
│   │   ├── index/            # 向量索引、关键词索引、双链索引
│   │   ├── ai/               # LLM 客户端、提示词组装、RAG 编排
│   │   ├── template/         # 模板解析、应用、导入/导出
│   │   ├── kb/               # 知识库挂载、配置
│   │   ├── db/               # better-sqlite3 封装
│   │   └── store/            # 全局配置存储（keytar 加密 API key）
│   ├── preload/              # 预加载脚本（contextBridge 暴露安全 API）
│   └── renderer/             # 渲染进程（React + Vite）
│       ├── src/
│       │   ├── app/          # 应用根、路由
│       │   ├── features/
│       │   │   ├── explorer/      # 目录树
│       │   │   ├── editor/        # CodeMirror 编辑器
│       │   │   ├── graph/         # 知识图谱
│       │   │   ├── ai/            # AI 助手、归纳/链接/锻造
│       │   │   ├── template/      # 模板应用向导
│       │   │   ├── search/        # 搜索面板
│       │   │   └── settings/      # 设置（模型、模板管理）
│       │   ├── components/        # 通用 UI
│       │   ├── stores/            # Zustand 状态
│       │   └── styles/
│       └── index.html
├── resources/
│   ├── templates/
│   │   └── para-plus/         # 内置姜胡说 PARA+ 7 目录模板
│   │       ├── .kb_template.json
│   │       ├── AI_CONFIG.md
│   │       ├── 00 灵感库/{README.md,.template.md}
│   │       ├── 01 项目/...
│   │       └── ...
│   └── icons/
├── shared/                    # 主/渲染进程共享类型、Zod schema
├── electron.vite.config.ts
├── package.json
└── README.md
```

---

## 三、整体架构

### 3.1 架构分层（与 PRD 7.1 一一对应）

```
┌──────────────────────────────────────────────────────────────┐
│  视图层 Renderer（React）                                     │
│  目录树 | 编辑器 | 图谱 | AI 助手 | 模板向导 | 设置             │
└──────────────────────────────────────────────────────────────┘
            ▲                ▲                  ▲
            │ IPC            │ IPC              │ IPC
            ▼                ▼                  ▼
┌──────────────────────────────────────────────────────────────┐
│  能力层 Main Process                                          │
│  目录管理 | 笔记读写 | 图谱查询 | AI 管家 | 模板服务            │
└──────────────────────────────────────────────────────────────┘
            ▲                ▲                  ▲
            ▼                ▼                  ▼
┌──────────────────────────────────────────────────────────────┐
│  内核层                                                       │
│  chokidar 监听 | mdast 解析 | 双链计算 | LanceDB RAG | 模板解析│
└──────────────────────────────────────────────────────────────┘
            ▲                ▲                  ▲
            ▼                ▼                  ▼
┌──────────────────────────────────────────────────────────────┐
│  数据层（用户磁盘 + 本地用户目录）                              │
│  • 用户选定的知识库根目录：Markdown + 模板配置文件              │
│  • ~/.forgenote/：SQLite 配置/日志、LanceDB 向量库、缓存        │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 进程模型
- **主进程（Main）**：唯一拥有文件系统、SQLite、向量库、HTTP（LLM）、子进程权限的进程；负责所有 IO 与 CPU 重活。
- **预加载（Preload）**：通过 `contextBridge` 暴露最小化、类型化的 IPC API（`window.forge.fs.*`、`window.forge.ai.*` 等），不暴露 `ipcRenderer`、Node 全局对象。
- **渲染进程（Renderer）**：纯 UI，不直接访问 Node / fs；通过 IPC 拉数据，所有数据落盘操作回主进程。

> 启用 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`（preload 走 safeStorage 加密敏感字段）。

---

## 四、核心模块设计

### 模块 1：本地文件内核

#### 4.1 知识库挂载
- 用户在「设置 → 知识库」选择本地文件夹（macOS `dialog.showOpenDialog({properties:['openDirectory']})`）。
- 写入 `~/.forgenote/kbs.json`（每个知识库一个条目：`id / rootPath / name / templateId / createdAt`）。
- 挂载时执行：
  1. 扫描根目录，构建 `tree.json`（一次性，缓存于 `~/.forgenote/<kbId>/`）。
  2. 启动 chokidar 监听（`usePolling: false`、Mac 走 FSEvents）。
  3. 读取 `.kb_template.json`（若有）→ 注册模板目录、图标、说明。

#### 4.2 文件监听与增量同步
- chokidar 事件 → 主进程事件总线 `fsEvents`。
- 事件类型：`add / unlink / change / addDir / unlinkDir`。
- 处理管线：
  ```
  chokidar 事件
    → debounce 200ms（避免编辑器多事件）
    → 解析 Markdown → 更新内存 Tree
    → 增量更新双链索引（出链/入链图）
    → 增量更新 LanceDB（按文件 hash 跳过未变更）
    → 推送 IPC 事件给 Renderer
  ```
- 外部编辑器（VSCode/Typora）写文件：使用 chokidar `awaitWriteFinish` + 文件大小/内容 hash 比对，避免读到半写状态。
- 冲突策略：本地永远以磁盘为准；APP 内编辑直接落盘（带 200ms 防抖），不锁文件。

#### 4.3 Markdown 读写
- 读：UTF-8 → 简单 FrontMatter（`gray-matter`）→ 主体文本。
- 写：原子写（先写 `*.tmp` → `fs.rename`），避免外部读到半文件。
- 空白文件：首次创建时写入最小骨架（`# 标题\n\n`）。

#### 4.4 编辑器（CodeMirror 6）
- Markdown 模式 + GFM + 表格 + 任务列表。
- 自定义扩展 `[[wiki-link]]`：输入 `[[` 弹出笔记选择器（基于双链索引）；渲染时若目标存在显示为链接，不存在显示为红色虚线。
- 实时保存：编辑 → debounce 300ms → IPC `fs.writeNote`。
- 大文件策略：> 1MB 切换到「只读 + 分块预览」模式，避免卡顿。

#### 4.5 性能指标
- 10000 文件下冷启动 < 2s（懒加载：先构建一级目录，后续层级 lazy）。
- 文件变动 → 索引更新 < 100ms（增量）。
- 目录树滚动虚拟化：`@tanstack/react-virtual`。

---

### 模块 2：双结构知识组织

#### 4.6 物理目录树
- 数据源：`tree.json`（首扫生成）+ chokidar 实时事件。
- 状态：Zustand `useTreeStore`（`{ nodes, expanded, selected, filter }`）。
- 节点类型：
  - `kb_root`：知识库根（图标 + 名称 + 模板标识）。
  - `dir`：普通目录 / **模板目录**（带 `templateId` + `templateIcon`，悬停 tooltip 显示 `README.md` 前 3 行）。
  - `file`：Markdown 笔记。
  - `special`：`README.md` / `AI_CONFIG.md` / `.template.md`（在树中弱化展示，不计入笔记数）。
- 操作：新建/重命名/删除/移动/折叠/拖拽。
- 计数：仅统计 `*.md` 且非 README/AI_CONFIG/.template。

#### 4.7 双向链接体系
- 解析：在内核层 `mdast-util-wiki-link` 自定义插件 + 标准 `[[...]]` 正则。
- 索引：内存图 `Map<noteId, { outlinks: Set<noteId>, inlinks: Set<noteId>, brokenLinks: Set<string> }>`。
- 文件变动时 diff 出链集，局部更新入链。
- 「链接面板」显示当前笔记的入链/出链/失效链接（红标），点击跳转。
- 「反向链接自动补全」：当 A 新增指向 B 的链接，触发一次轻量 AI 询问是否在 B 中追加 `> 被应用于：[[A]]`，**仅建议**。

#### 4.8 知识图谱
- 渲染：Cytoscape.js，cola 布局。
- 节点样式：按模板目录着色（灵感库=#facc15，项目=#3b82f6，资产=#10b981，…）。
- 性能：千级节点 + 边；超出 2000 节点降级为「按目录聚合 + 展开二级」。
- 「流向高亮」模式：从 `00 灵感库` 出发的链路高亮成彩色箭头。

---

### 模块 3：AI 知识管家

#### 4.9 LLM 客户端抽象
- 统一接口 `ILLMClient`：`chat(messages, opts) → stream | complete`。
- 两个实现：
  - `OllamaClient`：POST `http://127.0.0.1:11434/api/chat`，流式 NDJSON。
  - `RemoteOpenAIClient`：POST `{baseUrl}/chat/completions`，Bearer Token。
- 配置存于 SQLite，API Key 通过 `safeStorage.encryptString` 落盘。

#### 4.10 提示词组装（核心中的核心）
所有 AI 行为都遵循「系统提示词 = 基础宪法 + AI_CONFIG.md + 当前上下文」：

```
System Prompt
├── 1) 基础宪法（硬编码，写死）
│   - 你是本地知识管家，所有回答必须基于用户提供/检索到的笔记
│   - 不得编造笔记内容、不得引用不存在的文件
│   - 所有结构性变更（移动文件、插入链接、改写笔记）必须经用户确认
├── 2) AI_CONFIG.md 内容（每次调用时从磁盘读，5s 内复用缓存）
├── 3) 当前任务专属指令
│   - 归纳推荐：输出 JSON { suggestions: [{ dir, reason, confidence }] }
│   - 链接推荐：输出 JSON { links: [{ target, kind: 'flow'|'semantic', reason }] }
│   - 卡片锻造：输出标准化卡片 Markdown
│   - RAG 问答：先引用片段，再总结
└── 4) 检索片段（仅 RAG / 归纳 / 链接时）
```

#### 4.11 嵌入与 RAG
- 嵌入模型：`bge-small-zh-v1.5`（transformers.js，首次启动下载至 `~/.forgenote/models/`）。
- LanceDB 表结构：
  ```
  chunks(id, kbId, notePath, templateDirId, heading, content, vector, mtime)
  ```
- 检索流程：用户问题 → embed → ANN topK=20 → 拼到 prompt → LLM 生成 → 引用 `[[notePath#heading]]` 溯源。
- 写入策略：单文件改动 → 切块（按 H1/H2/段落，max 512 字）→ 删旧增新。

#### 4.12 智能整理
1. **双向链接推荐**：保存笔记时（若开关开启）→ 取笔记内容 + 候选 topK=20（向量相似）→ LLM 返回 3-5 条候选 → 弹确认卡（强相关 / 流向建议 / 弱相关标签）。
2. **孤岛检测**：每周一次扫 `inlinks.size==0 && outlinks.size==0` 的笔记，列表展示。
3. **摘要 / 关键词**：选中笔记 → 顶部按钮 → 流式输出。
4. **简单归类**：读取笔记前 500 字 + 7 个目录的 README 摘要 → 调 LLM 输出 top1 目录。

#### 4.13 V1.1 模板驱动三大引擎
- **归纳推荐引擎** `Recommender`：
  1. 读 `AI_CONFIG.md` 与各目录 `README.md`。
  2. 笔记文本 → 嵌入向量 → 与 7 个目录的「代表向量」（每个目录取 README 嵌入并缓存在 LanceDB）做相似度。
  3. 合并相似度 + LLM 二次判断 → 输出 Top 3 + 理由 + 置信度。
  4. UI 弹「归纳推荐」卡片：用户点击 `移动到 XX 目录` / `保留原位` / `总是放入该目录`。
- **链接推荐引擎** `LinkSuggester`：见 4.12 第 1 点，且优先按模板流向规则排序（`flowRules` 来自 `AI_CONFIG.md`）。
- **知识卡片锻造引擎** `CardForger`：
  1. 用户在灵感库右键 → 「锻造为知识卡片」。
  2. 取笔记全文 + AI_CONFIG 中卡片模板 → LLM 输出标准化卡片（参考 PRD 附录 C）。
  3. 弹「卡片预览」Modal，用户可编辑 → 确认。
  4. 确认后：
     - 新卡片文件写入目标目录（用户可选 01/02/06）。
     - 原笔记追加 `> 已加工：[[新卡片]]`，并可选「移入 04 归档」。

#### 4.14 双通道降级
当本地模型不可用且远端未配置时：
- 「无 AI 降级模式」：归纳推荐退化为 TF-IDF 关键词与 7 目录 README 关键词重合度排序；链接推荐退化为标题级余弦相似度 + 同目录优先。
- 顶部 toast 提示「当前无 AI 模型可用，已切换到本地规则引擎」。

---

### 【V1.1 新增】模块 4：知识库模板系统

#### 4.15 模板数据结构
- 内置模板存放于 `resources/templates/para-plus/`，应用时**复制**到用户知识库根目录（不引用，不修改原模板包）。
- 模板元数据 `.kb_template.json`：
  ```json
  {
    "templateId": "para-plus",
    "name": "姜胡说 PARA+",
    "version": "1.0.0",
    "author": "ForgeNote Official",
    "description": "基于 PARA 扩展的内容创作者知识生产管线",
    "dirs": [
      { "id": "00", "name": "灵感库", "icon": "💡", "color": "#facc15",
        "readme": "00 灵感库/README.md", "noteTemplate": "00 灵感库/.template.md",
        "flow": ["01", "02", "06"], "sink": false },
      ...
    ],
    "aiConfig": "AI_CONFIG.md"
  }
  ```
- `AI_CONFIG.md` 集中定义：目录语义、放入标准、流转规则、归纳/链接/锻造规则、禁止事项。
- `.template.md` 隐藏文件，定义该目录下新建笔记的初始内容，支持 `{{date}}` / `{{time}}` / `{{kbName}}` 变量。

#### 4.16 模板应用向导（Renderer 流程）
1. 用户在「设置 → 知识库模板」点击「应用模板到当前知识库」。
2. 向导 Step 1：展示模板信息（目录树、设计理念、适用人群）。
3. Step 2：勾选需要创建的子目录（默认全选，可取消 `05 技能`）。
4. Step 3：冲突处理预览——若 `01 项目` 已存在，标灰「已存在，跳过」；缺失项会创建。
5. 确认后主进程执行：
   - 创建缺失目录 + `README.md` + `.template.md`。
   - 创建/合并 `AI_CONFIG.md`（用户已存在则**追加注释而非覆盖**，并提示合并）。
   - 创建 `.kb_template.json`。
   - 写 `~/.forgenote/audit.log`（操作审计）。
6. 弹「3 步新手引导」覆盖层（可在设置中关闭）：
   - ① 查看 `00 灵感库/README.md`
   - ② 新建第一条灵感
   - ③ 体验 AI 归纳推荐

#### 4.17 模板解析与运行时注入
- 启动时主进程 `TemplateService.load(kbPath)`：
  - 读 `.kb_template.json` → 注册到 `kb.template` 状态。
  - 监听 `.kb_template.json` / `AI_CONFIG.md` / `*/README.md` / `*/.template.md` 变更（chokidar 单独 watch 模式）→ 5s 内热更新内存缓存。
- AI 调用时 `PromptBuilder` 读取最新 AI_CONFIG（防抖 5s 缓存），保证用户外部编辑器修改后无需重启 APP 立即生效。

#### 4.18 目录使用说明面板
- 选中模板目录时，右侧 30% 宽度面板展示 `README.md` 渲染结果。
- 顶部「编辑」按钮：复用 CodeMirror 编辑 `.md`，保存时原子写。
- 悬停目录树节点 tooltip：取 `README.md` 前 3 行（去除标题与空行）。

#### 4.19 笔记模板
- 「新建笔记」Modal：默认勾选「套用该目录模板」，用户可取消改为空白。
- 模板变量替换：`{{date}}` → `YYYY-MM-DD`，`{{time}}` → `HH:mm`，`{{kbName}}` → 知识库名。

#### 4.20 模板导入/导出
- **导出**：打包知识库根目录下 `.kb_template.json` + `AI_CONFIG.md` + 所有 `*/README.md` + `*/.template.md` 为 ZIP，重命名 `*.kbtemplate`。
- **导入**：
  1. 用户选择 `.kbtemplate` 文件。
  2. 解压到临时目录 → 校验 `manifest.json`（模板 ID、版本、必需文件）。
  3. 二次确认 → 复制到目标知识库（同样遵守「不覆盖、跳过存在」）。
  4. 若导入的是第三方模板且与内置 `para-plus` 同 ID，弹「重命名模板 ID」提示。

#### 4.21 模板管理面板
设置页新增「知识库模板」Tab：
- 当前模板信息（来源、版本、应用日期、目录数）。
- 操作：[重置为默认] [导出] [导入新模板] [移除模板标识（转普通目录）] [切换 AI_CONFIG 配置集]。

---

### 模块 5：基础工具

#### 4.22 搜索
- 全文搜索：基于 SQLite FTS5（`notes_fts` 虚表），增量更新。
- 文件名搜索：内存 trie。
- 双链搜索：基于双链索引图遍历。
- 标签：解析 FrontMatter `tags` + 内联 `#tag`。
- 模板目录过滤：在搜索结果顶部加目录多选筛选。

#### 4.23 标签
- 解析：`tags: [a, b]` 与正文 `#tag`。
- 标签云：按使用频次展示，点击过滤笔记。
- 标签面板：左下角侧边栏可折叠。

#### 4.24 主题
- 暗/亮主题，CSS 变量驱动；首次启动跟随系统。
- 设计稿采用接近 Obsidian 的米色 + 红色点缀（首页 Slogan 与按钮为 `#e53935`）。

#### 4.25 备份指引
- 设置页提供「Git 同步教程」「本地备份教程」折叠卡片。
- 后续可拓展「一键打包当前知识库为 zip」。

---

## 五、关键流程时序

### 5.1 新建笔记 + AI 归纳 + AI 链接推荐

```
[Renderer]              [Main]                [chokidar]   [LLM]
   │ 用户新建笔记         │                      │           │
   ├─ IPC: createNote ──►│                      │           │
   │                     ├─ 写空白文件+模板 ──►磁盘         │
   │                     │◄─ ok                 │           │
   │◄─ 新笔记打开 ────────┤                      │           │
   │ 用户输入内容          │                      │           │
   ├─ 自动保存 debounce ──►│                      │           │
   │                     ├─ 原子写磁盘          │           │
   │                     ├─ 解析+嵌入           │           │
   │                     ├─ 索引更新            │           │
   │                     ├─ 触发AI归纳引擎 ──────────────► │
   │                     ├─ 触发AI链接推荐引擎 ──────────► │
   │                     │◄─ suggestions ─────────────────┤
   │◄─ IPC: ai.suggest ──┤                      │           │
   │ 弹「归纳推荐」卡片    │                      │           │
   │ 弹「链接推荐」卡片    │                      │           │
   │ 用户勾选确认         │                      │           │
   ├─ IPC: applySuggest ─►│                      │           │
   │                     ├─ 移动文件            │           │
   │                     ├─ 插入 [[]]           │           │
   │                     ├─ 写 audit.log        │           │
   │◄─ 完成               │                      │           │
```

### 5.2 灵感库锻造知识卡片

```
[Renderer]              [Main]                [LLM]
   │ 选中灵感笔记右键      │                      │
   ├─ IPC: forgeCard ───►│                      │
   │                     ├─ 读笔记+AI_CONFIG ──►│
   │                     ├─ LLM 锻造 ──────────►│
   │                     │◄─ 卡片草稿+推荐目标 ──┤
   │◄─ 预览 Modal ────────┤                      │
   │ 用户编辑+确认         │                      │
   ├─ IPC: confirmForge ─►│                      │
   │                     ├─ 写入新卡片到目标目录  │
   │                     ├─ 原笔记追加引用       │
   │                     ├─ 可选移入 04 归档      │
   │                     ├─ 写 audit.log         │
   │◄─ 完成 + 跳转新卡片 ──┤                      │
```

---

## 六、数据存储设计

### 6.1 用户磁盘（数据主权）
- 用户选定的根目录：所有 `*.md` 笔记 + 模板配置文件。
- 备份/迁移：直接打包文件夹即可。

### 6.2 `~/.forgenote/`（APP 本地目录，**不**含笔记内容）
```
~/.forgenote/
├── config.json                # 全局设置（主题、最近打开、是否首次启动）
├── kbs.json                   # 知识库列表
├── <kbId>/
│   ├── tree.json              # 目录树缓存
│   ├── index/
│   │   ├── lancedb/           # 向量库
│   │   ├── notes_fts.db       # SQLite FTS5
│   │   └── links.json         # 双链图
│   ├── audit.log              # AI 操作审计
│   └── template-cache.json    # 模板元数据缓存
├── models/                    # transformers.js 模型缓存
└── logs/
```

### 6.3 SQLite 表（节选）
- `kbs(id, name, root_path, template_id, created_at)`
- `notes_meta(path, kb_id, mtime, size, template_dir_id)` — 仅元数据，不存内容。
- `notes_fts(path, content)` — FTS5 虚表。
- `tags(note_path, tag)`
- `ai_config_presets(kb_id, name, content, active)`
- `audit_log(id, kb_id, ts, action, payload_json)` — AI 操作可回溯。

---

## 七、安全与隐私

1. **contextIsolation + sandbox**：渲染进程无 Node 权限。
2. **CSP**：`default-src 'self'; connect-src 'self' http://127.0.0.1:11434 https://api.deepseek.com https://api.openai.com;`（按用户在设置中配置的远端域名动态生成）。
3. **API Key 加密**：`safeStorage.encryptString`（Windows DPAPI / macOS Keychain / Linux libsecret），明文不落盘。
4. **网络策略**：默认禁止任何对外网络；只有在「设置 → 模型」中显式启用远端模型后才放行对应域名。
5. **AI 操作审计**：`audit.log` 记录所有移动/插入/锻造行为，UI「操作历史」面板可查看与撤销。
6. **无遥测**：构建时移除任何分析 SDK；安装包不包含任何后台联网探针。

---

## 八、性能与稳定性工程

### 8.1 性能策略
- **懒加载**：目录树首层先渲染，展开时再请求子树数据。
- **虚拟滚动**：目录树、笔记列表、搜索结果。
- **Worker 隔离**：嵌入计算、Markdown 解析、卡片锻造放入 Node `worker_threads` 或 Electron UtilityProcess，不阻塞主进程。
- **批处理**：chokidar 事件 debounce 200ms 后批量更新索引。
- **渲染节流**：编辑器输入与目录树更新不直接同步，50ms 节流。
- **大文件保护**：单文件 > 1MB 切只读；图谱节点 > 2000 降级。

### 8.2 稳定性
- 所有 IO 异常捕获并 toast 提示，不崩溃。
- 启动自检：磁盘权限、LanceDB 可写、模型可用性。
- 升级兼容：`.kb_template.json` 带 `version` 字段，迁移时执行 `migrations/`。
- 卸载清理：`app.getPath('userData')` 由用户决定是否删除（提供「保留本地数据」选项）。

---

## 九、可扩展性设计

1. **多知识库**：知识库即 `kbId` 维度隔离；UI 支持顶部切换。
2. **多模板**：`TemplateService` 注册表模型，内置 + 用户导入模板并存。
3. **多模型**：LLM 客户端注册表，用户可添加自定义 OpenAI 兼容端点。
4. **多 AI_CONFIG**：同一知识库可保存多套 `AI_CONFIG`，设置中切换（如「工作模式 / 创作模式」）。
5. **插件系统（V1.2 路线）**：通过 `manifest.json` + sandboxed JS 暴露扩展点（自定义目录右键菜单、自定义 AI 提示词片段）。V1.1 不做。

---

## 十、里程碑与工程任务拆分

### M1：脚手架与文件内核（2 周）
- 初始化 electron-vite + React + TS。
- 主/预加载/渲染三层基线、安全配置。
- chokidar 监听、目录树、编辑器（CodeMirror 最小版）。

### M2：双结构体系（2 周）
- 双向链接解析 + 索引 + 面板。
- 知识图谱（Cytoscape）。

### M3：本地 AI + RAG（2 周）
- transformers.js 嵌入、Ollama 接入。
- LanceDB 集成、RAG 问答 UI。

### M4：V1.1 模板系统（3 周）
- 模板打包 + 应用向导。
- AI_CONFIG 动态注入。
- 归纳/链接/锻造三引擎 + 确认弹窗。
- 目录说明面板、笔记模板。

### M5：打磨与发布（1 周）
- 主题、搜索、设置、备份指引。
- 新手引导、操作审计与撤销。
- 打包、签名、Windows/macOS 安装包。

---

## 十一、风险与应对（工程视角）

| 风险 | 应对 |
| --- | --- |
| 大库（1w+ 文件）启动慢 | 懒加载目录树、SQLite FTS5 索引预热、嵌入计算放 Worker |
| chokidar 漏事件 / 重复事件 | `awaitWriteFinish` + 200ms debounce + hash 幂等 |
| 嵌入模型首启下载慢 | 首次启动预下载（设置中可跳过），UI 进度条 |
| Ollama 未启动 | 检测 `127.0.0.1:11434`，未启动时降级到本地规则引擎 + 顶部提示 |
| AI_CONFIG.md 被改坏 | 解析失败时回退上一版 + 提示用户；提供「重置为默认」按钮 |
| 模板目录被用户外部删除/重命名 | 模板服务监听变化自动降级为「普通目录」，不报错 |
| 卡片锻造 LLM 超时 | 60s 超时降级为「基于大纲的本地拆分」草稿 |
| 远端 API Key 泄漏 | 仅经 safeStorage 加密落盘；内存中也不保留明文，调用时临时解密 |
| Windows 路径大小写 | 主进程统一使用绝对路径，索引时按 `path.normalize` 比较 |

---

## 十二、开放问题（待与产品确认）

1. V1.1 是否需要「多知识库并行打开」？当前设计为单知识库 + 切换。
2. 卡片锻造 LLM 输出是否允许「拆分多张卡片」？当前设计 1→1。
3. 第三方模板是否做「签名校验」？当前不做（开源生态信任模型）。
4. 是否在 V1.1 引入「项目维度的看板视图」（基于 01 项目目录）？当前不在范围内。

---

## 附录 A：IPC 接口清单（节选）

```ts
// 文件
forge.fs.listTree(kbId)
forge.fs.createNote(kbId, dirPath, templateId?)
forge.fs.writeNote(kbId, notePath, content)
forge.fs.deleteNote(kbId, notePath)
forge.fs.moveNote(kbId, fromPath, toPath)
forge.fs.renameNote(kbId, oldPath, newName)

// 双链
forge.links.getBacklinks(kbId, notePath)
forge.links.getOutlinks(kbId, notePath)
forge.links.suggest(kbId, notePath): Promise<LinkSuggestion[]>

// AI
forge.ai.ask(kbId, question, opts): AsyncIterable<string>  // 流式
forge.ai.summarize(kbId, notePath)
forge.ai.suggestDir(kbId, notePath): DirSuggestion[]      // 归纳
forge.ai.suggestLinks(kbId, notePath): LinkSuggestion[]   // 链接
forge.ai.forgeCard(kbId, notePath): CardDraft             // 锻造
forge.ai.applySuggestion(payload)                          // 用户确认

// 模板
forge.template.list()
forge.template.apply(kbId, templateId, selections)
forge.template.export(kbId): Buffer
forge.template.import(kbId, fileBuffer)
forge.template.getAIConfig(kbId): string
forge.template.getDirReadme(kbId, dirPath): string

// 配置
forge.config.getAIConfigPresets(kbId)
forge.config.setActiveAIConfig(kbId, name)
forge.kb.list() / forge.kb.add() / forge.kb.remove()
```

## 附录 B：关键依赖版本基线

- electron ^30
- react ^18
- vite ^5
- typescript ^5.4
- codemirror ^6
- chokidar ^3
- lancedb ^0.10
- @xenova/transformers ^2
- cytoscape ^3
- better-sqlite3 ^11
- electron-vite ^2
- electron-builder ^24
- zustand ^4
- tailwindcss ^3
