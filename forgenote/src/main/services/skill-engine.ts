// Skill 注册表（方案 §5）
// 每个 AISkill = 一段声明式能力单元；新增一个 AI 能力只需在此注册，无需改主进程 / IPC / 渲染骨架。
// AIHub 按 skill.id 路由到对应 handler，并由 SessionStore 自动挂载多轮上下文（stateful Skill）。
import { aiService } from './ai-service';
import { profileService } from './profile-service';
import { retrieve } from './rag-service';
import { searchService } from './search-service';
import { KB_TOOLS, executeTool, type ToolActivity } from './tool-runtime';
import { actionService } from './confirmable-action-service';
import { getStoredPreview } from './note-patch';
import type { AIResponse, AITurn, AIRefHit, AIUsage, ConfirmableAction, NotePatchPayload, NotePatchPreview } from '@shared/types/ai';

/**
 * Skill → Agent 默认映射（多 Agent 方案 §3.5）。
 * 渲染层若不显式传 agentId，则按此表路由到对应专家角色。
 */
export const SKILL_TO_AGENT: Record<string, string> = {
  ask: 'conversationalist',
  agent: 'conversationalist',
  diagnose: 'diagnostician',
  'quick-note': 'refiner',
  'refine-note': 'refiner',
  'forge-card': 'card-smith',
  'daily-insight': 'daily-muse',
  inspiration: 'inspirer'
};

/** 解析本次请求的 Agent：显式 agentId 优先，否则按 SKILL_TO_AGENT 兜底到 conversationalist */
export function resolveAgentId(skillId: string, explicit?: string): string {
  return explicit || SKILL_TO_AGENT[skillId] || 'conversationalist';
}

/** Skill 运行上下文（由 AIHub 注入） */
export interface AISkillCtx {
  kbId?: string;
  input: { text: string; question?: string; dirId?: string; notePath?: string };
  /** 已注入的多轮历史（stateful Skill 才有） */
  history: AITurn[];
  /** 会话草稿（awaitConfirm Skill 确认后回传） */
  pendingDraft?: unknown;
  onActivity?: (a: ToolActivity) => void;
  /** 多 Agent 方案：当前请求指定的 Agent 角色（已由 AIHub 解析，含 SKILL_TO_AGENT 兜底） */
  agentId?: string;
}

/** 统一 Skill 声明（本地类型，避免与 shared/types/ai.ts 的 Skill 冲突） */
export interface AISkill {
  id: string;
  title: string;
  description: string;
  /** 模型能力偏好（预留 ModelRouter） */
  capability?: ('reasoning' | 'long-context' | 'cheap')[];
  /** 需要跨轮上下文（AIHub 自动挂载 SessionStore） */
  stateful?: boolean;
  /** 首轮只产出 draft，确认后才执行写工具（方案 §4.2 / §5.4） */
  awaitConfirm?: boolean;
  /** 需要调用的 MCP 工具 id（见 tool-runtime.ts / mcp-client.ts） */
  useTools?: string[];
  /** 无模型时的本地降级 */
  localFallback?: (ctx: AISkillCtx) => AIResponse | Promise<AIResponse>;
  /** 实际执行 */
  run: (ctx: AISkillCtx) => Promise<AIResponse & { refs?: AIRefHit[]; usage?: AIUsage }>;
}

function txt(text: string): AIResponse {
  return { kind: 'text', text };
}
function structured(data: unknown): AIResponse {
  return { kind: 'structured', data };
}

/**
 * 检测时间维度问题，返回 { sinceDays, label } 或 null。
 * 例如「今天」「昨天」「本周」「最近 7 天」「近三天」「这周」→ 走按时间筛笔记的总结路径。
 */
export function parseTimeRange(q: string): { sinceDays: number; label: string } | null {
  const text = q || '';
  // 显式数字 + 天/日
  const m1 = text.match(/最近\s*(\d{1,2})\s*(天|日)/);
  const m2 = text.match(/近\s*(\d{1,2})\s*(天|日)/);
  if (m1 || m2) {
    const d = parseInt((m1?.[1] ?? m2![1]) as string, 10);
    if (Number.isFinite(d) && d > 0 && d <= 90) return { sinceDays: d, label: `最近 ${d} 天` };
  }
  if (/今天|今日|当天/.test(text)) return { sinceDays: 1, label: '今天' };
  if (/昨天|昨日/.test(text)) return { sinceDays: 2, label: '昨天' };
  if (/本周|这周|这礼拜/.test(text)) return { sinceDays: 7, label: '本周' };
  if (/上周|上礼拜/.test(text)) return { sinceDays: 14, label: '上周（取近 14 天）' };
  if (/本月|这个月|这月/.test(text)) return { sinceDays: 30, label: '本月' };
  if (/最近一周|近一周|过去一周/.test(text)) return { sinceDays: 7, label: '最近一周' };
  return null;
}

