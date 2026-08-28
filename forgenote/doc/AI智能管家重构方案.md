# 锦囊笔记 · AI 智能管家重构方案

> 版本：v1.0（草案）
> 定位：在「统一调用层（AIHub / Skill / MCP）」与「确认-执行框架（Confirm-then-Act）」已落地的基础上，收敛历史遗留的双轨调用，并补齐从「AI 问答工具」跃迁到「知识库智能管家」所需的能力缺口。
>
> 前置文档：
> - `doc/AI调用重构技术方案.md` —— 统一 AIHub、Skill 注册表、MCP 工具运行时
> - `doc/MCP技术实现方案.md` —— Confirm-then-Act 确认-执行框架、笔记 Patch
> - `doc/多Agent技术实现方案.md` —— 专家角色（Agent）编排与人格注入
> - `doc/用户画像实现方案.md` —— 用户画像抽取与注入
>
> 本方案中所有"实测"数据均基于对 `src/main/services/` 与 `src/renderer/` 的全量扫描（统计口径见 §2）。

---

## 1. 背景与定位

### 1.1 产品定位的跃迁诉求

当前 AI 能力的实际形态是**被动问答工具**：

- 用户点按钮 / 发消息 → AI 产出文本或结构化结果 → 结束
- 知识库诊断（`kb_diagnose`）只能被 AI 被动调用，**没有任何调度入口**
- 所有能力的作用域是**单篇笔记**，AI 看不到知识库全局

而"智能管家"应当具备三个特征：

| 特征 | 含义 | 当前状态 |
|---|---|---|
| **主动** | 无需用户发起，定期巡检、发现问题、推送建议 | 缺失 |
| **全局** | 以知识库为对象（统计、去重、结构、标签体系），而非单篇笔记 | 缺失 |
| **闭环** | 计划 → 执行 → 验证 → 可回滚，对结果负责 | 部分（有确认，无验证/回滚） |

### 1.2 本方案要解决的问题

1. **历史欠账**：11 处活跃旧调用绕过 AIHub，导致 Prompt 治理、流式、埋点、安全确认**四套机制都无法统一覆盖**。
2. **能力缺口**：AI 无法对知识库"全局把脉"，也无法主动发起整理。
3. **信任缺口**：AI 修改笔记后没有验证与回滚，用户不敢放手使用。

### 1.3 非目标

- 不重写底层模型协议适配（沿用 `ai-service` 的 `callOpenAI` / `callOllama`）
- 不引入新的向量数据库 / 外部依赖（检索仍基于 `search-service`）
- 不改变用户可见的核心交互路径，只做能力增强与收敛

---

## 2. 现状全景（as-is）

### 2.1 主进程 AI 层清单

| 模块 | 职责 | 状态评估 |
|---|---|---|
| `ai-service.ts` | 配置读写 + OpenAI/Ollama 协议适配 + 15+ 业务方法 + 用量统计 + 画像抽取 | 上帝类，职责过载 |
| `ai-hub.ts` | 统一入口 `run` / `runStream`，会话挂载，Agent 路由，画像异步抽取 | 设计良好，但覆盖面不足 |
| `skill-engine.ts` | Skill 注册表 + 规则路由 + 模型自路由 + 历史压缩 | 注册表已建，但**大量能力未注册** |
| `tool-runtime.ts` | `KB_TOOLS`（9 个本地 MCP 工具）+ `WRITE_TOOLS` + 工具执行 | 工具齐备，但模型鲜少主动调用 |
| `mcp-client.ts` | 外部 MCP Server（stdio / SSE），原生 JSON-RPC | 需手动配置，门槛高 |
| `note-patch.ts` | Patch 预览 / 应用 + 乐观锁（mtime 校验） | 新增，机制完善 |
| `confirmable-action-service.ts` | 确认操作注册表 + `preview` / `execute` 两段式 | 新增，可扩展 |
| `session-store.ts` | 会话存储 + 草稿（draft） | **仅内存**，注释中规划的持久化未实现 |
| `rag-service.ts` / `search-service.ts` | 检索增强 / 全文索引 + 分块 | 边界模糊，可能重复召回 |
| `profile-service.ts` | 用户画像抽取与读取 | 仅用于 agent system prompt 注入 |
| `agents/` | 多专家 Agent 人格定义 | 利用率取决于 skill 路由 |

### 2.2 Skill 注册表实测

`skill-engine.ts` 的 `SKILLS` 共注册 **9 个**：

```
ask            知识库问答（含时间维度分流）
agent          智能体（ReAct 工具循环）
quick-note     快速笔记
suggest-dir    归档推荐
suggest-links  双链推荐
forge-card     知识卡片锻造
summarize-tags 摘要与标签
diagnose       知识库诊断
daily-insight  每日灵感一现
```

**`SKILL_TO_AGENT` 映射表共 11 项**，其中两项在 `SKILLS` 中**没有对应实现**：

| 映射表中存在 | SKILLS 中 | 说明 |
|---|---|---|
| `refine-note` | 无 | 笔记润色，映射已声明但能力未注册 |
| `inspiration` | 无 | 灵感工坊，能力未注册 |

这是"注册表与映射表漂移"的直接证据，说明 Skill 机制尚未成为**唯一事实来源**。

### 2.3 MCP 工具实测

`tool-runtime.ts` 的 `KB_TOOLS` 共 **9 个**：

