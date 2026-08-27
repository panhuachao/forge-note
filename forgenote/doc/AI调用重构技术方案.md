# 锦囊笔记 · AI 调用重构技术方案

> 版本：v1.0（草案）
> 目标：在现有 AI 能力基础上，统一调用层、提升「调用便捷性」与「能力扩展性」，为后续重做知识库 AI 使用能力（锻造 / 归档 / 链接 / 检索增强 / 智能写作）打好底座，并预留 **Skill（技能）** 与 **MCP（模型上下文协议）** 的可插拔配合机制。

---

## 1. 现状梳理（as-is）

### 1.1 调用入口现状

AI 调用分散在多条路径，且形态不统一：

| 能力 | 调用位置 | 实现方式 | 形态 |
|---|---|---|---|
| 首页问答 | `ChatPage` / `HomePage` | `window.forge.ai.ask(kbId, q)` | 一次性 Promise（非流式） |
| 灵感工坊 | `InspirationPage` | `ai.ask` | 一次性 Promise |
| 笔记对话 | `NoteAIChat` / `RightPanel` | `ai.ask` | 一次性 Promise |
| 快速笔记 | `kb-store.createQuickNote` | 主进程 `aiService.quickNote` | 结构化解析 |
| AI 归档 | `NotePane` / `MultiNoteEditor` | `aiService.suggestDir` | 结构化解析 |
| AI 链接 | 同上 | `aiService.suggestLinks` | 结构化解析 |
| 知识卡片锻造 | `InspirationPage` | `aiService.forgeCard` | 结构化解析 |
| AI 摘要/标签 | `NotePane` | `aiService.summarizeTags` | 结构化解析 |
| 知识库诊断 | `DiagnosePage` | `aiService.diagnose` | 结构化解析 |
| 每日灵感一现 | `InspirationPage` | `aiService.dailyInsight` | 一次性 Promise |

### 1.2 主进程 AI 内核现状（`ai-service.ts`）

- **单一服务类 `AIService`**，承载：模型配置读取、聊天协议适配（`callOpenAI` / `callOllama`）、以及一长串业务方法（`ask`、`quickNote`、`suggestDir`、`suggestLinks`、`forgeCard`、`summarizeTags`、`dailyInsight`、`diagnose`…）。
- **协议适配**：`callOpenAI` 支持流式（`stream:true`）但仅用于聊天；业务方法全部一次性 `chat()`。
- **Prompt 来源混合**：
  - 硬编码 Prompt（如 `quickNote` 的 system 提示词）写在 `ai-service.ts` 内；
  - 用户可编辑的固定提示词（每日灵感、灵感方向、对话快捷提问）放在 `@shared/types/ai.ts` 的 `DEFAULT_AI_PROMPTS`，由 `AIConfigPreset` 持久化；
  - 知识库级 `AI_CONFIG.md` 由 `kb-store` 单独读取。
- **降级**：无统一降级层。`quickNote` 在未配模型时直接抛错被 UI 拦截；而 `ask`/`suggestDir` 等同样依赖实时调用，未配模型时全部失败。
- **可观测性**：仅 `console.log` 打印 token 用量与耗时，无统一埋点、无错误分类、无重试。

### 1.3 渲染层 AI 调用现状

- 通过 `preload` 暴露的 `window.forge.ai.*` 调用主进程 IPC。
- 每个 UI 组件（AIChat / ChatPage / NotePane / InspirationPage…）各自写 `try/catch` + `pushToast`，**无统一加载态/流式渲染/取消**封装。
- `AIChat` 组件把 AI 回答当成普通字符串拼接，无法承载「工具调用」「引用来源」「结构化卡片预览」等富结果。

### 1.4 当前痛点