/** 把 AITurn 历史裁剪为 askWithHistory 需要的 {role,text} 形态（去掉 tool 轮、超长截断） */
function toChatHistory(turns: AITurn[]): { role: 'user' | 'assistant'; text: string }[] {
  const pairs = turns
    .filter((t) => (t.role === 'user' || t.role === 'assistant') && t.text)
    .map((t) => ({ role: t.role as 'user' | 'assistant', text: t.text! }));
  // #5 历史压缩：仅保留最近 KEEP 轮原文，更早的轮次抽取首句压缩为单行摘要，避免 context 膨胀
  return compressHistory(pairs, 8);
}

/**
 * 历史压缩（#5）：低成本本地摘要。
 * 保留最近 keep 轮原文；超出部分用「每轮首句截断」拼成一行（前文摘要），
 * 不调用 LLM，既控制 token 又保留跨轮意图连续性。
 */
export function compressHistory(
  pairs: { role: 'user' | 'assistant'; text: string }[],
  keep = 8
): { role: 'user' | 'assistant'; text: string }[] {
  if (pairs.length <= keep) return pairs;
  const recent = pairs.slice(-keep);
  const older = pairs.slice(0, pairs.length - keep);
  const digest = older
    .map((t) => `${t.role === 'user' ? '用户' : '助手'}：${t.text.replace(/\s+/g, ' ').slice(0, 40)}`)
    .join('；');
  return [{ role: 'assistant', text: `（前文摘要）${digest}…` }, ...recent];
}

/**
 * 内置 Skill 注册表。迁移自 ai-service.ts 的 ~8 个业务方法（方案 §5.2）。
 * 新增能力 = 在此追加一项，AIHub.run 自动支持。
 */
/**
 * 时间维度总结（「今天/昨天/本周/最近 N 天」）：按 mtime 筛笔记 → 读正文 → 让模型总结。
 * 抽出来供 skill.run（非流式）与 ai-hub 流式分支共用，避免两套实现漂移。
 * 返回 null 表示不是时间维度问题（调用方应走标准 RAG）。
 */
