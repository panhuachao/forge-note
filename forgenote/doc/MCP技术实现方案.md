# 锦囊笔记 · MCP 笔记修改确认技术方案

> 版本：v1.0（草案）
> 目标：在 AI 笔记对话中，当 AI 需要修改笔记时，先向用户展示修改建议（diff/说明），由用户显式确认后再落盘；整个修改过程以 **MCP 工具** 为执行体，并为「更新设置、打开弹窗、移动笔记」等知识库操作预留通用确认-执行框架。
>
> 前置文档：
> - `doc/AI调用重构技术方案.md` §4.2（Confirm-then-Act 会话与草稿）
> - `doc/AI调用重构技术方案.md` §6（MCP 工具运行时）

---

## 1. 现状梳理

### 1.1 已有基础

| 模块 | 现状 | 与本方案关系 |
|---|---|---|
| `src/main/services/tool-runtime.ts` | 已定义本地 MCP 形态工具 `KB_TOOLS`（检索/读/写/诊断），`executeTool` 直接落盘 | 增加「预览/应用 Patch」工具，写工具走确认流 |
| `src/main/services/mcp-client.ts` | 已支持外部 MCP Server（stdio/SSE）接入 | 外部工具同样可纳入确认框架 |
| `src/main/services/ai-hub.ts` | 统一入口 `aiHub.run/runStream`，已支持 `confirm`/`draft`/`sessionId` | 复用 `confirm-then-act` 控制流 |
| `src/main/services/session-store.ts` | 内存会话存储，支持 `setDraft/clearDraft` | 保存待确认草稿 |
| `src/main/services/skill-engine.ts` | 内置 `agent` skill，已声明 `awaitConfirm: true` | 让 `agent` 在首轮只产出 draft，确认后再调用写工具 |
| `src/renderer/stores/useAISession.ts` | 已封装 `run/confirmDraft/cancel/pendingDraft` 状态 | 渲染层状态机基础 |
| `src/renderer/pages/ChatPage.tsx` | 智能体模式可调用 `agent` skill，但未处理 `pending` 草稿 | 需要渲染确认 UI |
| `src/renderer/components/NoteAIChat.tsx` | 围绕单篇笔记的侧栏对话 | 同样可接入确认卡片 |

### 1.2 当前痛点

1. **写工具直接落盘**：`KB_TOOLS` 中的 `kb_write_note` 被模型调用后立即写入，没有给用户确认机会。
2. **缺少 diff 预览**：用户看不到 AI 到底要改什么，无法判断修改是否安全。
3. **确认态未闭环**：`AIResponse` 已支持 `pending` 标记，`useAISession` 已有 `confirmDraft`，但 `ChatPage`/`NoteAIChat` 没有渲染确认 UI。
4. **无法扩展**：确认-执行逻辑若写死在笔记修改里，未来「更新设置 / 打开弹窗 / 移动笔记」需要重复造轮子。

---

## 2. 设计目标

| 维度 | 目标 |
|---|---|
| 安全 | 任何写入知识库/配置/产生副作用的操作，必须先展示草稿并显式确认 |
| 透明 | 用户能看到修改前后 diff、影响范围、预计结果 |
| 可控 | 用户可「确认修改」「放弃」「仅复制建议内容」 |
| 一致 | 无论本地 MCP 工具还是外部 MCP 工具，都走同一套确认-执行协议 |
| 可扩展 | 新增一种「需要确认的操作」只需注册 action handler + 渲染卡片，不改主干 |

---

## 3. 总体架构

```
┌──────────────────────────────── 渲染进程 ──────────────────────────────┐
│  ChatPage / NoteAIChat                                                   │
│       │                                                                  │
│       ▼                                                                  │
│  ConfirmableActionCard（建议卡片：预览 + 确认/放弃按钮）                    │
│       │  via window.forge.ai.hubRun({ confirm: true/false })             │
└───────┼──────────────────────────────────────────────────────────────────┘
        │ IPC (AI_HUB_RUN / AI_HUB_STREAM)
┌───────▼────────────────────────── 主进程 ──────────────────────────────┐
│  AIHub（统一入口）                                                        │
│   ├─ 首轮：模型只读工具 + kb_preview_patch → 产出 pending 草稿            │
│   ├─ 确认：将 approved draft 注入会话 → 暴露 kb_apply_patch 等写工具        │
│   └─ 执行：调用 ConfirmableActionService 或 tool-runtime 落盘              │
│                                                                          │
│  ToolRuntime：本地 MCP 工具（kb_preview_patch / kb_apply_patch / ...）   │
│  ConfirmableActionService：通用 action handler 注册表                      │
│  AuditService：记录副作用，支持按 sessionId 撤销                         │
└──────────────────────────────────────────────────────────────────────────┘
```