1. **调用不统一**：业务方法和 `ask` 两套语义并存；新增一个 AI 能力要在主进程加方法 + IPC handler + preload 暴露 + 渲染层 try/catch，至少 4 处改动。
2. **Prompt 不可治理**：硬编码 Prompt 散落、用户可编辑与库级配置三套并存、缺少版本与变量注入规范。
3. **无流式 / 无取消**：长回答阻塞、用户无法中断；结构化能力（卡片、归档）无法渐进呈现。
4. **无 Skill 抽象**：每个能力是一个写死的方法，无法被组合、复用、按场景编排（例如「先诊断 → 再归档 → 再链接」无法编排成一条流水线）。
5. **无 MCP**：AI 目前只能被动接收「已准备好的上下文」；无法让模型在推理过程中**主动调用**知识库工具（检索、读笔记、写笔记、跑诊断），也对接不了外部 MCP 服务（日历、浏览器、数据库）。
6. **扩展性差**：要接入新模型（如 Claude / Gemini / 本地推理框架）需要改协议分支；要加新能力需要复制粘贴 `chat()` + `parseXXX`。

---

## 2. 重构目标（to-be）

| 维度 | 目标 |
|---|---|
| 便捷性 | 新增一个 AI 能力 = 声明一个 Skill（含 Prompt + 输入输出 Schema），无需改主进程/IPC/渲染骨架 |
| 扩展性 | 模型、工具、Skill 插件化；支持多模型路由、流式、取消、重试、降级 |
| 知识库增强 | 以 MCP 工具为「手」，以 Skill 为「脑」，让 AI 能检索/读写/诊断知识库，而非仅消费预设上下文 |
| 一致性 | 所有 AI 调用走统一 `AIHub`；统一流式、错误、埋点、降级 |
| 可观测 | 统一 token/耗时/成功率统计，进入既有审计（AuditPage）体系 |

---

## 3. 总体架构

```
┌─────────────────────────── 渲染进程 ───────────────────────────┐
│  UI 组件 (ChatPage / NotePane / InspirationPage / 快速笔记 ...)   │
│        │ 调用统一封装                                            │
│        ▼                                                        │
│  useAI()  Hook  ── 流式渲染 / 加载态 / 取消 / 错误 toast          │
│        │  (preload) IPC                                         │
└────────┼───────────────────────────────────────────────────────┘
         │ IPC (ai:run / ai:stream / ai:tool)
┌────────▼────────────────────────── 主进程 ─────────────────────┐
│  AIHub（统一编排入口）                                            │
│   ├─ ModelRouter      模型路由 / 降级 / 重试 / 限流              │
│   ├─ PromptRegistry   Prompt 治理（硬编码/用户/库级/变量注入）    │
│   ├─ SkillEngine      加载 / 校验 / 执行 Skill                   │
│   │     └─ 内置 Skill：ask / quickNote / suggestDir / suggestLinks│
│   │                    / forgeCard / summarizeTags / diagnose / dailyInsight│
│   ├─ ToolRuntime      MCP 工具运行时（本地工具 + 外部 MCP Server）│
│   └─ Observability    埋点 → AuditPage                          │
│        │                                                        │
│  Protocol Adapters: OpenAIAdapter / OllamaAdapter / (可扩展)     │
│        │                                                        │
│  MCP Layer: 本地 MCP Server（知识库工具）/ 外部 MCP Client        │
└────────────────────────────────────────────────────────────────┘
```

---

## 4. 统一调用层：AIHub

### 4.1 核心接口

```ts
// 所有 AI 调用的唯一入口
interface AIRequest {
  skill: string;            // 技能 id，如 'ask' | 'quick-note' | 'forge-card'
  input: Record<string, unknown>;  // 结构化入参（由 Skill 的 inputSchema 约束）
  kbId?: string;            // 知识库上下文
  stream?: boolean;         // 是否流式
  signal?: AbortSignal;     // 取消
  modelOverride?: string;   // 临时切换模型
}

type AIResponse =
  | { kind: 'text'; text: string }
  | { kind: 'structured'; data: unknown }       // 按 Skill outputSchema 解析
  | { kind: 'stream'; chunks: AsyncIterable<string> }
  | { kind: 'tool'; steps: ToolCallStep[] };      // 工具调用轨迹（MCP）

class AIHub {
  async run(req: AIRequest): Promise<AIResponse>;
  stream(req: AIRequest): AsyncIterable<AIStreamEvent>;
}
```

渲染层只调用 `aiHub.run({ skill:'ask', input:{ question }, kbId })`，不再感知 `ask` / `quickNote` 差异。

### 4.2 会话上下文与多轮确认执行（核心能力）