| 工具 | 类别 | 说明 |
|---|---|---|
| `kb_search` | 读 | 全文检索 |
| `kb_read_note` | 读 | 读取笔记全文 |
| `kb_list_notes` | 读 | 按目录 / 时间窗列举 |
| `kb_write_note` | 写 | 创建或覆盖 |
| `kb_preview_patch` | 写（预览） | 生成 diff，不落盘 |
| `kb_apply_patch` | 写 | 应用 Patch（含乐观锁） |
| `kb_suggest_dir` | 辅助 | 目录推荐 |
| `kb_link_graph` | 辅助 | 双链图谱 |
| `kb_diagnose` | 辅助 | 健康诊断 |

**全部为笔记级操作**，无知识库级聚合工具（详见 §3.2 G-B2）。

### 2.4 确认操作注册表实测

`confirmable-action-service.ts` 当前注册 **4 个** handler：

| Action | 说明 | 状态 |
|---|---|---|
| `notePatch` | 笔记 Patch 预览 / 应用 | 已用 |
| `moveNote` | 移动笔记 | 已注册，暂无 AI 调用路径 |
| `createNote` | 新建笔记 | 已注册，暂无 AI 调用路径 |
| `settingUpdate` | 更新应用配置 | 示例扩展点 |

缺失：`batchPatch` / `batchMove` / `batchRetag`（批量）、`openModal`（UI 副作用）。

### 2.5 渲染层调用实测：双轨制

**旧通道 `window.forge.ai.<业务方法>` —— 11 处活跃调用**

| 文件 | 行号 | 方法 |
|---|---|---|
| `MultiNoteEditor.tsx` | 75 | `suggestLinks` |
| `MultiNoteEditor.tsx` | 88 | `suggestDir` |
| `MultiNoteEditor.tsx` | 109 | `generateTags` |
| `MultiNoteEditor.tsx` | 159 | `forgeCard` |
| `MultiNoteEditor.tsx` | 165 | `insertLinks` |
| `RightPanel.tsx` | 196 | `generateTags` |
| `DiagnosePage.tsx` | 127 | `ask` |
| `DiagnosePage.tsx` | 153 | `insertLinks` |
| `NotePane.tsx` | 86 | `refineNote` |
| `NoteAIChat.tsx` | 123 | `askAboutNote` |
| `stores/kb-store.ts` | 103 | `quickNote` |

**新通道 `hubRun` / `hubRunStream` / `runAgent` —— 6 处调用**

| 文件 | 行号 | 通道 |
|---|---|---|
| `ChatPage.tsx` | 214 / 276 | `hubRunStream` |
| `NoteAIChat.tsx` | 91 / 167 | `hubRunStream` |
| `InspirationPage.tsx` | 81 / 119 | `runAgent('inspirer' / 'daily-muse')` |
| `WanderOverlay.tsx` | 119 | `runAgent('wander')` |

**结论**：双轨比例约 **11 : 6**，且旧通道覆盖了**全部写操作入口**（`insertLinks`、`refineNote`、`forgeCard`），这是当前最大的一致性风险点。

### 2.6 死代码

| 文件 | 证据 |
|---|---|
| `src/renderer/components/AIChat.tsx` | 全项目无 `import`，仅自身内部调用 `window.forge.ai.ask` |
| `src/renderer/stores/useAISession.ts` | 全项目无组件使用；已封装 `run` / `confirmDraft` / `cancel` / `pendingDraft`，但**非流式**，导致 `ChatPage` 与 `NoteAIChat` 各自重新实现了一套流式逻辑 |

---

## 3. 差距诊断

### 3.1 架构层

#### G-A1 双轨制导致能力无法统一覆盖（最高优先级）

11 处旧调用全部绕过 `AIHub` → `skill-engine`，直接命中 `ai-service` 的业务方法。直接后果：

| 机制 | 新通道 | 旧通道 | 影响 |
|---|---|---|---|
| 安全确认（Confirm-then-Act） | 支持 | **不支持** | `insertLinks` / `refineNote` / `forgeCard` 直接写盘，无用户确认 |
| 用户画像异步抽取 | 支持 | 不支持 | 画像数据不完整 |
| Token 用量埋点 | 统一 | 分散 | 成本统计失真 |
| 流式渲染 | 支持 | 部分支持 | 交互体验不一致 |
| Prompt 集中治理 | 可行 | 硬编码 | 改一处漏一处 |
| Agent 人格注入 | 支持 | 不支持 | 回复风格不统一 |

> **安全含义**：`NotePane.tsx:86` 的 `refineNote` 是"AI 直接改写用户笔记正文"，当前**无任何确认环节**。这是本方案必须优先解决项。

#### G-A2 三套流式实现并存

`askStream` / `hubRunStream` + `AI_STREAM_CHUNK` / `streamChat` —— 维护与调试成本翻倍，且各自的错误处理与取消逻辑不同。

#### G-A3 会话状态三处重复且不同步

| 存储 | 内容 | 持久化 | 问题 |
|---|---|---|---|
| `session-store.ts` | 多轮 turns 上下文 | 否（内存） | 应用重启即丢失 |
| `chat-store.ts` | 对话消息（zustand persist） | 是（localStorage） | 与 session-store 双份 turns |
| `convSessionMap`（`ChatPage` ref） | conversationId → sessionId | 否 | 额外一层映射，易失同步 |

#### G-A4 `ai-service.ts` 职责过载