核心原则：**模型可见的工具集由确认状态决定**——未确认时只有「读/预览」工具；确认后才暴露「应用/写」工具。这比单纯靠提示词约束更可靠。

---

## 4. MCP 工具层设计

### 4.1 新增本地 MCP 工具

在 `src/main/services/tool-runtime.ts` 的 `KB_TOOLS` 中新增以下工具（非破坏性工具任何轮次都可见；破坏性工具仅在确认后可见）。

#### 4.1.1 `kb_preview_patch`（预览修改）

```ts
{
  name: 'kb_preview_patch',
  description: '对指定笔记生成修改预览（diff），不真正写入文件。当你想修改某篇笔记时，先调用本工具让用户确认。',
  input_schema: {
    type: 'object',
    properties: {
      notePath: { type: 'string', description: '笔记相对路径' },
      ops: {
        type: 'array',
        description: '修改操作列表',
        items: {
          type: 'object',
          properties: {
            op: { type: 'string', enum: ['set_frontmatter', 'replace', 'insert_after', 'append', 'delete_lines'] },
            key: { type: 'string', description: 'frontmatter 键名（op=set_frontmatter 时用）' },
            value: { type: 'string', description: 'frontmatter 值' },
            oldText: { type: 'string', description: '被替换的文本（op=replace 时用）' },
            newText: { type: 'string', description: '替换后的文本' },
            anchor: { type: 'string', description: '定位锚点（op=insert_after 时用）' },
            text: { type: 'string', description: '插入内容' },
            startLine: { type: 'number', description: '起始行号（op=delete_lines 时用）' },
            endLine: { type: 'number', description: '结束行号' }
          },
          required: ['op']
        }
      }
    },
    required: ['notePath', 'ops']
  }
}
```

返回：

```ts
{
  notePath: string;
  canApply: boolean;      // oldText 是否全部命中
  unchanged: string;      // 当前正文（用于渲染左侧）
  preview: string;        // 修改后正文（用于渲染右侧）
  diff: string;           // unified diff 文本
  affectedLines: number;  // 影响行数
}
```

实现要点：
- 使用 `fsService.readNote(kbId, notePath)` 读取当前内容。
- 在内存中应用 patch，**不调用 writeNote**。
- `replace` 操作若 `oldText` 未命中，则 `canApply=false`。
- 计入审计的 `preview` 类型（只读、无副作用）。

#### 4.1.2 `kb_apply_patch`（应用修改）

```ts
{
  name: 'kb_apply_patch',
  description: '将已预览并确认的 Patch 应用到指定笔记。只有在用户明确确认后才能调用。',
  input_schema: {
    type: 'object',
    properties: {
      notePath: { type: 'string' },
      ops: { /* 同 kb_preview_patch */ },
      approvedDraftId: { type: 'string', description: '用户确认的草稿 id' }
    },
    required: ['notePath', 'ops', 'approvedDraftId']
  }
}
```

实现要点：
- 再次读取当前文件，验证 patch 仍与当前内容兼容（乐观锁）。
- 调用 `fsService.writeNote(kbId, notePath, newContent)` 落盘。
- `auditService.record(kbId, 'aiWrite', { notePath, ops, approvedDraftId, by: 'ai' })`。
- 返回 `{ notePath, appliedOps, result: '已写入' }`。

#### 4.1.3 `kb_read_note` 增强

`kb_read_note` 已经存在，用于让模型读取笔记完整内容；无需改动。

### 4.2 工具可见性控制

在 `aiService.agentChat` 中，传给模型的 `tools` 数组需要动态过滤：

```ts
const canWrite = !!pendingDraft; // AIHub 注入 ctx.pendingDraft
const visibleTools = KB_TOOLS.filter((t) => {
  if (t.name === 'kb_apply_patch') return canWrite;
  // 其它写工具（kb_write_note 等）也只在确认后暴露
  if (t.name === 'kb_write_note') return canWrite;
  return true;
});
```

这样即使模型在首轮调用 `kb_apply_patch`，`executeTool` 也会因 `approvedDraftId` 缺失/不匹配而拒绝。

---

## 5. 主进程确认-执行流程

### 5.1 会话状态

复用现有 `AISession.draft` 字段，结构化为 `ConfirmableAction`：