当前 `ask` 是一次性 `chat(user, sys)`，模型**无记忆**。这导致经典场景无法闭环：用户问「对知识库整理有什么建议」→ AI 给出方案 → 用户回「好的，按这个来」→ AI 必须**基于上一轮的完整建议**继续响应并执行处理。重构后需把「上下文」作为一等公民。

#### 4.2.1 会话（Session）模型

```ts
interface AITurn {
  role: 'user' | 'assistant' | 'tool';   // tool = MCP 工具执行轨迹
  text?: string;                          // user/assistant 文本
  toolCalls?: ToolCallStep[];            // assistant 发起的工具调用
  toolResults?: ToolResult[];            // 工具返回（写入上下文，供模型下一轮参考）
  skill?: string;
  ts: number;
}

interface AISession {
  id: string;
  kbId?: string;
  skill: string;                         // 会话所属技能（如 'ask' / 'kb-organize'）
  turns: AITurn[];                       // 完整多轮历史
  draft?: unknown;                       // 待确认的「建议草稿」（见 4.2.3）
  createdAt: number;
  updatedAt: number;
}
```

`AIRequest` 扩展会话字段：

```ts
interface AIRequest {
  skill: string;
  input: Record<string, unknown>;
  kbId?: string;
  stream?: boolean;
  signal?: AbortSignal;
  modelOverride?: string;
  sessionId?: string;                    // 携带则续接历史；缺省则新建一次性会话
  history?: AITurn[];                    // 或由 AIHub 从 SessionStore 自动载入
}
```

#### 4.2.2 SessionStore（上下文持久化与回溯）

- 主进程维护 `SessionStore`：按 `sessionId` 存取多轮 `turns`；可持久化到知识库（`.forge/ai-sessions/`）或内存（短会话）。
- 每轮调用前，`AIHub` 自动把历史 `turns` 拼成 messages 注入模型（受 `contextWindow` 约束，超长则摘要裁剪旧轮）。
- 渲染层 `useAI` 持有 `sessionId`，连续提问天然携带上下文——**用户第二句「好的，按这个来」无需重复粘贴建议，模型已看见上文**。

#### 4.2.3 「建议 → 确认 → 执行」模式（Confirm-then-Act）

知识库操作必须「先建议、用户确认后再落盘」（现有安全原则）。会话上下文让该模式可多轮推进：

| 轮次 | 用户 | AI（skill: `kb-organize`） | 上下文态 |
|---|---|---|---|
| 1 | 对知识库整理有啥好建议？ | 给出 3 条建议（结构化 `draft`，仅展示不执行） | `session.draft = 建议A/B/C` |
| 2 | 按建议 B 来 | 读取 `draft` → 调 `kb_suggest_dir` 等工具执行 B → 返回处理结果 | `draft` 被消费，执行经审计 |
| 3 | 把结果也写成卡片 | 基于上两轮上下文 + B 的结果 → 调 `forge-card` | 多轮连贯 |

实现要点：
- Skill 可声明 `awaitConfirm: true`：首轮只产出 `draft`（structured 且 `pending`），不调写类 MCP 工具；
- 用户确认（UI 按钮 / 自然语言「按这个来」）触发新一轮请求，AIHub 把 `session.draft` 作为「已批准计划」注入系统提示，Skill 据此调用写工具执行；
- 自然语言确认（「是」「按建议 B」）由模型结合 `history` 解析为「执行 draft 中的 B」，无需特定按钮——这正是会话上下文的价值。

#### 4.2.4 与 Skill / MCP 的衔接

- **Skill 层**：`kb-organize` 这类技能声明 `stateful: true` + `awaitConfirm`，并复用 `pipe`（§5.3）把上一轮 `draft` 传入下一轮；
- **MCP 层**：工具执行结果（如「已将 5 篇笔记移入 01 项目」）作为 `toolResults` 写回 `session.turns`，下一轮模型可见，形成**感知—决策—执行—再感知**的闭环；
- **审计层**：每轮 `tool` 轨迹入 AuditPage，多轮操作可整体撤销（关联 `sessionId`）。

#### 4.2.5 渲染层会话 UI（补充 §7）

`useAI` 增加会话态：

