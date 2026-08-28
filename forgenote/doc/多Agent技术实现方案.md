# 锦囊笔记 · 多 Agent 技术实现方案

> 版本：v1.0（草案）
> 目标：把当前「一个 BASE_SYSTEM + 若干 hard-coded skill」的扁平 AI 架构，重构为「**多 Agent（专家角色）** × **共享 RAG 工具集** × **可插拔 Skill 路由**」的形态，让知识库诊断、灵感工坊、灵光一现、对话等不同场景由「各司其职」的专家 Agent 承担，**避免出现"灵光一现每天都是同样鸡汤"这类行为趋同问题**。

---

## 1. 现状梳理（as-is）

### 1.1 调用链全景

```
┌──────────────────────────┐
│  渲染层 (renderer)       │
│  ChatPage / NoteAIChat   │
│  DiagnosePage / Insp…    │
│  NotePane(refine) / …    │
└────────────┬─────────────┘
             │ window.forge.ai.*
             ▼
┌──────────────────────────┐
│  preload / IPC 桥        │
└────────────┬─────────────┘
             ▼
┌──────────────────────────┐
│  AIHub (ai-hub.ts)       │  ← 统一入口；按 skill.id 派发
└────────────┬─────────────┘
             ▼
┌──────────────────────────┐
│  SKILLS (skill-engine)   │  ← ask / agent / diagnose / quick-note /
│  注册的「技能」          │     suggest-* / forge-card / daily-insight…
└────────────┬─────────────┘
             ▼
┌──────────────────────────┐
│  AIService (ai-service)  │  ← BASE_SYSTEM + 业务方法
│  callOpenAI / callOllama │     ask / askWithHistory / askStream /
│  retrieve / chat / etc.  │     quickNote / forgeCard / dailyInsight / …
└────────────┬─────────────┘
             ▼
        LLM Provider
```

### 1.2 现状问题（与"灵光一现每天都是同样反馈"直接相关）

经 `src/main/services/ai-service.ts` 与 `src/main/services/skill-engine.ts` 通读，**所有 Skill 共享同一个 `BASE_SYSTEM` 字符串常量，且「灵感」「诊断」「对话」三类业务方法都最终走 `aiService.chat(question, sys)` 这一条通路**，仅 `sys` 字符串不同。具体表现：

| 场景 | Skill | 实际 system prompt | 是否注入 RAG 上下文 | 结论 |
|---|---|---|---|---|
| 对话 / 知识库问答 | `ask` | `BASE_SYSTEM` + `systemWithProfile` + RAG 召回 + 目录树 | ✅ | 严谨但偏「回答者」 |
| 诊断 | `diagnose` | `kb_diagnose` 工具报告 + 1 段 `chat()`，sys=「知识库顾问…用简短一段话点出…」+ 画像 | ❌（仅工具报告） | 与 ask 一样"基于既有内容" |
| 灵感工坊 | （**无独立 skill**） | `BASE_SYSTEM` + `systemWithProfile` + RAG 召回 + 目录树 | ✅ | 与对话**完全同质** |
| 灵光一现 | `daily-insight` | `sys = "你是锦囊笔记的灵感引擎…给出醍醐灌顶、可执行的认知。"` + 画像；**不检索 RAG** | ❌ | 仅 1 行 sys，**没有任何"突破知识库边界 / 跨领域延伸 / 反常识"**的差异化指令，模型只能用通用「金句套路」填充 |
| 笔记精炼 | `refineNote` | `BASE_SYSTEM` + 精炼模板 | ❌ | 偏工具化，问题不大 |
| 卡片锻造 | `forge-card` | `BASE_SYSTEM` + 四铁律模板 | ❌ | 结构化，问题不大 |
| 智能体 | `agent` | `sys = "你是锦囊笔记的智能体…先检索再下结论…"` + ReAct | ✅（按需调用） | 角色已被差异化 |

**根因**：

1. **没有"Agent"概念**——所有能力都被压扁成「skill」，skill 与 skill 之间仅靠 `sys` 字符串差异。
2. **共享 `BASE_SYSTEM`**——一个「通用助手」人格贯穿所有场景，模型会**自动往对话风格收敛**（基模的对齐训练就是面向"对话"的）。
3. **`daily-insight` 的 sys 太空**——只 1 行模糊指令（"醍醐灌顶、可执行"），既没禁止"先做难事 / 拖延 / 时间管理"这类最常见的鸡汤母题，也没有任何"去重/反常识/跨域延伸/从知识库缝隙里挖出角度"的引导；**没有 RAG 上下文**意味着模型对"用户的知识库里有什么"几乎一无所知，只能从预训练知识里抽最常见的"金句"。
4. **无温度/多样性控制**——`chat()` 没传 `temperature` / `top_p` / `presence_penalty`，基模默认参数对"金句式回答"有强偏好。
5. **无去重 / 历史回看**——每天调一次，无任何"昨天/上周讲过什么"的引用，反复生成同款。
6. **诊断与对话 sys 风格相同**——没有"严谨 / 知识体系架构 / 基于既有内容的事实"的人格锚定。