单类同时承担：配置读写、协议适配、15+ 业务 Prompt、用量统计、画像抽取。新增一个 AI 能力需改动 **service + ipc-channels + ipc.ts + preload + 组件** 五处，与"声明一个 Skill 即可"的设计目标背离。

#### G-A5 Skill 映射表与注册表漂移

`SKILL_TO_AGENT` 中的 `refine-note` / `inspiration` 在 `SKILLS` 中无实现（见 §2.2），说明 Skill 机制尚未成为唯一事实来源。

### 3.2 智能管家能力层

#### G-B1 AI 是被动工具，无主动巡检

`kb_diagnose` 工具能力完整，但**没有任何调度入口**（无定时任务、无启动自检、无手动体检入口的 AI 解读）。"管家"的第一个特征缺失。

#### G-B2 只有笔记级工具，缺知识库级工具

9 个 `KB_TOOLS` 全部作用于单篇笔记。以下知识库级能力缺失：

| 缺失能力 | 建议工具 | 说明 |
|---|---|---|
| 知识库统计 | `kb_stats` | 笔记数、标签数、平均长度、增长率 |
| 重复内容检测 | `kb_duplicates` | 标题 / 正文高度相似的笔记对 |
| 孤儿笔记 | `kb_orphans` | 无入链、无出链、无标签 |
| 标签体系治理 | `kb_tag_tree` | 同义词、层级、稀疏标签 |
| 结构评审 | `kb_structure_review` | 目录深度、空目录、扁平度 |
| 过期内容 | `kb_stale` | 长期未更新的笔记 |

没有这些，AI 只能做字词级润色，无法对知识库全局把脉。

#### G-B3 缺少「计划 → 执行 → 验证」闭环

当前确认流的生命周期是 `确认 → 执行 → 结束`。缺失：

- **执行后验证**：修改是否真达到预期（应自动 `kb_read_note` 回读校验）
- **回滚能力**：`audit-service` 有记录但**无撤销入口**
- **批量任务**：整理 50 篇笔记时无进度、无部分失败重试、无整体回滚

这是"管家"与"工具"的分水岭——管家需要对结果负责。

#### G-B4 检索链路边界模糊

`search-service`（全文索引 + 分块）与 `rag-service`（检索增强）职责重叠，AI 检索时可能重复召回。增量索引时机分散在 `writeNote` / `moveNote` / `renameNote` 各自调用 `syncIndex`，**容易遗漏**（`note-patch.ts` 也是手动补的 `syncIndex`）。

#### G-B5 成本与限流完全缺失

`recordUsage` 记录了 token，但无预算上限、无速率限制、无告警。智能体模式 10 轮工具循环 × 长上下文，单次对话成本可能失控。

#### G-B6 Prompt 治理缺失

- 业务 Prompt 硬编码在 `ai-service.ts` 各方法内
- 用户可编辑的仅 `AIPrompts`（每日灵感、灵感方向、快捷提问）
- 无版本管理、无变量注入规范
- `skill-engine.ts` 中的 `AGENT_PLAN_SYS` 同样是硬编码

#### G-B7 用户画像利用率极低

`profile-service` 已在 `ask` / `diagnose` 后异步抽取，但画像**仅用于 agent system prompt 注入**，未用于：个性化整理策略、写作风格匹配、主动推荐。

---

## 4. 设计目标（to-be）

### 4.1 目标架构

```
┌──────────────────────────── 渲染进程 ─────────────────────────────┐
│  ChatPage / NoteAIChat / MultiNoteEditor / NotePane / DiagnosePage │
│  RightPanel / InspirationPage / WanderOverlay / kb-store           │
│            │  统一入口（唯一调用方式）                              │
│            ▼                                                       │
│   useAISession（强化版）                                            │
│     · 流式 / 非流式 / 取消 / 错误 / 加载态                          │
│     · pendingDraft 状态机 → ConfirmableActionCard                  │
└────────────┬──────────────────────────────────────────────────────┘
             │ IPC（AI_HUB_RUN / AI_HUB_STREAM / AI_PATROL_*）
┌────────────▼───────────────────────── 主进程 ─────────────────────┐
│  AIHub（唯一编排入口）                                              │
│   ├─ SkillRegistry    ← 唯一事实来源（全部能力在此注册）            │
│   ├─ SessionStore     ← 持久化到 .forge/ai-sessions/               │
│   ├─ AgentRouter      ← 人格注入                                    │
│   ├─ CostGovernor     ← 预算 / 限流 / 告警（新增）                  │
│   └─ PromptRegistry   ← 集中 Prompt + 版本 + 变量（新增）           │
│                                                                     │
│  ToolRuntime（MCP 工具）                                            │
│   ├─ 笔记级：kb_search / read / write / patch / link / diagnose    │
│   └─ 库级（新增）：kb_stats / duplicates / orphans / tag_tree /     │
│                    structure_review / stale                        │
│                                                                     │
│  ConfirmableActionService（确认-执行）                              │
│   └─ notePatch / moveNote / createNote / settingUpdate             │
│      + batchPatch / batchMove / batchRetag（新增）                  │
│      + verify? / rollback? 钩子（新增）                             │
│                                                                     │
│  PatrolService（新增 · 巡检）                                       │
│   └─ 定时/启动/手动 → 体检报告 → 可一键执行的整理建议               │
└───────────────────────────────────────────────────────────────────┘
```

### 4.2 能力矩阵 as-is → to-be