```ts
// src/shared/types/ai.ts
export interface ConfirmableAction {
  id: string;                          // draft_xxx
  type: 'notePatch' | 'settingUpdate' | 'openDialog' | 'moveNote' | 'createNote';
  title: string;                     // 用户可见标题，如「修改：01 项目/foo.md」
  description: string;               // AI 对修改的说明
  payload: unknown;                  // 工具执行所需参数
  preview?: unknown;               // 渲染预览用的数据
}
```

`AIResponse` 的 `structured` 形态：

```ts
{ kind: 'structured', data: ConfirmableAction, pending: true }
```

### 5.2 首轮流程（产出建议）

1. 用户在 `ChatPage` 输入「把这篇笔记的格式改规范」。
2. 渲染层调用 `window.forge.ai.hubRun({ skill: 'agent', input: { text }, kbId, sessionId })`。
3. `AIHub` 进入 `agent` skill；`pendingDraft` 为空，故模型只可见 `kb_preview_patch` 等只读/预览工具。
4. 模型调用 `kb_preview_patch` 拿到 diff。
5. 模型最终输出：`kind: 'structured'`，`data` 为 `ConfirmableAction { type:'notePatch', preview: {diff,...} }`，`pending: true`。
6. `AIHub` 调用 `sessionStore.setDraft(sessionId, action)`。
7. 渲染层在聊天流中渲染 `ConfirmableActionCard`。

### 5.3 确认流程（执行修改）

1. 用户点击「确认修改」。
2. 渲染层调用 `window.forge.ai.hubRun({
     skill: 'agent',
     input: { text: '确认修改' },
     kbId,
     sessionId,
     confirm: true,
     draft: action            // 把 approved action 回传
   })`。
3. `AIHub` 从 `sessionStore` 取出 draft 校验，并把 `pendingDraft` 注入 `AISkillCtx`。
4. 模型现在可见 `kb_apply_patch`。
5. 模型调用 `kb_apply_patch` 落盘。
6. `AIHub` 返回 `{ kind: 'text', text: '已按建议修改完成。' }`。

### 5.4 放弃流程

用户点击「放弃」：
- 渲染层直接清空本地 pending action。
- 可选项：发送一次 `confirm: false` 的请求，让 `sessionStore.clearDraft(sessionId)`。

### 5.5 通用 ConfirmableActionService

新增 `src/main/services/confirmable-action-service.ts`：

```ts
interface ActionHandler<T = unknown> {
  preview?: (payload: T, ctx: ToolCtx) => Promise<unknown>;
  execute: (payload: T, ctx: ToolCtx) => Promise<unknown>;
}

class ConfirmableActionService {
  private handlers = new Map<string, ActionHandler>();
  register<T>(type: string, handler: ActionHandler<T>) { ... }
  async preview(type: string, payload: unknown, ctx: ToolCtx) { ... }
  async execute(type: string, payload: unknown, ctx: ToolCtx) { ... }
}

export const actionService = new ConfirmableActionService();
```

注册示例：

```ts
// src/main/index.ts 或 ipc.ts 启动时注册
actionService.register('notePatch', {
  preview: async (payload, ctx) => previewPatch(ctx.kbId, payload.notePath, payload.ops),
  execute: async (payload, ctx) => applyPatch(ctx.kbId, payload.notePath, payload.ops)
});

actionService.register('settingUpdate', {
  execute: async (payload) => {
    setConfig(payload.key, payload.value);
    return { ok: true };
  }
});

actionService.register('openDialog', {
  execute: async (payload, ctx, win) => {
    // 主进程向渲染进程推送打开弹窗事件
    getMainWindow()?.webContents.send(IPC.EV_OPEN_DIALOG, payload);
    return { opened: true };
  }
});
```

---

## 6. 渲染层交互设计

### 6.1 新增组件 `ConfirmableActionCard`

路径：`src/renderer/components/ConfirmableActionCard.tsx`

职责：根据 `ConfirmableAction.type` 渲染不同的确认卡片。

```tsx
interface Props {
  action: ConfirmableAction;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmableActionCard({ action, onConfirm, onCancel }: Props) {
  switch (action.type) {
    case 'notePatch':
      return <NotePatchCard action={action} onConfirm={onConfirm} onCancel={onCancel} />;
    case 'settingUpdate':
      return <SettingUpdateCard action={action} onConfirm={onConfirm} onCancel={onCancel} />;
    case 'openDialog':
      return <OpenDialogCard action={action} onConfirm={onConfirm} onCancel={onCancel} />;
    default:
      return <GenericActionCard action={action} onConfirm={onConfirm} onCancel={onCancel} />;
  }
}
```

### 6.2 笔记修改卡片 UI