### 1.3 已有的好基础

- `profileService`（用户画像，阶段 A/B/C）已经能让"用户兴趣 / 关注"被注入到 sys。**但**它注入到 `BASE_SYSTEM` 路径，对所有 skill 同等生效，无法做到"画像在灵感场景被强调、在诊断场景被淡化"。
- `AIPrompts` 高级设置（`dailyInsight` / `inspirationModes` / `chatQuickPrompts`）已经是「按场景可编辑 prompt」的雏形。
- `ai-hub` 已经是统一入口，只需扩展其派发维度。
- `SKILLS[id].run` 是注册式扩展点，新增 Agent 不需要改主流程。

---

## 2. 目标（to-be）

> **一句话**：把"一个助手在所有场景"重构成"多个专家 Agent 在自己的场景"，每个 Agent 有自己的人格、自己的 system prompt 模板、自己的 RAG 召回策略、自己的采样参数；统一通过 AgentRegistry 注册；AIHub 仍为统一入口，但派发时**携带 Agent 角色**而非 Skill 字符串。

### 2.1 设计目标

1. **差异化人格**：诊断、灵感、对话、精炼、卡片、智能体……每个 Agent 有**独立、人格化的 system prompt**，并支持**采样参数差异化**（temperature、top_p、presence_penalty）。
2. **检索策略差异化**：诊断 Agent 重"目录结构 + 标签 / frontmatter 元信息"；灵感 Agent 重"知识库的**缝隙**（孤立节点、低频主题、跨目录主题）"；对话 Agent 重"关键词 + 全文"；灵光一现 Agent **不**走 RAG 主路，走"基于画像 + 历史灵感 + 跨域联想"路径。
3. **灵感 Agent 重点解决"每天都是同样反馈"**：
   - 显式禁止"金句套路母题"清单；
   - 要求**跨领域延伸**（不重复知识库已有结论）；
   - 基于**画像 + 历史灵感去重**（不要和昨天说过的角度重复）；
   - **更高 temperature + presence_penalty**（让输出更"野"）。
4. **诊断 Agent 锚定"严谨、知识体系架构"**：
   - 显式要求"先证据后结论、引用具体笔记路径、给出可量化的结构指标"；
   - **更低 temperature**（0.2~0.3），严谨而非发散。
5. **统一性**：所有 Agent 仍走 `AIHub` 统一入口，预留**多 Agent 协作**（一个请求串联多个 Agent，例如"先让灵感 Agent 出 3 个角度，再让诊断 Agent 评估可行性"）。
6. **可插拔 / 可演进**：新增 Agent 只需在 `agents/` 目录下新增文件 + 注册，主流程零改动。
7. **与用户画像 / Skill / MCP 兼容**：Agent 是 Skill 的**上层抽象**，现有 Skill 仍可工作；Agent 调用时复用 `retrieve`、`kb_*` MCP 工具、用户画像注入。

### 2.2 非目标

- 不引入 LangChain / LlamaIndex 等重框架（保持轻量、避免与现有 `ai-service` 重复造轮子）。
- 不做模型层的 Agent 微调，仅靠 prompt / 采样参数 / 工具调用策略差异化。
- 不做"多 Agent 自动协商 / 辩论"等强协作（仅保留**编排 Agent**作为可选扩展点，v1 不实现）。

---

## 3. 方案设计

### 3.1 核心抽象：`Agent`