export async function runTimeSummary(
  kbId: string | undefined,
  question: string,
  history: AITurn[],
  onToken?: (delta: string) => void,
  onActivity?: (a: ToolActivity) => void
): Promise<{ text: string; refs: AIRefHit[]; usage: AIUsage } | null> {
  const tr = parseTimeRange(question);
  if (!tr || !kbId) return null;

  // 计数类问题（如「本周写了多少篇」）直接返回真实计数，不调 LLM：
  // 1) 计数答案就是窗口内笔记数，让模型数很容易输出长表格/卡住
  // 2) 避免大量笔记正文进 context 造成 token 浪费与长 prompt 卡死
  // 3) 用 listRecentPaths 拿真实数（不被 topK 截断），比模型自数准确
  if (/(多少|几|几个|几条|多少篇|多少个|数量|总共|一共|共写了?|共编辑|统计|计数)/.test(question)) {
    const sinceTs = Date.now() - tr.sinceDays * 86400_000;
    const paths = await searchService.listRecentPaths(kbId, sinceTs, 5000);
    onActivity?.({ name: 'kb_list_notes', args: { sinceDays: tr.sinceDays }, result: `筛出 ${paths.length} 篇相关笔记` });
    const lines = [`${tr.label} 你共新增或编辑了 **${paths.length}** 篇笔记。`];
    if (paths.length > 0) {
      // 附上笔记名清单（最多列 20 条 + 其余聚合），方便核对
      const top = paths.slice(0, 20);
      lines.push('');
      lines.push('笔记清单：');
      for (const p of top) lines.push(`- [[${p.notePath.split('/').pop()?.replace(/\.md$/i, '') || p.notePath}]]`);
      if (paths.length > top.length) lines.push(`- …（其余 ${paths.length - top.length} 篇略）`);
    }
    const text = lines.join('\n');
    // 计数结果不需要把全部分块都列进 refs，仅列前 20 条作为引用（按 path 去重）
    const refs: AIRefHit[] = paths.slice(0, 20).map((p) => {
      const name = p.notePath.split('/').pop()?.replace(/\.md$/i, '') || p.notePath;
      return { path: p.notePath, name, snippet: '' };
    });
    // 同步流式回调（保持 UI 体验一致：单 token 一次性输出）
    onToken?.(text);
    return { text, refs, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, ms: 0 } };
  }

  // S1 §8：先按时间窗口收敛候选集，再在候选内做语义精排，避免对全库无关笔记做检索
  // S1 §8：先按时间窗口收敛候选集，再在候选内做语义精排，避免对全库无关笔记做检索
  // groupByNote：本周/今天/最近 N 天是「整篇阅读」场景，把同一笔记多块合并为一个 ref，
  // 避免长文档被切多块后在 UI 上产生 N 行重复引用、token 浪费
  const { refs, context } = await retrieve(kbId, question, { sinceDays: tr.sinceDays, topK: 16, tokenBudget: 24000, timeWindowOnly: true, groupByNote: true });
  onActivity?.({ name: 'kb_list_notes', args: { sinceDays: tr.sinceDays }, result: `筛出 ${refs.length} 篇相关片段` });
  if (refs.length === 0) {
    return { text: `${tr.label} 没有新增或编辑的笔记。`, refs: [], usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, ms: 0 } };
  }
  const historyBlock = history.length
    ? `\n\n# 多轮上下文\n${history
        .filter((t) => (t.role === 'user' || t.role === 'assistant') && t.text)
        .map((t) => `${t.role === 'user' ? '用户' : '助手'}：${t.text}`)
        .join('\n')}`
    : '';
  const sys = `你是锦囊笔记的总结助手。用户的问题是按时间维度（${tr.label}）总结知识库笔记。
【当前真实日期】${new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}（用户所问的"今天"即此日期；不要凭历史会话或旧记忆猜测）。
下方已为你筛选出该时间窗口内【${refs.length} 篇】相关笔记的分块内容，请基于内容做结构化总结：
- 提炼出该时间段的核心主题/灵感/行动项
- 若用户要求"今天/本周"汇总，用日期顺序或主题聚类组织
- 引用具体笔记用 [[笔记名#标题]] 形式，并标注命中行号
- 若内容不足以回答，明确说明并建议
${historyBlock}

# ${tr.label}的笔记（共 ${refs.length} 篇）
${context}`;
  // 真流式 #11：逐 token 渲染，降低"思考中"等待焦虑
  let text = '';
  let usage: AIUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, ms: 0 };
  if (onToken) {
    for await (const chunk of aiService.streamChat(question, sys)) {
      const d = chunk.delta || '';
      text += d;
      onToken(d);
      if (chunk.usage) usage = { ...usage, promptTokens: chunk.usage.promptTokens, completionTokens: chunk.usage.completionTokens, totalTokens: chunk.usage.totalTokens, ms: usage.ms };
    }
    return { text, refs, usage };
  }
  const r = await aiService.chat(question, sys);
  return { text: r, refs, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, ms: 0 } };
}

/**
 * 从模型回答中提取「待确认操作」（doc/MCP技术实现方案.md §5.2）。
 * 约定：模型在最终回答里输出一个 ```json 代码块，形如
 * { "type": "notePatch", "title": "...", "description": "...", "payload": { "notePath": "...", "previewId": "pv_xxx" } }
 */