| 能力维度 | as-is | to-be |
|---|---|---|
| 调用入口 | AIHub + 11 处旧方法双轨 | **AIHub 单轨** |
| 流式实现 | 3 套 | 1 套（`hubRunStream`） |
| 会话持久化 | 无 | `.forge/ai-sessions/` |
| 会话存储 | 3 处 | 1 处 |
| 写操作确认 | 部分（新通道） | **全部** |
| 执行后验证 | 无 | 自动回读校验 |
| 回滚 | 无 | 支持（基于快照 + audit） |
| 批量任务 | 无 | 进度 + 重试 + 回滚 |
| 知识库级工具 | 0 个 | 6 个 |
| 主动巡检 | 无 | 启动 / 每日 / 手动 |
| 成本治理 | 仅记录 | 预算 + 限流 + 告警 |
| Prompt 治理 | 硬编码 | 集中注册 + 版本 + 变量 |
| 画像应用 | Agent 注入 | 注入 + 个性化策略 + 主动推荐 |

---

## 5. 实施路线

### 5.0 总览与优先级

| 阶段 | 主题 | 周期 | 价值 |
|---|---|---|---|
| **P0** | 收敛双轨制 + 清理死代码 | 1–2 周 | 安全与一致性地基，所有后续重构的前提 |
| **P2** | 智能管家核心能力 | 1–2 月 | 产品差异化核心，建议紧随 P0 |
| **P1** | 会话与状态统一 | 2–3 周 | 可与 P2 并行 |
| **P3** | 工程治理 | 长期 | 持续演进 |

> **排序理由**：P0 不只是代码整洁问题——它直接决定了安全确认机制能否覆盖全部 AI 写操作。P2 优先级高于 P1，因为"管家能力"是产品价值所在，而 P1 是内部质量改进，可与 P2 并行推进。

---

### 5.1 P0 · 收敛双轨制（1–2 周）

**目标**：所有 AI 调用经 `AIHub` → `SkillRegistry`，安全确认覆盖全部写操作。

#### P0-1 补齐缺失 Skill

在 `skill-engine.ts` 的 `SKILLS` 中补全映射表已声明但缺失的实现：

| 新增 Skill | 对应旧方法 | 关键点 |
|---|---|---|
| `refine-note` | `ai-service.refineNote` | **`awaitConfirm: true`**，接入确认流（当前无确认直接改正文，最高风险项） |
| `inspiration` | `InspirationPage` 内联逻辑 | 与 `runAgent('inspirer')` 统一 |
| `insert-links` | `ai-service.insertLinks` | **`awaitConfirm: true`**，注册为 `ConfirmableAction` |

#### P0-2 迁移 11 处旧调用

| 文件 | 行号 | 现状 | 迁移目标 |
|---|---|---|---|
| `MultiNoteEditor.tsx` | 75 | `suggestLinks` | `hubRun({ skill: 'suggest-links' })` |
| `MultiNoteEditor.tsx` | 88 | `suggestDir` | `hubRun({ skill: 'suggest-dir' })` |
| `MultiNoteEditor.tsx` | 109 | `generateTags` | `hubRun({ skill: 'summarize-tags' })` |
| `MultiNoteEditor.tsx` | 159 | `forgeCard` | `hubRun({ skill: 'forge-card' })` |
| `MultiNoteEditor.tsx` | 165 | `insertLinks` | `hubRun({ skill: 'insert-links', confirm: true })` + 确认卡片 |
| `RightPanel.tsx` | 196 | `generateTags` | `hubRun({ skill: 'summarize-tags' })` |
| `DiagnosePage.tsx` | 127 | `ask` | `hubRun({ skill: 'diagnose' })` |
| `DiagnosePage.tsx` | 153 | `insertLinks` | `hubRun({ skill: 'insert-links', confirm: true })` |
| `NotePane.tsx` | 86 | `refineNote` | `hubRun({ skill: 'refine-note', confirm: true })` + 确认卡片 |
| `NoteAIChat.tsx` | 123 | `askAboutNote` | 合并到已有 `hubRunStream`（91 / 167 行），消除同组件内双通道 |
| `kb-store.ts` | 103 | `quickNote` | `hubRun({ skill: 'quick-note' })` |

#### P0-3 统一流式

废弃 `askStream`，统一到 `hubRunStream` + `AI_STREAM_CHUNK`。

#### P0-4 清理死代码

- 删除 `src/renderer/components/AIChat.tsx`
- 强化或删除 `src/renderer/stores/useAISession.ts`（见 P1-4）

#### P0-5 收敛 `ai-service.ts` 业务方法

迁移完成后，将 `ai-service` 中的 15+ 业务方法下沉为对应 Skill 的内部实现，`ai-service` 仅保留配置、协议适配、用量统计。

#### 验收标准

1. 全项目 `window.forge.ai.<业务方法>` 调用数为 **0**（仅保留 `hubRun` / `hubRunStream` / `runAgent`）
2. `MultiNoteEditor` / `NotePane` / `DiagnosePage` 的写操作均出现确认卡片
3. `SKILL_TO_AGENT` 与 `SKILLS` 键集合完全一致（建议加单测断言）
4. 无 `AIChat.tsx` 引用

#### 风险与应对

| 风险 | 应对 |
|---|---|
| 迁移后回归（Prompt 差异导致输出变化） | 逐 Skill 迁移，每个 Skill 保留原 Prompt 文本，迁移后对比输出抽样 |
| 确认流增加交互步骤，老用户不适应 | `refineNote` 等高频轻量操作提供"不再询问"记忆开关 |