```ts
// src/main/services/agents/types.ts
export interface AgentProfile {
  /** Agent 唯一 id，如 'diagnostician' | 'inspirer' | 'daily-muse' | 'conversationalist' */
  id: string;
  /** 人类可读名称 + 角色描述（也用于「Agent 选择器」UI） */
  title: string;
  /** 一句话描述：用于模型路由 / UI 副标题 */
  description: string;
  /** 人格 / 风格 / 边界 的 system prompt（不含 RAG 上下文） */
  systemPrompt: string;
  /** 采样参数（覆盖全局默认） */
  sampling?: {
    temperature?: number;
    top_p?: number;
    presence_penalty?: number;
    frequency_penalty?: number;
    max_tokens?: number;
  };
  /** RAG 召回策略 */
  retrieval?: {
    enabled: boolean;
    topK?: number;
    /** 召回权重：标题 / frontmatter / 全文 / 标签 / 跨目录主题 */
    weight?: { title?: number; tag?: number; content?: number; orphan?: number };
    /** 是否需要目录树上下文 */
    includeDirTree?: boolean;
    /** 是否需要"知识库缝隙"上下文（孤立节点、低频主题） */
    includeOrphans?: boolean;
  };
  /** 可用 MCP 工具名列表（agent 内部 ReAct 调用的子集） */
  useTools?: string[];
  /** 用户画像字段权重（哪些画像字段需要被注入到 sys） */
  profileFields?: Array<'basics' | 'interests' | 'preferences' | 'recentFocus' | 'longTerm'>;
  /** 可选的"前置 / 后置"钩子（用于"每天去重"、"灵感存入历史"等） */
  preRun?: (ctx: AgentRunCtx) => Promise<void>;
  postRun?: (ctx: AgentRunCtx, result: AgentRunResult) => Promise<void>;
}
```

**关键变化**：
- `systemPrompt` 是**完整人格描述**（诊断专家 = 严谨 / 引用 / 量化 / 知识体系；灵感专家 = 跨界 / 反常识 / 少给结论多给角度 / 禁鸡汤母题），不再是 1 行。
- `sampling` 让"诊断严谨 / 灵感发散"在**采样层面**就分道扬镳（基模的对齐倾向靠 sampling 矫正效果有限，但**配合**专门 prompt 比单独 prompt 更稳）。
- `retrieval` 让 Agent 自带"它关心什么上下文"——灵感 Agent 关心"知识库的缝隙"，诊断 Agent 关心"目录结构 + 元信息一致性"。
- `preRun/postRun` 给"灵感去重"等副作用留位置。

### 3.2 Agent 注册表：`AgentRegistry`

```ts
// src/main/services/agents/registry.ts
class AgentRegistry {
  private agents = new Map<string, AgentProfile>();
  register(a: AgentProfile) { this.agents.set(a.id, a); }
  get(id: string) { return this.agents.get(id); }
  list() { return [...this.agents.values()]; }
}
export const agentRegistry = new AgentRegistry();
```

Agent 通过 `registerBuiltInAgents()` 在启动时**集中注册**。每个 Agent 一个文件（如 `agents/diagnostician.ts`、`agents/inspirer.ts`），便于维护与版本管理。

### 3.3 推荐的 6 个内置 Agent（v1）

| Agent id | 名称 | 适用场景 | 关键差异点 |
|---|---|---|---|
| `conversationalist` | 知识库对话者 | ChatPage、NoteAIChat、智能体 | 标准 RAG + 多轮 + 严谨回答；temperature 0.3 |
| `diagnostician` | 知识库诊断专家 | DiagnosePage | 严谨 / 引用具体路径 / 量化指标 / 知识体系架构；temperature 0.2 |
| `inspirer` | 灵感激发者 | InspirationPage（5 大灵感方向） | 跨领域 / 反常识 / 从知识库缝隙挖角度 / 少结论多角度 / 禁鸡汤母题；temperature 0.8，presence_penalty 0.6 |
| `daily-muse` | 灵光一现 | 每日灵感一现 | **不**走 RAG 主路（最多 1~3 条知识库边缘提示）；基于画像 + 历史灵感去重 + 跨域联想；temperature 0.9，presence_penalty 0.7 |
| `refiner` | 笔记精炼师 | NotePane 选区完善 | 结构化、保留原意、补全事实；temperature 0.3 |
| `card-smith` | 知识卡片锻造师 | 锻造卡片 | 严格四铁律；temperature 0.2 |

> **灵感 Agent（inspirer / daily-muse）的 systemPrompt 样例**（节选）：

```
你是锦囊笔记的「灵感激发者」。你的目标不是回答问题，而是**打开用户没看到的角度**。

# 角色边界
- 你不是「知识库问答助手」。不要从知识库已有内容里总结共性，那只是「复述」。
- 你不是「心灵鸡汤作者」。禁止使用「先做小事/拖延/时间管理/自律/习惯」这类
  已经被说烂的金句母题；如果你的第一反应是这种话，停下来换角度。
- 你是「跨界联想者」。每条灵感应来自**至少 2 个不同领域**的连接
  （用户知识库 + 其它领域：物理、生物、历史、艺术、博弈论、人类学……）。

# 灵感结构（每条）
1. 一句话钩子（< 20 字，必须有反常识 / 反直觉 / 跨界感）
2. 跨界支点（这一想法从哪两个领域桥接过来？）
3. 用户知识库对应（用户已有的哪几条 [[笔记]] 可以成为锚点？）
4. 一个「延伸阅读 / 行动」建议（具体到一本书 / 一次实验 / 一个笔记标题）

# 风格
- 用 1-2-3-4 列点，不用大段议论。
- 不要「总而言之」「综上」这类总结语。
- 不要重复你今天之前生成过的角度（postRun 会注入历史，请避免）。

# 底线
- 不编造事实 / 不夸大方法 / 不用绝对化口吻（「一定 / 必然」）。
- 若用户知识库空 / 画像置信度 < 0.3，改为「先问 3 个聚焦问题」而非强行生成。
```