```ts
function useAISession(skill: string, kbId?: string) {
  const [session, setSession] = useState<AISession>();   // 含多轮 messages + pending draft
  const send = (text: string) => aiHub.run({ skill, input:{ text }, kbId, sessionId: session?.id });
  const confirmDraft = () => aiHub.run({ skill, input:{ confirm: true }, kbId, sessionId: session!.id });
  return { session, send, confirmDraft, cancel };
}
```

UI 展示：建议卡片（带「采纳 / 修改 / 拒绝」）+ 多轮气泡（含工具执行小标签，如「🔧 移动 5 篇」）+ 撤销入口。

### 4.2 ModelRouter（模型路由与韧性）

- **多模型路由**：按 Skill 声明 `capability`（如 `reasoning` / `long-context` / `cheap`）自动选模型；支持用户/库级默认。
- **降级链**：主模型失败 → 降级模型（如 Ollama 本地）→ 最终降级为本地规则引擎（保留现有 `suggestDirForRaw` 思路，封装为 `LocalFallback` Skill）。
- **重试 / 超时 / 限流**：统一在 Router 内，业务 Skill 无感。

### 4.3 PromptRegistry（Prompt 治理）

统一三类 Prompt 来源，按优先级合并并提供变量注入：

```
优先级：库级 AI_CONFIG.md 覆盖 > 用户高级设置 > 内置默认
```

- 每个 Skill 声明 `defaultPrompt` + 可变变量（`{{kbName}}` `{{date}}` `{{notesContext}}` 等）。
- 提供 `renderPrompt(skill, ctx)` → 最终 system/user 文本。
- 用户编辑的提示词集中存 `AIConfigPreset`（已有），新增 Skill 自动获得「可在高级设置编辑」能力。

---

## 5. Skill 机制（能力的可插拔单元）

### 5.1 Skill 定义

一个 Skill = 一段声明式能力单元，零主进程改动即可新增：

```ts
interface Skill {
  id: string;
  title: string;
  description: string;
  capability?: ('reasoning' | 'long-context' | 'cheap')[];
  inputSchema: JSONSchema;     // 入参约束
  outputSchema: JSONSchema;    // 出参结构（结构化能力必须）
  prompt: string;              // 或引用 PromptRegistry key
  parser?: (raw: string, ctx: SkillCtx) => unknown;  // 结构化解析（可选）
  useTools?: string[];         // 需要调用的 MCP 工具 id（见 §6）
  localFallback?: (input, ctx) => unknown;  // 无模型时降级
  ui?: 'chat' | 'card' | 'inline';  // 渲染形态建议
}
```

### 5.2 内置 Skill 映射（迁移现有能力）

| 现有方法 | Skill id | 输出 | 备注 |
|---|---|---|---|
| `ask` | `ask` | text/stream | 首页问答 |
| `quickNote` | `quick-note` | structured | 摘要+标签+双链+归属目录 |
| `suggestDir` | `suggest-dir` | structured | 归档推荐 |
| `suggestLinks` | `suggest-links` | structured | 双向链接推荐 |
| `forgeCard` | `forge-card` | structured | 知识卡片（四铁律） |
| `summarizeTags` | `summarize-tags` | structured | 摘要+标签 |
| `diagnose` | `diagnose` | structured | 知识库诊断 |
| `dailyInsight` | `daily-insight` | text | 每日灵感一现 |

迁移后，`ai-service.ts` 中 ~10 个业务方法收敛为「Skill 注册表 + 一个 `run()`」。

### 5.3 Skill 组合（编排）

未来重做知识库能力时，可用组合 Skill 编排流水线，例如：

```ts
// 「入库流水线」= 诊断上下文中缺失 → 推荐归档 → 推荐链接 → 生成卡片
{
  id: 'ingest-pipeline',
  steps: ['diagnose', 'suggest-dir', 'suggest-links', 'forge-card'],
  pipe: (prev, ctx) => ({ ...ctx, ...prev })
}
```

这一能力在当前散落的方法架构下无法实现，重构后为零成本。

### 5.4 有状态 Skill 与会话上下文（承接 §4.2）

支持多轮确认的 Skill 显式声明状态语义：