```tsx
function NotePatchCard({ action, onConfirm, onCancel }: Props) {
  const preview = action.preview as { diff: string; affectedLines: number };
  return (
    <div className="rounded-xl border border-brand/30 bg-brand-soft/20 p-3 my-2">
      <div className="text-sm font-medium text-fg mb-1">{action.title}</div>
      <div className="text-xs text-fg-secondary mb-2">{action.description}</div>
      <div className="text-[11px] text-fg-faint mb-2">
        预计影响 {preview.affectedLines} 行
      </div>
      <pre className="text-[11px] bg-canvas/80 rounded-lg p-2 overflow-auto max-h-40 mb-3">
        {preview.diff}
      </pre>
      <div className="flex gap-2">
        <button onClick={onConfirm} className="btn btn-primary text-xs px-3 py-1">确认修改</button>
        <button onClick={onCancel} className="btn text-xs px-3 py-1">放弃</button>
        <button
          onClick={() => navigator.clipboard.writeText(preview.diff)}
          className="btn text-xs px-3 py-1 ml-auto"
        >复制</button>
      </div>
    </div>
  );
}
```

### 6.3 ChatPage 集成

在 `ChatPage` 的 `sendWithText` 中：

```ts
const res = await window.forge.ai.hubRunStream({ ... });
if (res?.kind === 'structured' && res.pending) {
  // 把 pending action 挂到当前会话 UI，而不是当作普通文本消息
  setPendingAction(res.data as ConfirmableAction);
  return;
}
```

渲染位置：放在 assistant 消息下方或作为一条特殊系统消息。

```tsx
{pendingAction && (
  <ConfirmableActionCard
    action={pendingAction}
    onConfirm={() => {
      sendWithText('确认修改'); // 或走 useAISession.confirmDraft
      setPendingAction(null);
    }}
    onCancel={() => setPendingAction(null)}
  />
)}
```

### 6.4 NoteAIChat 集成

`NoteAIChat` 同样可以使用 `useAISession`：

```ts
const { run, confirmDraft, pendingDraft } = useAISession({ skill: 'agent', kbId });
```

当 `pendingDraft` 存在时渲染 `ConfirmableActionCard`。

---

## 7. 安全、审计与撤销

### 7.1 安全原则

1. **工具白名单动态控制**：未确认时，写工具不出现在模型工具列表中。
2. **草稿校验**：确认执行时，主进程比对 `req.draft` 与会话 `session.draft` 是否一致，防止前端伪造。
3. **幂等操作**：`kb_apply_patch` 带 `approvedDraftId`，同一草稿重复确认不会重复写入（可记录已执行草稿 id）。
4. **乐观锁**：应用 patch 前重新读取文件，若内容已变则拒绝执行并提示用户刷新。

### 7.2 审计

所有确认执行的操作都记录审计：

```ts
auditService.record(kbId, 'confirmableAction', {
  actionType: action.type,
  sessionId,
  draftId: action.id,
  payload: action.payload,
  by: 'ai'
});
```

`AuditPage` 可展示「AI 建议 → 用户确认 → 执行」的完整链路，并支持按 `sessionId` 批量撤销。

---

## 8. 扩展场景

通用 `ConfirmableAction` 框架让未来新增确认类操作只需三步：

| 场景 | type | preview | execute |
|---|---|---|---|
| 更新设置 | `settingUpdate` | 展示「将 xxx 改为 yyy」 | `setConfig(key, value)` |
| 打开弹窗 | `openDialog` | 展示弹窗说明 | 主进程推送 `EV_OPEN_DIALOG` |
| 移动笔记 | `moveNote` | 展示源路径 → 目标目录 | `fsService.moveNote` |
| 创建笔记 | `createNote` | 展示标题/目录/内容摘要 | `fsService.createNote` |
| 外部 MCP 写操作 | `external.<server>.<tool>` | 由外部 MCP 返回 diff/摘要 | `executeExternalTool` |

---

## 9. 实施步骤

### Phase 1：笔记修改闭环（MVP）

1. `src/main/services/tool-runtime.ts`：新增 `kb_preview_patch` / `kb_apply_patch`。
2. `src/main/services/ai-service.ts`：`agentChat` 根据 `pendingDraft` 动态过滤写工具。
3. `src/shared/types/ai.ts`：增加 `ConfirmableAction` 类型。
4. `src/renderer/components/ConfirmableActionCard.tsx`：新增 `notePatch` 卡片。
5. `src/renderer/pages/ChatPage.tsx`：处理 `pending` 响应，渲染确认卡片；确认/放弃后再次调用 `hubRunStream`。

### Phase 2：抽象通用框架