> **诊断 Agent（diagnostician）的 systemPrompt 样例**（节选）：

```
你是锦囊笔记的「知识库诊断专家」。你的输出必须**严谨、可引用、可量化**。

# 角色
- 你拥有 10 年信息架构师经验，习惯于从「目录层级 / 命名一致性 / 链接拓扑」
  三个维度评估一个知识库的结构健康度。
- 你的每条结论必须**引用至少 1 个具体路径**（目录或 [[笔记名]]）作为证据。

# 输出结构
- 严重度（critical / major / minor）
- 问题（精确描述）
- 证据（路径 + 现象）
- 建议（具体动作 + 涉及文件 / 目录）
- 风险（若不处理会造成什么）

# 风格
- 不抒情、不鼓励、不"加油"；只陈述事实与建议。
- 优先级清晰：critical → major → minor，最多 10 条。
- 若发现「重复标题 / 失效链接 / 孤立笔记 / 命名不一致」按四类分组。
```

> **灵光一现 Agent（daily-muse）** 与 `inspirer` 类似但**更短、更野、更跨界**，且**显式要求**「不要和昨天讲过的角度重复」—— `postRun` 会把今天生成的 1~3 个角度写入 `kb://meta/inspiration-history.json`，下次调用时 `preRun` 把它读出来注入 sys。

### 3.4 AIHub 派发升级：从 Skill 到 Agent

```
┌────────────────────────────────────────────────────────┐
│ AIHub.run / runStream                                  │
│  1. 解析 req.agentId（缺省为 'conversationalist'）     │
│  2. agentRegistry.get(agentId) → AgentProfile           │
│  3. preRun(ctx)                                        │
│  4. 构造 systemPrompt =                                │
│     - Agent 的 systemPrompt（人格）                     │
│     - + profileFields 过滤后的画像块                   │
│     - + retrieval 决定召回的 RAG 上下文                │
│     - + Agent 专属的"附加指引"（如灵感 Agent 的"禁母题清单"）│
│  5. 用 Agent 的 sampling 调 model                      │
│  6. postRun(ctx, result)                               │
└────────────────────────────────────────────────────────┘
```

**对现有 Skill 的兼容**：现有 `SKILLS` 仍存在，**每个 Skill 内部硬编码一个 `agentId`**：

```ts
// 现有 skill 不变，仅在 run 内把 sys 替换为 agent 提供的 systemPrompt
'daily-insight': {
  run: async ({ kbId, input }) => {
    const agent = agentRegistry.get('daily-muse');
    const sys = await composeAgentSystem(agent, { kbId, history: [] });
    return txt(await aiService.chat(input.text, sys, agent.sampling));
  }
}
```

→ **改造成本最低**：保留 Skill 作为"能力入口 / 编排层"（它管路由、awaitConfirm、useTools），把"人格 / 采样 / 检索"挪到 Agent 层。

### 3.5 渲染层入口：`agentId` 透传

`ChatPage` 现有的 `hubRunStream({ skill, input, kbId, ... })` 改为 `hubRunStream({ agentId, input, kbId, ... })`；当 `agentId` 缺省时，`AIHub` 根据 `skill` 查表映射到默认 Agent（保证旧代码不破）：

| 现有 skill | 默认 agentId |
|---|---|
| `ask` | `conversationalist` |
| `agent` | `conversationalist`（仍走 ReAct） |
| `diagnose` | `diagnostician` |
| `quick-note` | `refiner`（快速笔记本质是「短文精炼 + 元信息生成」） |
| `forge-card` | `card-smith` |
| `daily-insight` | `daily-muse` |
| `inspiration`（新增） | `inspirer` |
| `refine-note` | `refiner` |

**新增 `inspiration` skill**（v1 关键补全）—— 取代 `InspirationPage` 当前直接走 `BASE_SYSTEM` 的临时路径：