```ts
{
  id: 'kb-organize',
  stateful: true,            // 需要跨轮上下文
  awaitConfirm: true,        // 首轮只出 draft，确认后才执行写工具
  inputSchema: { /* question | confirm | draftPatch */ },
  useTools: ['kb_search', 'kb_suggest_dir', 'kb_write_note', 'forge-card'],
  pipe: (prev, ctx) => ({ ...ctx, approvedDraft: prev.draft })  // 把已确认草稿传入下一轮
}
```

- `stateful` 让 `AIHub` 自动挂载 `SessionStore` 历史；
- `awaitConfirm` 让首轮结构化结果标记为 `pending draft`，UI 呈现「采纳/修改/拒绝」，不触发写工具；
- 确认后新一轮请求自动携带 `approvedDraft`，Skill 通过 `pipe` 把它注入上下文并执行——实现「建议→确认→基于前文处理」的闭环（§4.2.3 完整示例）。

---

## 6. MCP 与 Skill 的配合（重点）

### 6.1 定位

- **Skill = 「脑」**：决定做什么、怎么思考（Prompt + 编排）。
- **MCP Tool = 「手」**：让模型在推理中**主动调用**知识库能力（检索 / 读 / 写 / 诊断）或外部服务。

当前 AI 只能消费「调用方预先塞好的上下文」；引入 MCP 后，模型可**自主决定**读取哪些笔记、检索什么、写入哪里——这正是「后期重点提升 AI 在知识库中的使用能力」的关键。

### 6.2 本地 MCP Server：知识库工具

主进程内置一个 **本地 MCP Server**（不依赖外部进程，直接 in-process 暴露工具给模型）：

| 工具 id | 作用 | 对应现有能力 |
|---|---|---|
| `kb_search` | 语义/全文检索知识库 | `fs.query` |
| `kb_read_note` | 读取指定笔记全文 | `fs.readNote` |
| `kb_list_notes` | 列出目录/标签下笔记 | `fs.listNotes` / `listTags` |
| `kb_write_note` | 创建/追加笔记 | `fs.writeNote` |
| `kb_suggest_dir` | 推荐归属目录 | `suggestDirForRaw` |
| `kb_link_graph` | 获取某笔记的双链邻域 | `allLinks` |
| `kb_diagnose` | 知识库健康诊断 | `diagnose` |

工具实现直接复用现有 `fs-service` / `dirInfo` / `allLinks`，**不重复造轮子**。

### 6.3 Skill 如何调用 MCP 工具

声明式：

```ts
{
  id: 'smart-write',                 // 智能写作（未来能力）
  useTools: ['kb_search', 'kb_read_note', 'kb_write_note'],
  prompt: '根据 {{question}}，先检索相关知识，再综合写入笔记。'
}
```

运行时 `SkillEngine` 将工具注入模型（function calling / tool_use），`ToolRuntime` 执行工具并把结果回灌模型，形成 **ReAct 循环**。所有工具调用经 `ToolRuntime` 统一鉴权（写操作需用户确认，对接现有审计）。

### 6.4 外部 MCP 扩展

`ToolRuntime` 同时支持 **外部 MCP Server**（stdio / SSE）：

```ts
// 用户配置外部 MCP（如日历 / 浏览器 / Notion）
mcp.servers = [
  { name: 'calendar', command: 'npx', args: ['-y', '@my/cal-mcp'] },
  { name: 'browser', url: 'http://localhost:3000/mcp' }
]
```

知识库 Skill 可声明 `useTools: ['calendar.list', 'browser.fetch']`，实现「把今天灵感写入日历」「引用网页并归档」等跨域能力。**这是现有架构完全无法做到的**。

### 6.5 安全与审计

- 所有 MCP 工具调用经 `ToolRuntime` 统一登记，写入既有审计系统（`AuditPage`），满足「先建议后确认」原则。
- 写类工具（`kb_write_note` / `kb_suggest_dir` 执行移动）默认需要用户确认；读类工具（`kb_search` / `kb_read_note`）可静默。
- 外部 MCP 默认禁用，需在设置中显式开启并审阅权限。

---

## 7. 渲染层配套（useAI Hook）

统一封装，消除每个组件重复 `try/catch`：