export function extractConfirmableAction(text: string): ConfirmableAction | null {
  if (!text) return null;
  const blocks = Array.from(text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)).map((m) => m[1]);
  for (const b of blocks) {
    const s = b.trim();
    if (!s.startsWith('{')) continue;
    try {
      const obj = JSON.parse(s) as Record<string, unknown>;
      if (typeof obj.type !== 'string' || !obj.type) continue;
      if (!obj.payload || typeof obj.payload !== 'object') continue;
      return {
        id: `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        type: obj.type,
        title: String(obj.title || 'AI 建议的操作'),
        description: String(obj.description || ''),
        payload: obj.payload
      };
    } catch {
      /* 非 JSON 块忽略 */
    }
  }
  return null;
}

/**
 * 兜底：当模型耗尽轮次仍未输出 JSON 建议时，
 * 从工具调用记录里取出最后一次 kb_preview_patch 的结果，
 * 自动构造 notePatch 确认建议（doc/MCP技术实现方案.md）。
 */
function buildFallbackNotePatchAction(
  activities: { name: string; args: Record<string, unknown>; result: string }[],
  kbId?: string
): ConfirmableAction<NotePatchPayload, NotePatchPreview> | null {
  const patchCalls = activities
    .filter((a) => a.name === 'kb_preview_patch')
    .map((a) => {
      try {
        return JSON.parse(String(a.result || '{}')) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((x): x is Record<string, unknown> => !!x);
  const last = patchCalls[patchCalls.length - 1];
  if (!last || typeof last.previewId !== 'string') return null;
  const previewId = last.previewId as string;
  const notePath = String(last.notePath || '');
  if (!notePath) return null;
  const preview = getStoredPreview(previewId);
  const action: ConfirmableAction<NotePatchPayload, NotePatchPreview> = {
    id: `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'notePatch',
    title: `修改：${notePath}`,
    description: '已自动生成修改预览，请确认是否应用。',
    payload: { notePath, previewId },
    preview: preview ?? undefined
  };
  if (preview && kbId) {
    action.preview = preview;
  }
  return action;
}

/** 智能体「建议模式」系统提示：只可检索/预览，修改以 JSON 建议输出 */
const AGENT_PLAN_SYS = `你是锦囊笔记的智能体，可以调用知识库工具来检索、阅读和分析笔记。

【重要：你当前处于「建议模式」，不允许直接修改任何笔记】
可用工具：kb_search / kb_read_note / kb_list_notes / kb_link_graph / kb_diagnose / kb_suggest_dir / kb_preview_patch。

判断是否需要修改：
- 若用户只想总结、分析、提问，**不要修改**，直接以自然语言回答，**不要**输出 json 代码块。
- 若用户明确要求修改笔记（如“调整格式”“润色”“补标签”“统一缩进”“重排章节”等），你必须以“生成修改预览”为最终目标。

流程规则：
1. 先用最少必要工具（通常只需 kb_read_note）理解当前笔记内容。
2. 如果你已经明确知道怎么修改，**立即调用 kb_preview_patch 生成修改预览**（它会返回 previewId 和 diff），不要询问用户是否需要继续。然后输出 \`\`\`json 建议块。
3. 如果你确实没把握，可以简要说明你的理解并最多问 1 个澄清问题。
4. 一旦用户回复「继续」「是的」「好」「确认」「生成预览」「按你说的做」等，即表示同意继续，你必须**立即调用 kb_preview_patch 生成预览**，然后输出 \`\`\`json 建议块。不要再次询问。
5. 最终回答中必须包含且仅包含一个 \`\`\`json 代码块，描述待用户确认的操作，格式如下：
\`\`\`json
{
  "type": "notePatch",
  "title": "修改：<笔记路径>",
  "description": "一句话说明改了什么、为什么",
  "payload": { "notePath": "01 项目/foo.md", "previewId": "pv_xxx" }
}
\`\`\`
6. 永远不要调用 kb_apply_patch、kb_write_note 等写工具；真正的写入只会在用户确认后执行。
7. 引用笔记请使用 [[笔记名]] 形式。`;

/** 智能体「已确认」系统提示：操作已执行，负责向用户总结 */
const AGENT_APPLIED_SYS = `你是锦囊笔记的智能体。用户已确认并执行了某个操作，请用简洁中文（1~3 句）向用户说明执行结果。
不要重复罗列 diff 全文，不要再次输出 json 代码块。`;

/**
 * 规则优先路由（#9）：用关键词/正则先判定意图，命中则直接返回 skill id，
 * 省去一次路由 LLM 调用（低成本、低延迟、零幻觉）。
 * 仅当无法判定时才回落到模型自路由（routeSkill）。
 */
const RULE_ROUTES: { id: string; test: (t: string) => boolean }[] = [
  { id: 'agent', test: (t) => /(帮我|请|自动|智能地|去|执行|操作|创建笔记|写入|整理到|归类到|诊断).*(知识库|笔记)|智能体|agent/.test(t) },
  { id: 'quick-note', test: (t) => /(快速笔记|速记|随手记|记一下|帮我记|保存这段)/.test(t) },
  { id: 'suggest-dir', test: (t) => /(推荐?目录|归到?哪个|放在哪|归属目录|该放哪)/.test(t) },
  { id: 'diagnose', test: (t) => /(诊断|健康检查|失效链接|重复标题|空目录|知识库体检)/.test(t) },
  // 时间维度总结（与 parseTimeRange 对齐）：命中直接走 ask（ask 内部会分流到 runTimeSummary）
  { id: 'ask', test: (t) => /(总结|汇总|回顾|整理了?|写了?什么|进展|日报|周报)/.test(t) || !!parseTimeRange(t) }
];

export function ruleRoute(text: string): string | null {
  const t = text || '';
  for (const r of RULE_ROUTES) if (r.test(t)) return getSkill(r.id) ? r.id : null;
  return null;
}

/**
 * 模型自路由（#1）：规则无法判定时，由模型从已注册能力中挑选最合适的一项。
 * 让新增 Skill 零侵入地参与路由，ai-hub 不再硬编码 skill 列表。
 */
export async function routeSkill(text: string): Promise<string> {
  // #9 规则优先：命中即返回，不花一次 LLM 调用
  const rule = ruleRoute(text);
  if (rule) return rule;
  const catalog = Object.values(SKILLS)
    .map((s) => `- ${s.id}: ${s.title} —— ${s.description}`)
    .join('\n');
  const sys = `你是锦囊笔记的能力路由。下面是可用能力清单：\n${catalog}\n\n只回复一个能力 id（不要解释），若都不合适回复 ask。`;
  const pick = (await aiService.chat(text, sys)).trim().toLowerCase();
  return getSkill(pick) ? pick : 'ask';
}

export const SKILLS: Record<string, AISkill> = {
  ask: {
    id: 'ask',
    title: '知识库问答',
    description: '基于知识库检索 + 多轮上下文的问答；自动处理「今天/本周」等时间维度问题。',
    capability: ['long-context'],
    stateful: true,
    useTools: ['kb_search', 'kb_read_note', 'kb_list_notes'],
    run: async ({ kbId, input, history }) => {
      // 时间维度问题（如「帮我总结今天的笔记」）走专门路径：按 mtime 筛笔记 → 读正文 → 让模型总结。
      // 否则走标准 RAG 检索 + 多轮上下文。
      const ts = await runTimeSummary(kbId!, input.text, history);
      if (ts) return { ...txt(ts.text), refs: ts.refs };
      const { text, refs } = await aiService.askWithHistory(kbId, toChatHistory(history), input.text);
      return { ...txt(text), refs };
    }
  },

  agent: {
    id: 'agent',
    title: '智能体（主动工具调用）',
    description: '让模型在推理中自主检索/读写知识库，支持多轮工具循环（ReAct）。',
    capability: ['reasoning'],
    stateful: true,
    awaitConfirm: true,
    useTools: KB_TOOLS.map((t) => t.name),
    run: async ({ kbId, input, history, onActivity, pendingDraft }) => {
      // ===== 已确认：执行操作（不依赖模型重新生成 Patch，保证「所见即所改」）=====
      const approved = pendingDraft as ConfirmableAction | undefined;
      if (approved) {
        let execResult = '';
        try {
          const r = await actionService.execute(approved, { kbId });
          execResult = typeof r === 'string' ? r : JSON.stringify(r);
        } catch (e) {
          execResult = `执行失败：${String(e)}`;
        }
        const answer = await aiService.agentChat(
          kbId,
          AGENT_APPLIED_SYS,
          `已执行操作：${approved.title}\n执行结果：${execResult}`,
          { history: toChatHistory(history), onActivity, canWrite: true }
        );
        return txt(answer || execResult);
      }

      // ===== 首轮：只可预览，产出待确认建议 =====
      // notePath 由笔记侧栏对话（NoteAIChat）传入：聚焦当前笔记，让「这篇笔记」有明确指代
      const noteCtx = input.notePath ? `\n\n【当前聚焦笔记】${input.notePath}\n用户提到「这篇笔记/本文」时均指它；修改类操作默认针对它。` : '';
      // 本地记录工具调用轨迹，用于「模型耗尽轮次仍未输出 JSON」时的兜底
      const localActivity: { name: string; args: Record<string, unknown>; result: string }[] = [];
      const wrappedOnActivity = (a: ToolActivity) => {
        localActivity.push(a);
        onActivity?.(a);
      };
      const answer = await aiService.agentChat(kbId, AGENT_PLAN_SYS + noteCtx, input.text, {
        history: toChatHistory(history),
        onActivity: wrappedOnActivity,
        canWrite: false
      });
      // 模型按约定输出 JSON 建议 → 直接使用
      const action = extractConfirmableAction(answer);
      if (action) {
        // 填装 preview（diff 等），供渲染层渲染确认卡片
        try {
          const pv = await actionService.preview(action, { kbId });
          if (pv) (action as ConfirmableAction<unknown, unknown>).preview = pv;
        } catch {
          /* 预览失败不影响建议展示 */
        }
        return { kind: 'structured', data: action, pending: true };
      }
      // 兜底：模型耗尽轮次仍未输出 JSON，但已调用 kb_preview_patch → 自动构造建议
      const fallbackAction = buildFallbackNotePatchAction(localActivity, kbId);
      if (fallbackAction) return { kind: 'structured', data: fallbackAction, pending: true };
      return txt(answer);
    }
  },

  'quick-note': {
    id: 'quick-note',
    title: '快速笔记',
    description: '自动生成摘要、标签、双链、归属目录。',
    useTools: ['kb_suggest_dir', 'kb_search'],
    run: async ({ kbId, input }) => {
      const r = await aiService.quickNote(kbId!, input.text, input.dirId ? { dirId: input.dirId } : undefined);
      return structured(r);
    },
    localFallback: ({ input }) =>
      structured({ title: input.text.slice(0, 40), summary: input.text, tags: [] as string[], links: [] as string[], dirId: '' })
  },

  'suggest-dir': {
    id: 'suggest-dir',
    title: '归档推荐',
    description: '为某篇笔记推荐最合适的归属目录。',
    useTools: ['kb_suggest_dir'],
    run: async ({ kbId, input }) => {
      const list = await aiService.suggestDir(kbId!, input.text);
      return structured(list);
    }
  },

  'suggest-links': {
    id: 'suggest-links',
    title: '双链推荐',
    description: '推荐与某篇笔记应建立双向链接的笔记。',
    useTools: ['kb_link_graph', 'kb_search'],
    run: async ({ kbId, input }) => {
      const list = await aiService.suggestLinks(kbId!, input.text);
      return structured(list);
    }
  },

  'forge-card': {
    id: 'forge-card',
    title: '知识卡片锻造',
    description: '将笔记提炼为四铁律知识卡片。',
    run: async ({ kbId, input, agentId }) => {
      // 阶段 B：用 card-smith Agent 人格锻造（agentId 由 AIHub 解析为 card-smith）
      const card = await aiService.forgeCardWithAgent(kbId!, String(input.text ?? ''));
      return structured(card) as AIResponse & { refs?: AIRefHit[]; usage?: AIUsage };
    }
  },

  'summarize-tags': {
    id: 'summarize-tags',
    title: '摘要与标签',
    description: '生成纯文本摘要 + 标签。',
    run: async ({ kbId, input }) => {
      const [summary, tags] = await Promise.all([
        aiService.summarize(kbId!, String(input.text ?? '')),
        aiService.generateTags(kbId!, String(input.text ?? ''))
      ]);
      return structured({ summary, tags });
    }
  },

  diagnose: {
    id: 'diagnose',
    title: '知识库诊断',
    description: '诊断失效链接、空目录、重复标题等健康问题。',
    useTools: ['kb_diagnose'],
    run: async ({ kbId, agentId }) => {
      const report = await executeTool({ name: 'kb_diagnose', args: {} }, { kbId: kbId || '' });
      const reportText = typeof report === 'string' ? report : JSON.stringify(report, null, 2);
      // 阶段 B：用 diagnostician Agent 严谨解读（已内置"引用路径 / 量化 / 知识体系"人格 + 采样 0.2）
      if (kbId) {
        try {
          const tips = await aiService.runAgent({
            agentId: agentId || 'diagnostician',
            kbId,
            userMessage: `以下是一份结构化诊断报告，请基于你的诊断专家角色解读，并按严重度给出优先处理建议：\n\n${reportText.slice(0, 4000)}`
          });
          return txt(`${reportText}\n\n【围绕你的目标，建议优先处理】\n${tips}`);
        } catch {
          /* 忽略，回退原报告 */
        }
      }
      return txt(reportText);
    }
  },

  'daily-insight': {
    id: 'daily-insight',
    title: '每日灵感一现',
    description: '基于知识库生成今日灵感。',
    run: async ({ kbId, input, agentId }) => {
      const prompt = typeof input.text === 'string' ? input.text : '给我今天的灵光一现。';
      // 阶段 C：用 daily-muse Agent（禁母题 / 跨域 / 历史去重 / 高 temperature / 画像自然融入）
      const r = await aiService.runAgent({
        agentId: agentId || 'daily-muse',
        kbId,
        userMessage: prompt
      });
      return txt(r);
    }
  },
};

/** 按 id 取 Skill；未知 skill 由 AIHub 处理降级 */
export function getSkill(id: string): AISkill | undefined {
  return SKILLS[id];
}