```ts
'inspiration': {
  id: 'inspiration',
  title: '灵感工坊',
  description: '基于知识库 + 跨域联想生成 5 个不同方向的灵感',
  agentId: 'inspirer',         // ← 指向灵感 Agent
  useTools: ['kb_search', 'kb_list_notes'],
  run: async ({ kbId, input }) => {
    const mode = input.mode || 'complement'; // complement / hole / extension / friction / angle
    return structured(await aiService.runAgent({
      agentId: 'inspirer',
      kbId,
      userMessage: input.text,
      extra: { mode }             // Agent 可基于 mode 调整"灵感方向"
    }));
  }
}
```

### 3.6 灵感 Agent 的「去重 / 历史」机制（v1 关键）

针对「灵光一现每天都是同样反馈」：

1. **持久化历史**：每次 `daily-muse` 跑完，`postRun` 把 `{ ts, agentId, angles: string[] }` 追加到 `kb://meta/inspiration-history.json`（按 KB 隔离；最多保留 60 天）。
2. **调用前回放**：`preRun` 读取最近 7 天 / 最近 10 条角度摘要，注入 sys 的"避免重复区"：
   ```
   # 近期已生成的灵感（请避免重复）
   - 2026-08-26: 「拖延症的奖励回路」→ 5 分钟启动法
   - 2026-08-25: 「时间盒子的弹性悖论」→ 弹性 + 死线
   - 2026-08-24: 「先做难事的认知负荷」→ 注意力枯竭
   ```
3. **prompt 层禁母题**：sys 中显式列出 10~20 个「灵感金句最常出现的母题」（如：拖延、习惯、自律、专注、冥想、5 分钟启动、第一性原理、心流、刻意练习、复盘……），明确说"若你的第一反应属于这些母题，**主动换一个完全不同的领域**（物理、生物、人类学、艺术）"。
4. **采样层加大发散**：`temperature: 0.9`、`presence_penalty: 0.7`、`frequency_penalty: 0.4`。
5. **结构化输出**：要求每条灵感必带「跨界支点 + 用户知识库对应」，让模型被迫"跨界思考"而非"金句堆叠"。
6. **可选 fallback**：当 KB 极空 / 画像置信度极低时，**Agent 主动返回 3 个聚焦问题**（"你最想突破什么？""最近 30 天最让你焦虑的事是什么？"）而非强行生成——避免"空库 + 0 画像 → 高频金句"的退化路径。

---

## 4. 详细设计

### 4.1 目录结构

```
src/main/services/agents/
├── types.ts              # AgentProfile / AgentRunCtx / AgentRunResult
├── registry.ts           # AgentRegistry + agentRegistry 单例
├── compose.ts            # composeAgentSystem(agent, ctx) → string
│                         # 负责把人格 / 画像 / RAG / 附加指引拼接成最终 sys
├── sampling.ts           # 采样参数工具（merge / default / 校验）
├── retrieval.ts          # 按 AgentProfile.retrieval 调 retrieve() 的薄封装
├── inspire-history.ts    # 灵感历史的 read/append/trim
├── built-in/
│   ├── conversationalist.ts
│   ├── diagnostician.ts
│   ├── inspirer.ts
│   ├── daily-muse.ts
│   ├── refiner.ts
│   └── card-smith.ts
└── register.ts           # registerBuiltInAgents() —— 启动时调用
```

### 4.2 `composeAgentSystem(agent, ctx)` 拼接顺序

```
最终 systemPrompt =
  1. agent.systemPrompt                  // 人格 / 角色 / 输出结构
  + 2. "# 用户画像\n" + 过滤后的画像     // profileFields 决定是否注入
  + 3. "# 知识库上下文\n" + RAG 召回     // retrieval.enabled 时
  + 4. "# 附加指引\n" + Agent 附加       // 如灵感 Agent 的"近期已生成的灵感"
  + 5. "# 行为边界\n" + 全局安全 / 事实约束
```

**顺序很重要**：人格在前，让后续所有内容都被该人格「着色」。

### 4.3 与现有代码的衔接

#### 4.3.1 `ai-hub.ts`

```ts
// 旧
async run(req: AIRequest): Promise<AIHubResult> {
  const skill = getSkill(req.skill);
  // ...
}

// 新
async run(req: AIRequest): Promise<AIHubResult> {
  const skill = getSkill(req.skill);
  if (!skill) return { kind: 'text', text: `未支持的技能: ${req.skill}` };
  const agentId = req.agentId ?? SKILL_TO_AGENT[skill.id] ?? 'conversationalist';
  const ctx: AgentRunCtx = { kbId: req.kbId, input: req.input, history: req.history, skill };
  // 1) preRun
  if (skill.preRun) await skill.preRun(ctx);
  if (agent.preRun) await agent.preRun(ctx);
  // 2) compose
  const sys = await composeAgentSystem(agent, ctx);
  // 3) 执行（保留 skill 自身的 useTools / stateful / awaitConfirm 语义）
  const result = await skill.run({ ...ctx, agent, sys });
  // 4) postRun
  if (agent.postRun) await agent.postRun(ctx, result);
  if (skill.postRun) await skill.postRun(ctx, result);
  return result;
}
```