---

### 5.2 P2 · 智能管家核心能力（1–2 月）

**目标**：让 AI 具备"主动巡检 + 全局视角 + 结果负责"三项管家特征。

#### P2-1 知识库巡检（Patrol）

新增 `src/main/services/patrol-service.ts`：

- **触发时机**：应用启动（静默）/ 每日一次（后台）/ 手动点击（生成报告）
- **检查项**（复用并扩展 `kb_diagnose`）：

| 检查项 | 严重度 | 可执行建议 |
|---|---|---|
| 失效双链 | 高 | 批量移除或重定向（`batchPatch`） |
| 重复标题 | 中 | 合并建议 |
| 高相似度正文 | 中 | 合并 / 加区分标签 |
| 孤儿笔记（无链无标签） | 中 | 批量补标签（`batchRetag`） |
| 空目录 | 低 | 删除或填充 |
| 稀疏标签（仅 1 篇使用） | 低 | 合并到相近标签 |
| 目录过深 / 过扁 | 低 | 结构重整建议（`batchMove`） |
| 长期未更新 | 低 | 归档提醒 |

- **产出**：结构化体检报告，每项是**可一键执行的建议**，复用 `confirmable-action-service`
- **结果呈现**：`DiagnosePage` 增加"体检报告"视图

#### P2-2 知识库级工具集

在 `tool-runtime.ts` 的 `KB_TOOLS` 中新增 6 个工具（见 §3.2 G-B2 表格）。

实现要点：

- `kb_duplicates` 基于标题 + 正文 shingle 相似度，复用现有索引，避免引入新依赖
- `kb_stats` / `kb_orphans` / `kb_tag_tree` / `kb_structure_review` / `kb_stale` 基于 `link-index` + `search-service` 现成数据聚合
- 全部为**只读**工具，不进 `WRITE_TOOLS`，无需确认

#### P2-3 执行后验证与回滚

扩展 `ConfirmableAction` 接口（见 §7.2），为 `notePatch` 补：

```
执行 → 自动 kb_read_note 回读 → 校验修改是否生效
     → 未达预期则渲染"回滚"按钮 → 基于执行前快照恢复
```

- 快照在 `preview` 阶段保存（内存或 `.forge/patch-snapshots/`）
- 回滚后记入 `audit-service`

#### P2-4 批量任务

新增确认类型与渲染卡片：

| Action | payload | 能力 |
|---|---|---|
| `batchPatch` | `{ items: NotePatchPayload[] }` | 批量修改笔记，含进度、部分失败重试 |
| `batchMove` | `{ items: { fromPath, toDirPath }[] }` | 批量移动 |
| `batchRetag` | `{ items: { notePath, tags }[] }` | 批量打标签 |

统一返回 `{ total, succeeded, failed: [{ item, reason }], canRollback }`，渲染层展示进度条与失败清单。

#### P2-5 主动建议通道

基于巡检结果 + 用户画像，在合适时机推送建议卡片：

> 「知识库中有 12 篇笔记没有标签，要帮你补上吗？」→ 点击走 `batchRetag` 确认流

- 入口：启动后轻提示（可关闭）/ `DiagnosePage` 建议区
- 节流：同一 `dedupeKey` 建议 7 天内不重复推送

#### 验收标准

1. 启动后自动生成体检报告（可关闭）
2. `KB_TOOLS` 达到 15 个，其中 6 个为知识库级只读工具
3. 任意 `notePatch` 执行后可回滚
4. 可一次批量处理 ≥ 20 篇笔记，有进度与失败清单

---

### 5.3 P1 · 会话与状态统一（2–3 周，可与 P2 并行）

#### P1-1 `session-store` 持久化

落地注释中已规划的方案：持久化到 `.forge/ai-sessions/<sessionId>.json`，启动时惰性加载，LRU 淘汰。

#### P1-2 合并会话存储

`chat-store`（渲染层 persist）与 `session-store`（主进程）合并为单一事实来源：渲染层只存 UI 态（滚动位置、草稿输入框），turns 统一由主进程 `session-store` 持有并通过 IPC 提供。

#### P1-3 删除 `convSessionMap`

统一使用 `sessionId`，`conversationId → sessionId` 的映射下沉到 `chat-store` 的持久化字段。

#### P1-4 强化 `useAISession`

补齐流式能力（`runStream` / `onToken` / `cancel`），使其成为 `ChatPage` / `NoteAIChat` 的唯一状态封装，消除两处重复实现。

#### 验收标准

1. 应用重启后对话上下文不丢失
2. turns 数据仅存一份
3. `useAISession` 被 ≥ 2 个组件复用，且无组件自行实现流式

---

### 5.4 P3 · 工程治理（长期）

| 项 | 建议 |
|---|---|
| **Prompt 治理** | 抽出 `src/main/prompts/` 集中管理，支持版本、变量注入（`{{kbName}}` 等）、用户覆盖；`skill-engine` 与 `ai-service` 中的硬编码 Prompt 全部迁入 |
| **成本治理** | `CostGovernor`：单次 / 单日 token 预算、请求速率限制、超限告警与降级到小模型 |
| **可观测性** | AI 调用链路日志（skill → tool → 结果 → token），接入既有 `AuditPage`；成本看板 |
| **拆分 `ai-service.ts`** | 拆为 `ai-config` / `ai-protocol` / `ai-usage`，业务方法全部下沉为 Skill |
| **MCP 生态** | 内置"知识库管家"工具预设，提供一键导入，降低外部 MCP 配置门槛 |
| **索引统一** | 在 `fs-service` 写操作出口统一 `syncIndex`，移除分散调用，杜绝遗漏 |