1. `src/main/services/confirmable-action-service.ts`：新建 handler 注册表。
2. `src/main/services/tool-runtime.ts`：`kb_preview_patch` / `kb_apply_patch` 内部调用 `actionService`。
3. `src/renderer/components/ConfirmableActionCard.tsx`：拆分为 `NotePatchCard/SettingUpdateCard/OpenDialogCard`。

### Phase 3：扩展非笔记操作 ✅ 已实现

1. ✅ 新增 `moveNote` / `createNote` / `settingUpdate` handler（`confirmable-action-service.ts`）。
2. ✅ 新增 `IPC.EV_OPEN_DIALOG` 与 `preload` 监听 `events.onOpenDialog`，`openDialog` handler 在 `ipc.ts` 注册。
3. ✅ `NoteAIChat` 接入：新增「智能体」开关，开启后走 `hubRunStream(skill:'agent')`，携带 `input.notePath` 聚焦当前笔记，支持工具调用气泡与待确认卡片。
4. ⚠️ `ChatPage` 保留自建的流式 + 多会话（`convSessionMap`）管理，未强行替换为 `useAISession`——`useAISession` 走的是非流式 `hubRun`，替换会丢失流式渲染与工具调用气泡。其确认能力已等价实现。

---

## 10. 文件清单

| 文件 | 改动 |
|---|---|
| `src/main/services/note-patch.ts` | **新增**：Patch 预览/应用、previewStore、乐观锁、行级 diff |
| `src/main/services/confirmable-action-service.ts` | **新增**：通用 handler 注册表 + `notePatch` / `moveNote` / `createNote` / `settingUpdate` |
| `src/main/services/tool-runtime.ts` | 新增 `kb_preview_patch` / `kb_apply_patch`；导出 `WRITE_TOOLS` |
| `src/main/services/ai-service.ts` | `agentChat` 新增 `canWrite`，未确认时剔除写工具 |
| `src/main/services/skill-engine.ts` | `agent` skill 双模式；`extractConfirmableAction()`；`input.notePath` 支持 |
| `src/main/services/ai-hub.ts` | 复用 `confirm/draft`；**修复** `runStream` 把 `structured` 压平导致 `pending` 丢失 |
| `src/main/services/audit-service.ts` | action 类型扩展 `aiPatch` / `confirmableAction` |
| `src/main/services/session-store.ts` | 无需改动，已支持 draft |
| `src/main/ipc.ts` | 注册 `openDialog` handler + `EV_OPEN_DIALOG` 推送 |
| `src/shared/types/ai.ts` | 新增 `NotePatchOp` / `NotePatchPreview` / `NotePatchPayload` / `ConfirmableAction` |
| `src/shared/types/events.ts` | `AuditEntry.action` 扩展 |
| `src/shared/ipc-channels.ts` | 新增 `EV_OPEN_DIALOG` |
| `src/preload/index.ts` | 暴露 `events.onOpenDialog` |
| `src/renderer/components/ConfirmableActionCard.tsx` | **新增**：`notePatch` 卡片 + 通用卡片 |
| `src/renderer/pages/ChatPage.tsx` | 拦截 pending 响应；`confirmPendingAction()` |
| `src/renderer/components/NoteAIChat.tsx` | 智能体模式开关 + 流式 + 工具气泡 + 确认卡片 |
| `doc/MCP技术实现方案.md` | 本文档 |

---

## 11. 示例对话

```text
用户：把这篇笔记里的「AI 客服」统一改成「智能客服」，并补充一条标签。

AI（首轮）：
┌────────────────────────────────────┐
│ 修改建议：当前笔记                    │
│ 将文中 3 处「AI 客服」替换为「智能客服」│
│ 在 frontmatter.tags 追加 #智能客服    │
│ 预计影响 4 行                        │
│ [确认修改] [放弃] [复制]             │
└────────────────────────────────────┘

用户：点击「确认修改」

AI（确认后）：已按建议修改完成，并同步更新了 frontmatter 标签。
```

---

## 12. 备注

- 本方案**不改动**现有非智能体对话路径（`ask` skill），仅对 `agent` skill 引入确认流；未来可按需把 `refine-note` 等写类 skill 也纳入。
- 外部 MCP 工具若包含写操作（如 `calendar.create_event`），同样应返回 `ConfirmableAction` 并走确认流，本方案已在 `ConfirmableAction.type` 预留 `external.<server>.<tool>` 命名空间。
- 当前 `agent` skill 的 `awaitConfirm: true` 标记是能力开关，UI 层应据此在工具条/设置中提示用户「该模式下 AI 的写操作需要确认」。