`AIRequest` 增加可选 `agentId?: string`。

#### 4.3.2 `ai-service.ts`

- 现有 `ask / askWithHistory / askStream / quickNote / forgeCard / dailyInsight / ...` **保留**作为底层能力。
- 新增 `runAgent(opts: { agentId; kbId; userMessage; extra?; signal? })`：内部 `composeAgentSystem` + `chat` / `streamChat`，并使用 `agent.sampling`。
- 现有 `BASE_SYSTEM` 不删，作为「`conversationalist` Agent」的人格描述迁移过去；后续逐步在 Agent 内重写。

#### 4.3.3 `skill-engine.ts`

- 每个 Skill 增加 `agentId?: string`（缺省映射表兜底）。
- Skill 内部把 `sys` 替换为 `agent.systemPrompt` / 拼接后的 sys。
- 新增 `inspiration` skill（指向 `inspirer`）。

#### 4.3.4 渲染层

- `AIRequest` 类型扩展 `agentId?: string`。
- `ChatPage` / `DiagnosePage` / `InspirationPage` / `NoteAIChat` 调用处增加 `agentId`（v1 也可不传，走映射表；v2 让用户在 UI 选 Agent）。
- SettingsPage 高级设置中：
  - 把 `AIPrompts.dailyInsight` / `inspirationModes` 重构为「**每个 Agent 的 systemPrompt 可被用户覆写**」：`AIPrompts.agents: Record<AgentId, string>`（缺省回退到内置）。
  - 保留 `chatQuickPrompts`（与 Agent 无关，是 UI 层的快捷提问）。
- **新增「Agent 选择器」**（v2，可选）：在聊天输入框旁边显示当前 Agent，用户可手动切换（用于「这次我想严谨 / 这次我想野一点」）。

### 4.4 灵感历史的存储与读取

- 文件路径：`<kbRoot>/.meta/inspiration-history.json`（**不**进 FrontMatter，避免污染用户笔记 frontmatter）。
- 数据结构：
  ```ts
  interface InspirationRecord {
    ts: number;
    agentId: 'daily-muse' | 'inspirer';
    mode?: string;          // inspirer 的 mode（complement / hole / …）
    angles: string[];       // 每条灵感的"一句话钩子"（用于去重比对）
  }
  ```
- 写入：`postRun` 中追加；总条数 > 60 自动 trim。
- 读取：`preRun` 中读最近 10 条 / 最近 7 天，注入 sys。
- **失败容错**：文件不存在 / 解析失败 → 静默忽略，不阻断 Agent。

### 4.5 诊断 Agent 的「严谨性」保障

- `temperature: 0.2`（接近贪婪）。
- sys 强制要求"每条结论引用至少 1 个具体路径"。
- `postRun` 做**自检**：调用一次轻量 chat 问"你刚才的回答是否每条都有具体路径？若有未引用的请补上"，失败则提示重答。
- `retrieval.includeDirTree: true` 且 `topK: 30`（覆盖广），配合 `kb_diagnose` 工具的目录结构 / 链接拓扑报告。

### 4.6 Agent 的存储位置

Agent 的配置分**两层存储**，与现有 `AIPrompts`（`ai-service.ts` 存于 `app_config['ai:prompts']`）、用户画像（`app_config['user:profile-base']`）的存储方式保持一致——**便于复用、便于迁移、不引入新存储中间件**。

#### 4.6.1 内置 Agent 定义（代码内，不可由用户改）

- **位置**：`src/main/services/agents/built-in/*.ts`（TS 源码，编译进主进程）。
- **存放内容**：`AgentProfile` 的**全部默认值**——`id / title / description / systemPrompt / sampling / retrieval / profileFields / preRun / postRun`。
- **原因**：这些是"出厂人格"，属于逻辑代码，应版本化、可 review、可单元测试；其中 `preRun/postRun` 是**函数**，无法序列化进数据库，只能放代码。

#### 4.6.2 用户覆写（持久化，可被用户改）

- **位置**：复用现有 `app_config` SQLite 表（`src/main/services/store.ts` 的 `getConfig/setConfig`），key 建议为 **`ai:agents`**。
- **存放内容**：`Record<AgentId, { systemPrompt?: string; sampling?: Partial<Sampling>; retrieval?: Partial<Retrieval> }>`——**只存用户改过的字段**，未改的字段回退到 built-in 默认值。
- **拼接优先级**（在 `composeAgentSystem` 中生效）：
  ```
  最终字段 = built-in 默认  <  用户覆写（ai:agents[AgentId]）   // 用户覆写 > 内置
  ```