---

## 6. 关键设计

### 6.1 巡检任务模型

```ts
export interface PatrolFinding {
  id: string;
  severity: 'high' | 'medium' | 'low';
  category: 'broken-link' | 'duplicate' | 'orphan' | 'empty-dir'
          | 'sparse-tag' | 'structure' | 'stale';
  title: string;
  detail: string;
  /** 受影响笔记路径（用于展示与批量操作） */
  affected: string[];
  /** 可一键执行的建议动作；无则仅提示 */
  suggestion?: ConfirmableAction;
  /** 去重键，用于建议节流 */
  dedupeKey: string;
}

export interface PatrolReport {
  kbId: string;
  at: number;
  stats: { noteCount: number; dirCount: number; tagCount: number; linkCount: number };
  findings: PatrolFinding[];
  /** 综合健康分 0-100 */
  score: number;
}
```

巡检结果缓存到 `.forge/patrol/<kbId>.json`，启动时若缓存未过期（默认 24h）则直接读取，避免重复扫描大库。

### 6.2 批量任务执行模型

```ts
export interface BatchResult {
  batchId: string;
  total: number;
  succeeded: number;
  failed: { item: unknown; reason: string }[];
  /** 是否可整体回滚（所有已成功项均有快照） */
  canRollback: boolean;
}
```

执行策略：

1. `preview` 阶段为每一项生成快照，返回聚合预览（受影响文件数、diff 概览）
2. 用户确认后按序执行，逐项 `try/catch`，失败不中断
3. 通过 IPC 事件 `AI_BATCH_PROGRESS` 推送 `{ done, total, current }`
4. 完成后返回 `BatchResult`，失败项可单独重试
5. 整体回滚按快照逆序恢复

### 6.3 验证与回滚钩子

在 `ActionHandler` 上扩展可选钩子（详见 §7.2）：

- `verify(payload, ctx)`：执行后自动调用，返回 `{ ok, message }`
- `rollback(payload, ctx)`：用户触发回滚时调用

`notePatch` 的 `verify` 实现：回读笔记，检查 Patch 中每条 op 的目标文本是否已按预期存在/消失。

### 6.4 知识库级工具接入方式

新增的 6 个只读工具直接进 `KB_TOOLS`，使模型在智能体模式下可自主调用：

> 用户：「我的知识库结构合理吗？」
> 模型：调用 `kb_structure_review` → `kb_stats` → 给出结构评估与调整建议（走 `batchMove` 确认）

这样"全局把脉"无需新增 UI 入口，直接由对话驱动。

### 6.5 主动建议的触发与节流

```ts
interface SuggestionPolicy {
  /** 同一 dedupeKey 的静默期（毫秒） */
  cooldownMs: number;      // 默认 7 天
  /** 单次最多展示条数 */
  maxPerRound: number;     // 默认 3
  /** 仅展示该严重度及以上 */
  minSeverity: 'high' | 'medium' | 'low';  // 默认 medium
}
```

已展示记录持久化到 `.forge/patrol/shown.json`，避免重复打扰。

---

## 7. 接口草案

### 7.1 Skill 声明扩展

在现有 `AISkill` 基础上新增字段，支撑巡检与批量场景：

```ts
export interface AISkill {
  id: string;
  title: string;
  description: string;
  capability?: ('reasoning' | 'long-context' | 'cheap')[];
  stateful?: boolean;
  awaitConfirm?: boolean;
  useTools?: string[];
  localFallback?: (ctx: AISkillCtx) => AIResponse | Promise<AIResponse>;
  run: (ctx: AISkillCtx) => Promise<AIResponse & { refs?: AIRefHit[]; usage?: AIUsage }>;

  /* ============ 新增 ============ */
  /** 提示词 id，指向 PromptRegistry（取代硬编码） */
  promptId?: string;
  /** 单次调用预估成本权重，供 CostGovernor 限流（1 = 基准） */
  costWeight?: number;
  /** 是否可被巡检 / 主动建议自动触发（避免递归触发） */
  autoRunnable?: boolean;
  /** 所属能力分组，用于 UI 归类与权限提示 */
  group?: 'read' | 'write' | 'organize' | 'insight';
}
```

### 7.2 ConfirmableAction 扩展

现有 `ActionHandler` 仅有 `preview` / `execute`，扩展验证与回滚钩子：

```ts
export interface ActionHandler<P, V = unknown> {
  preview?: (payload: P, ctx: ActionCtx) => Promise<V | null>;
  execute: (payload: P, ctx: ActionCtx) => Promise<unknown>;

  /* ============ 新增 ============ */
  /** 执行后自动校验；返回 ok=false 时渲染层提示"似乎未生效，可回滚" */
  verify?: (payload: P, ctx: ActionCtx) => Promise<{ ok: boolean; message: string }>;
  /** 用户触发回滚时调用，基于 preview 阶段保存的快照恢复 */
  rollback?: (payload: P, ctx: ActionCtx) => Promise<{ ok: boolean; message: string }>;
  /** 批量处理器：存在时该类型支持批量执行 */
  executeBatch?: (items: P[], ctx: ActionCtx) => Promise<BatchResult>;
}
```

`ConfirmableAction` 增加 `batch?: boolean` 标记，渲染层据此渲染批量进度卡片。