```ts
function useAI(skill: string) {
  const [state, setState] = useState<'idle'|'loading'|'streaming'|'done'|'error'>('idle');
  const run = async (input, { stream, signal } = {}) => { /* 调 aiHub，统一 loading/error/toast */ };
  return { state, run, cancel, last };
}
```

- `AIChat` 升级为富结果渲染：支持 `tool` 轨迹展示（「AI 检索了 3 篇笔记」「写入 1 条卡片」）、`structured` 卡片预览、`stream` 逐字渲染。
- 取消：`AbortController` 贯穿 IPC → AIHub → Protocol Adapter。

---

## 8. 迁移路线（分阶段，低风险）

**阶段 0 · 防腐层（不破坏现有功能）**
- 新增 `AIHub`，内部仍委托现有 `AIService` 方法；渲染层先不动。
- 加 `ModelRouter` 薄封装（暂时只做「降级到本地规则」一处）。

**阶段 1 · Skill 化现有能力**
- 把 8 个业务方法逐一抽成 Skill（`quick-note` / `suggest-dir` / `forge-card` …），`AIHub.run` 按 `skill` 路由。
- 渲染层逐步切到 `aiHub.run`，旧 `window.forge.ai.ask` 保留兼容。

**阶段 1.5 · 会话上下文与确认执行（承接 §4.2）**
- 新增 `SessionStore` + `AIRequest.sessionId`；`AIHub` 自动载入/回写多轮 `turns`。
- 落地首个有状态 Skill `kb-organize`：`awaitConfirm` 首轮出草稿、确认后基于前文执行（§4.2.3 示例）。
- 渲染层 `useAISession` 提供 `send` / `confirmDraft` / 多轮气泡 / 撤销。
- 此阶段即实现用户核心诉求：「问建议 → 确认 → AI 基于前文处理」。

**阶段 2 · PromptRegistry**
- 硬编码 Prompt 迁移到 `PromptRegistry`；用户可编辑提示词统一经 Registry 渲染。

**阶段 3 · 本地 MCP Server**
- 实现 `kb_*` 工具集；先让 `smart-write` / `diagnose` 等 Skill 通过工具调用知识库（替代「预塞上下文」）。
- 接 `ToolRuntime` + 审计。

**阶段 4 · 外部 MCP + 编排**
- 支持外部 MCP 配置；实现 Skill 组合（`ingest-pipeline` 等）；重做知识库 AI 使用能力。

> 每阶段可独立合并、独立验证，且阶段 1 完成后即获得「新增能力只写 Skill」的便捷性收益。

---

## 9. 对现有代码的具体影响

| 文件 | 变化 |
|---|---|
| `main/services/ai-service.ts` | `AIService` 瘦身为 `Protocol Adapters`；业务方法迁移为 Skill 注册 |
| `main/services/ai-hub.ts`（新） | 统一编排入口 |
| `main/services/skill-engine.ts`（新） | Skill 加载/执行 |
| `main/services/tool-runtime.ts`（新） | MCP 工具运行时（本地 + 外部） |
| `main/services/prompt-registry.ts`（新） | Prompt 治理 |
| `shared/types/ai.ts` | 扩展 `Skill` / `AIRequest` / `AIResponse` 类型 |
| `preload/index.ts` | 暴露 `aiHub.run` / `aiHub.stream`（保留 `ai.*` 兼容） |
| `renderer/hooks/useAI.ts`（新） | 统一调用 Hook |
| `renderer/components/AIChat.tsx` | 富结果 + 流式 + 取消 |

---

## 10. 收益小结

1. **新增 AI 能力从 ~4 处改动 → 1 个 Skill 声明**，便捷性质变。
2. **模型/工具/Skill 全部插件化**，扩展性质变。
3. **MCP 让 AI 从「消费上下文」升级为「操作知识库」**，直接支撑「后期重点提升 AI 在知识库中的使用能力」。
4. **Skill + MCP 组合编排**（如入库流水线）成为可能，为知识管理自动化打开空间。
5. **统一流式/取消/降级/审计**，体验与可观测性一致。

---

*（本文档基于当前代码 `ai-service.ts` / `kb-store.ts` / `ChatPage` / `AIChat` / `@shared/types/ai.ts` 梳理，落地时以阶段 0→4 渐进推进。）*