- **与现有机制对齐**：
  - 现有 `AIPrompts` 存在 `ai:prompts`（`ai-service.ts` line 70-81）→ 新方案把它**迁移/合并**进 `ai:agents`。
  - 旧版用户自定义过 `dailyInsight` → 迁移脚本自动写入 `ai:agents['daily-muse'].systemPrompt`（见 §6 风险对策）。
  - 渲染层通过 `SettingsPage` 高级设置编辑 `ai:agents`，经 IPC `AI_SET_PROMPTS` 落库（复用现有 `window.forge.ai.setPrompts` 通道或新增 `setAgents`）。

```ts
// 落库结构（app_config['ai:agents'] 的 value 反序列化后）
interface AgentOverrides {
  [agentId: string]: {
    systemPrompt?: string;   // 用户覆写的"人格/角色"文本
    sampling?: Partial<{ temperature: number; top_p: number; presence_penalty: number; frequency_penalty: number; max_tokens: number }>;
    retrieval?: Partial<{ enabled: boolean; topK: number; includeDirTree?: boolean; includeOrphans?: boolean }>;
    profileFields?: Array<'basics' | 'interests' | 'preferences' | 'recentFocus' | 'longTerm'>;
  };
}
```

#### 4.6.3 运行态（内存）

- `agentRegistry`（`src/main/services/agents/registry.ts`）是**单例内存 Map**。
- 启动时 `registerBuiltInAgents()` 注册所有 built-in；再叠加从 `app_config['ai:agents']` 读出的用户覆写（`mergeAgent(override)` 合并到内存实例）。
- 渲染层 / IPC 层**不直接读库**，统一从 `agentRegistry.get(id)` 取——保证"启动一次加载、运行期一致"。
- 用户在设置页改 Agent → `setAgents()` 写库后，调用 `agentRegistry.applyOverride(id, patch)` 热更新内存实例（无需重启）。

#### 4.6.4 灵感历史（按 KB 隔离，落盘在知识库内）

- **位置**：`<kbRoot>/.meta/inspiration-history.json`（用户知识库目录下，**非** frontmatter，**非** app_config）。
- **原因**：灵感历史是"每个知识库自己的资产"，应跟着知识库走（可备份 / 可同步 / 可随知识库迁移），不污染笔记 frontmatter，也不进 app 级 SQLite。
- **结构**（见 §3.6 / §4.4）：
  ```ts
  interface InspirationRecord {
    ts: number;
    agentId: 'daily-muse' | 'inspirer';
    mode?: string;
    angles: string[];   // 每条灵感的"一句话钩子"，用于去重比对
  }
  ```
- 写入：`postRun` 追加；总条数 > 60 自动 trim。读取：`preRun` 读最近 10 条 / 最近 7 天。**失败容错**：文件不存在 / 解析失败 → 静默忽略，不阻断 Agent。

#### 4.6.5 存储分层总览

| 数据 | 存储位置 | 是否用户可改 | 序列化 | 加载时机 |
|---|---|---|---|---|
| 内置 Agent 人格 / 采样 / 钩子 | `src/main/services/agents/built-in/*.ts` | 否（需改代码） | 代码 | 进程启动 `import` |
| 用户覆写（systemPrompt 等） | `app_config['ai:agents']`（SQLite） | 是（SettingsPage 高级设置） | JSON | 启动叠加 + 热更新 |
| 运行态 Agent 注册表 | `agentRegistry` 单例（内存） | 运行时 | 内存 | 启动注册 |
| 灵感历史 | `<kbRoot>/.meta/inspiration-history.json` | 自动写 | JSON 文件 | 调用前/后读写 |

**关键原则**：函数型配置（`preRun/postRun`、采样合并逻辑）只在代码内；纯文本 / 数值型（`systemPrompt` / `sampling` / `retrieval`）才允许落库覆写——这样既保留"专家人格可版本管理"，又满足"用户可微调"的诉求，且与项目现有的 `app_config` + `AIPrompts` 模式完全吻合。

---

> 渐进式落地，每个阶段都可独立发布。

### 阶段 A · 基础抽象（1~2 天）

1. 新建 `src/main/services/agents/{types,registry,sampling,retrieval,compose}.ts`。
2. `AIService` 暴露 `runAgent(opts)`，内部 `composeAgentSystem` + `chat`。
3. `ai-hub.ts` 接受 `req.agentId`，缺省时按 `SKILL_TO_AGENT` 映射。
4. `agentRegistry` 注册 1 个 Agent：`conversationalist`（人格 = 现有 `BASE_SYSTEM`）。
5. **回归验证**：ChatPage / NoteAIChat 行为与改造前**完全一致**（人格透传未改）。