### 7.3 新增 IPC 通道

| 通道 | 方向 | 用途 |
|---|---|---|
| `AI_PATROL_RUN` | 渲染 → 主 | 手动触发巡检 |
| `AI_PATROL_LATEST` | 渲染 → 主 | 读取最近一次体检报告 |
| `AI_BATCH_PROGRESS` | 主 → 渲染 | 批量任务进度推送 `{ batchId, done, total, current }` |
| `AI_ACTION_ROLLBACK` | 渲染 → 主 | 回滚已执行的确认操作 |
| `AI_SESSION_LIST` | 渲染 → 主 | 会话列表（P1 持久化后，供历史会话切换） |

> 通道常量统一追加到 `src/shared/ipc-channels.ts`，并在 `preload` 中暴露。

---

## 8. 风险与降级

| 风险 | 影响 | 降级策略 |
|---|---|---|
| 迁移后 AI 输出质量波动 | 用户可感知 | 逐 Skill 迁移 + 输出抽样对比；保留原 Prompt 文本不变 |
| 巡检扫描大库耗时 | 启动卡顿 | 结果缓存 24h；后台增量扫描；超阈值（如 >5000 篇）时降级为抽样检查 |
| 批量操作误伤 | 数据丢失 | 强制 preview 快照；单项失败即停（可配置）；整体回滚 |
| 未配置模型 | 管家能力全失效 | 巡检的**规则类检查项**（失效链接、空目录、孤儿笔记）使用 `localFallback` 纯本地实现，不依赖模型；仅"AI 解读与建议"部分需要模型 |
| 成本失控 | 费用超支 | `CostGovernor` 单日预算硬顶，超限自动降级到小模型并提示 |
| 库级工具返回过大 | 上下文溢出 | 所有库级工具强制 `limit` 默认值 + 聚合摘要，不返回全文 |

**关键降级原则**：巡检的"发现问题"能力必须**无模型可用**，只有"解读与建议"依赖模型。这样即使未配置 AI，管家仍能完成基础的体检与提示。

---

## 9. 附录

### 附录 A · 迁移对照表（P0）

| 旧方法 | 目标 Skill | 是否需确认 | 涉及文件 |
|---|---|---|---|
| `ai.suggestLinks` | `suggest-links`（已存在） | 否（仅推荐） | `MultiNoteEditor.tsx:75` |
| `ai.suggestDir` | `suggest-dir`（已存在） | 否 | `MultiNoteEditor.tsx:88` |
| `ai.generateTags` | `summarize-tags`（已存在） | 否 | `MultiNoteEditor.tsx:109`、`RightPanel.tsx:196` |
| `ai.forgeCard` | `forge-card`（已存在） | 否（生成卡片内容，由用户决定是否落盘） | `MultiNoteEditor.tsx:159` |
| `ai.insertLinks` | `insert-links`（**新增**） | **是** | `MultiNoteEditor.tsx:165`、`DiagnosePage.tsx:153` |
| `ai.ask` | `diagnose` / `ask` | 否 | `DiagnosePage.tsx:127` |
| `ai.refineNote` | `refine-note`（**新增**） | **是** | `NotePane.tsx:86` |
| `ai.askAboutNote` | 合并进 `hubRunStream`（`ask` + notePath） | 否 | `NoteAIChat.tsx:123` |
| `ai.quickNote` | `quick-note`（已存在） | 否 | `kb-store.ts:103` |

### 附录 B · 新增能力清单

**Skill（3 个）**

| id | 标题 | awaitConfirm | 说明 |
|---|---|---|---|
| `refine-note` | 笔记润色 | 是 | 从 `ai-service.refineNote` 下沉，接入 Patch 确认 |
| `insert-links` | 插入双链 | 是 | 从 `ai-service.insertLinks` 下沉 |
| `inspiration` | 灵感工坊 | 否 | 与 `runAgent('inspirer')` 统一 |

**MCP 工具（6 个，均为只读）**

`kb_stats` / `kb_duplicates` / `kb_orphans` / `kb_tag_tree` / `kb_structure_review` / `kb_stale`

**ConfirmableAction（3 个批量 + 钩子）**

`batchPatch` / `batchMove` / `batchRetag`；`notePatch` 补 `verify` / `rollback`

**服务（1 个）**

`patrol-service.ts` —— 巡检调度、报告生成、建议节流

### 附录 C · 建议文件结构（P3 目标态）

```
src/main/
├── services/
│   ├── ai-hub.ts                 统一入口
│   ├── ai-config.ts              配置读写（从 ai-service 拆出）
│   ├── ai-protocol.ts            OpenAI / Ollama 适配（从 ai-service 拆出）
│   ├── ai-usage.ts               用量统计 + CostGovernor
│   ├── skill-engine.ts           Skill 注册表（唯一事实来源）
│   ├── tool-runtime.ts           MCP 工具（9 → 15）
│   ├── confirmable-action-service.ts
│   ├── note-patch.ts
│   ├── patrol-service.ts         新增：巡检
│   ├── session-store.ts          持久化
│   ├── profile-service.ts
│   └── agents/
├── prompts/                      新增：集中 Prompt
│   ├── index.ts                  PromptRegistry（版本 + 变量注入）
│   ├── skills/<skillId>.ts
│   └── agents/<agentId>.ts
└── ...
```

### 附录 D · 与既有方案的关系