### 阶段 B · 差异化人格（2~3 天）

6. 注册 `diagnostician` / `refiner` / `card-smith` 三个 Agent，替换 DiagnosePage / NotePane(refine) / 锻造卡片的 sys。
7. 验证：诊断输出开始"按严重度分组 + 引用具体路径"；精炼更克制；卡片更严守四铁律。
8. **不改动 InspirationPage 与 daily-insight**（下一阶段重点）。

### 阶段 C · 灵感 / 灵光一现 Agent（2~3 天）—— 解决"每天都是同样反馈"

9. 注册 `inspirer` Agent；新增 `inspiration` skill；改 InspirationPage 走 `hubRunStream({ agentId: 'inspirer' })`。
10. 注册 `daily-muse` Agent；扩展 `inspire-history.ts` 持久化与读取；改 `daily-insight` skill 走 `daily-muse`。
11. **验收标准**（与用户痛点强绑定）：
    - 连续 7 天 `daily-muse` 输出**角度不重复**（人工 review + 简单 Jaccard 相似度脚本）。
    - 输出的"跨界支点"字段**至少有 1 个非用户主业领域**。
    - 抽样 20 条，**没有任何一条是"拖延/习惯/自律/5 分钟启动/时间管理"母题**。
    - KB 极空时（< 5 笔记）改为返回 3 个聚焦问题而非强行生成。
12. **不破坏现有用户**：在 SettingsPage 高级设置提供「使用内置 Agent / 自定义 systemPrompt」开关；用户覆写后 `composeAgentSystem` 优先用覆写值。

### 阶段 D · 高级能力（可选 v2）

13. `AgentOrchestrator`：一个请求可让多个 Agent 串行/并行（如「先让 inspirer 出 3 个角度 → 让 diagnostician 评估每个角度在 KB 里的可行性」）。
14. UI Agent 选择器：用户手动切 Agent。
15. 灵感历史的可视化：「灵感日历」页面，看过去 30 天每天的灵感角度 + 标签云。

---

## 6. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 改了 systemPrompt 行为，回归测试失败 | 中 | 阶段 A 先保 conversationalist 与现状一致，再分阶段引入其他 Agent |
| 灵感 Agent 过于发散，输出「不可用」 | 中 | temperature 上限 0.95；sys 强制结构化输出；「禁用母题清单」+「3 个聚焦问题 fallback」 |
| 用户已自定义的 `dailyInsight` 高级设置失效 | 中 | 在 `composeAgentSystem` 中**用户覆写 > Agent 内置**；迁移时自动把旧 `AIPrompts.dailyInsight` 写入 `AIPrompts.agents['daily-muse']` |
| 灵感历史文件被用户误删 / 损坏 | 低 | `inspire-history.ts` 用 try/catch 静默忽略；不阻断 Agent |
| 多 Agent 协作引入新复杂度 | 低 | 阶段 D 才做，阶段 A~C 不引入；预留 `AgentOrchestrator` 接口 |
| 不同基模对 sampling 灵敏度差异大 | 中 | `sampling` 在 `composeAgentSystem` 中按 provider 二次校正（Ollama / OpenAI 兼容协议对 `presence_penalty` 支持度不同） |
| 系统提示词膨胀（多人格 + 画像 + RAG + 历史）→ token 成本 | 中 | 灵感 Agent 的 sys 严格控制在 1500 tokens 内；RAG `topK` 按 Agent `retrieval.topK` 限制；对话 Agent 复用现有 `askStream` 的 token 控制 |

---

## 7. 验收清单（与用户原始诉求对齐）

- [ ] **灵光一现每天都是同样反馈** → 解决：阶段 C 后 7 天内日均输出不重复，母题命中率为 0。
- [ ] **诊断 Agent 严谨 / 知识体系架构** → 解决：阶段 B 后诊断输出"严重度 + 路径 + 量化指标"四要素齐全。
- [ ] **灵感 Agent 超出当前知识库边界 / 给用户更多可能性** → 解决：阶段 C 后每条灵感有"跨界支点 + 知识库锚点"两个字段。
- [ ] **新增 Agent 不改主流程** → 解决：注册式 `agentRegistry.register(new AgentProfile(...))` 一行接入。
- [ ] **不破坏现有用户自定义 prompt** → 解决：高级设置迁移 + 用户覆写优先。
- [ ] **可观测** → 解决：`postRun` 可埋点（log 每个 Agent 的耗时、token、sampling 实际生效值），用于调优。