| 既有方案 | 本方案的定位 |
|---|---|
| `AI调用重构技术方案.md` | 定义了 AIHub / Skill / MCP 底座。本方案 §5.1 是它的**收尾**——把尚未迁移的 11 处调用真正收敛进底座 |
| `MCP技术实现方案.md` | 定义了 Confirm-then-Act 框架。本方案 §5.2 是它的**扩展**——补上验证/回滚/批量，形成完整闭环 |
| `多Agent技术实现方案.md` | 定义了 Agent 人格路由。本方案在收敛后会自然提升 Agent 覆盖率（当前旧通道无 Agent 注入） |
| `用户画像实现方案.md` | 定义了画像抽取。本方案 §3.2 G-B7 指出其利用率问题，并在 P2-5 主动建议中加以应用 |

---

## 10. 修订记录

| 版本 | 日期 | 说明 |
|---|---|---|
| v1.0 | 2026-08-28 | 初稿。基于全量代码扫描的现状盘点、差距诊断与 P0–P3 实施路线 |
| v1.1 | 2026-08-28 | P0 / P1 / P2 已落地，详见 §11 |

---

## 11. 实施进度（v1.1）

### 11.1 已完成

| 阶段 | 任务 | 落地要点 |
|---|---|---|
| **P0-1** | 补齐缺失 Skill | 新增 `refine-note` / `insert-links` / `generate-tags` / `summarize`；从 `SKILL_TO_AGENT` 移除纯 Agent 包装的 `inspiration`（走 agentId 通道），消除映射表与注册表漂移 |
| **P0-2** | 迁移 11 处旧调用 | 全部经 `hubRun` / `hubRunStream`；新增 `src/renderer/utils/ai-hub.ts` 统一封装；`insertLinks` / `refineNote` 补齐确认流 |
| **P0-3** | 统一流式 | 渲染层流式入口唯一化为 `hubRunStream`；`askStream` 标注为 AIHub 内部实现 |
| **P0-4** | 清理死代码 | 删除从未被引用的 `AIChat.tsx` |
| **P1-1** | 会话持久化 | `session-store` 落盘到 `<kbRoot>/.forge/ai-sessions/`，惰性加载 + LRU 淘汰 + 退出前 flushAll |
| **P1-2 / P1-3** | 会话存储统一 | `sessionId` 持久化到 `ChatConversation`，删除 `convSessionMap` |
| **P1-4** | 强化 `useAISession` | 补齐流式 / 工具活动 / 确认 / 验证 / 回滚；`NoteAIChat` 已重构复用 |
| **P2-2** | 知识库级工具 | 新增 `kb_stats` / `kb_duplicates` / `kb_orphans` / `kb_tag_tree` / `kb_structure_review` / `kb_stale`，均为只读 |
| **P2-3** | 验证与回滚 | `ActionHandler` 增加 `verify` / `rollback`；`notePatch` 实现回读校验与快照回滚；新增 `AI_ACTION_VERIFY` / `AI_ACTION_ROLLBACK` |
| **P2-4** | 批量任务 | 新增 `batchPatch` / `batchMove` / `batchRetag`；`batchPatch` 支持整体回滚；渲染层新增批量确认卡片 |
| **P2-1** | 知识库巡检 | 新增 `patrol-service`，7 类规则检查 + 健康分 + 24h 缓存；接入「诊断」页体检卡片 |
| **P2-5** | 主动建议 | `getPendingSuggestions` / `markSuggestionsShown` 实现 7 天静默节流；`PatrolSuggestionWatcher` 启动后自动提示 |

### 11.2 关键设计决策（与初稿的差异）

1. **`inspiration` 不注册为 Skill**。初稿建议补齐它，但 `ai-hub.agentAsSkill` 已让 Agent 成为一等可调用对象，纯包装只会制造冗余。改为从 `SKILL_TO_AGENT` 移除，并在表上加注释防止再次漂移。

2. **新增 `summarize` 与 `generate-tags` 两个 Skill**（初稿未列）。原因是 `MultiNoteEditor` / `RightPanel` 分别只用到摘要或只用到标签，若统一走 `summarize-tags` 会多跑一次大模型。拆开后每个 UI 入口只付一次调用成本。

3. **`refine-note` 执行前先把编辑器内容落盘**。笔记润色原本直接替换编辑器文档，接入确认流后主进程以磁盘内容为 Patch 基线，先落盘可保证「预览所见 == 实际所改」，同时避免丢失未保存编辑。

4. **巡检建议的执行不经过 AIHub**。巡检由本地规则生成，若走 `agent` skill 的确认分支会调用模型做总结，违背「无模型也能用」的降级原则。因此新增 `AI_ACTION_EXECUTE` 直接执行已注册 action。

5. **会话数据仍为双份，但职责已明确**。主进程 `session-store` 是 AI 上下文唯一来源（已持久化），`chat-store` 是 UI 展示唯一来源（含 refs / usage / toolActivity）。彻底合并为一份需要改造消息渲染链路，收益不足以抵消风险，故停在职责边界清晰的形态。

### 11.3 遗留与后续（P3）

- Prompt 集中治理（`src/main/prompts/`）
- 成本治理 `CostGovernor`（预算 / 限流 / 告警）
- `ai-service.ts` 拆分为 `ai-config` / `ai-protocol` / `ai-usage`
- 索引同步统一收口到 `fs-service` 写操作出口
- 批量任务的进度事件推送（当前为一次性返回，未做 `AI_BATCH_PROGRESS` 流式进度）
