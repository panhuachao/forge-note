// AIHub：统一 AI 调用入口（见 doc/AI调用重构技术方案.md）
// 阶段 0~1.5：作为防腐层，内部委托现有 aiService，新增会话上下文与 Skill 路由。
import { AIRequest, AIResponse, AISession, AITurn, Skill, AIServiceLike } from '@shared/types/ai';
import { ToolActivity } from './tool-runtime';
import { aiService } from './ai-service';
import { sessionStore } from './session-store';
import { fsService } from './fs-service';
import { auditService } from './audit-service';
import { getKB } from './store';

const aiLike: AIServiceLike = {
  askWithHistory: (kbId, history, q, opts) => aiService.askWithHistory(kbId, history, q, opts),
  getConfig: () => aiService.getConfig() as any,
  isReady: () => (aiService.getConfig() as any).provider !== 'none'
};

// 内置 Skill 注册表（迁移现有能力，新增能力只需在此声明）
const skills: Record<string, Skill> = {
  ask: {
    id: 'ask',
    title: '知识库问答',
    description: '基于知识库检索的多轮问答',
    stateful: true,
    run: async ({ input, kbId, session }) => {
      const q = String(input.question || '');
      const history = (session?.turns || [])
        .filter((t) => t.role === 'user' || t.role === 'assistant')
        .map((t) => ({ role: t.role as 'user' | 'assistant', text: t.text || '' }));
      const text = await aiLike.askWithHistory(kbId, history, q);
      return { kind: 'text', text };
    }
  },

  'quick-note': {
    id: 'quick-note',
    title: '快速笔记',
    description: 'AI 一次性产出标题/摘要/标签/双链/归属目录',
    run: async ({ input, kbId }) => {
      const data = await aiService.quickNote(kbId!, String(input.content || ''), input.dirId ? { dirId: String(input.dirId) } : undefined);
      return { kind: 'structured', data };
    }
  },

  'suggest-dir': {
    id: 'suggest-dir',
    title: '归档推荐',
    description: '推荐笔记归属目录',
    run: async ({ input, kbId }) => {
      const data = await aiService.suggestDir(kbId!, String(input.notePath || ''));
      return { kind: 'structured', data };
    }
  },

  'suggest-links': {
    id: 'suggest-links',
    title: '双向链接推荐',
    description: '推荐可建立双向链接的笔记',
    run: async ({ input, kbId }) => {
      const data = await aiService.suggestLinks(kbId!, String(input.notePath || ''));
      return { kind: 'structured', data };
    }
  },

  'forge-card': {
    id: 'forge-card',
    title: '知识卡片锻造',
    description: '按四铁律提炼标准知识卡片',
    run: async ({ input, kbId }) => {
      const data = await aiService.forgeCard(kbId!, String(input.notePath || ''));
      return { kind: 'structured', data };
    }
  },

  'summarize-tags': {
    id: 'summarize-tags',
    title: '摘要与标签',
    description: '生成摘要与标签',
    run: async ({ input, kbId }) => {
      const summary = await aiService.summarize(kbId!, String(input.notePath || ''));
      const tags = await aiService.generateTags(kbId!, String(input.notePath || ''));
      return { kind: 'structured', data: { summary, tags } };
    }
  },

  'daily-insight': {
    id: 'daily-insight',
    title: '每日灵感一现',
    description: '生成一条醍醐灌顶的认知',
    run: async ({ kbId }) => {
      const text = await aiService.ask(kbId || '', '【每天灵感一现】请结合知识库沉淀，给一条醍醐灌顶、可立即行动的认知。');
      return { kind: 'text', text };
    }
  },

  // 首个有状态 + 确认执行 Skill：展示方案 4.2.3「建议到确认到执行」闭环
  'kb-organize': {
    id: 'kb-organize',
    title: '知识库整理',
    description: '先给整理建议，用户确认后基于前文执行处理',
    stateful: true,
    awaitConfirm: true,
    run: async ({ input, kbId, session, confirm }) => {
      const q = String(input.question || '');
      if (!confirm) {
        // 首轮：产出建议草稿（仅展示，不执行）
        const history = (session?.turns || [])
          .filter((t) => t.role === 'user' || t.role === 'assistant')
          .map((t) => ({ role: t.role as 'user' | 'assistant', text: t.text || '' }));
        const advice = await aiLike.askWithHistory(kbId, history, `请针对知识库整理给出具体、可执行的建议（分条），不要执行任何写入。问题：${q}`);
        const draft = { advice };
        if (session) sessionStore.setDraft(session.id, draft);
        return { kind: 'structured', data: draft, pending: true };
      }
      // 确认轮：基于上一轮 draft 执行处理
      const draft = session?.draft as { advice?: string } | undefined;
      const history = (session?.turns || [])
        .filter((t) => t.role === 'user' || t.role === 'assistant')
        .map((t) => ({ role: t.role as 'user' | 'assistant', text: t.text || '' }));
      const plan = await aiLike.askWithHistory(kbId, history, `基于以下建议，请说明你要执行的具体动作（仅文本确认）：${draft?.advice || q}`);
      // 示范：把待整理笔记（input.notePaths）按 AI 建议重新归档
      const notePaths = Array.isArray(input.notePaths) ? (input.notePaths as string[]) : [];
      const moved: string[] = [];
      for (const p of notePaths) {
        const sug = await aiService.suggestDir(kbId!, p).catch(() => []);
        const top = sug[0];
        if (top && top.dirPath) {
          await fsService.moveNote(kbId!, p, top.dirPath, { autoCreateDir: true }).catch(() => undefined);
          auditService.record(kbId!, 'move', { notePath: p, to: top.dirPath, reason: top.reason, by: 'ai' });
          moved.push(p);
        }
      }
      if (session) sessionStore.clearDraft(session.id);
      const executed = moved.length ? moved.join('、') : '（无待整理笔记）';
      return { kind: 'text', text: plan + '\n\n已执行：' + executed };
    }
  },

  // 智能体：AI 主动调用知识库 MCP 工具（检索/读/写/诊断），见 doc §6
  agent: {
    id: 'agent',
    title: '智能体（可调知识库工具）',
    description: '模型在推理中主动调用 kb_search/kb_read_note/kb_write_note 等工具操作知识库',
    stateful: true,
    run: async ({ input, kbId, session }) => {
      const q = String(input.question || input.text || '');
      const sys = `你是知识库智能体，服务于「锦囊笔记」这款本地优先的 Markdown 知识库软件。\n你可以调用工具来检索、阅读、写入、诊断知识库。\n规则：\n- 写操作（kb_write_note）前，先用 kb_search/kb_read_note 确认真实情况，避免覆盖用户已有内容；\n- 引用具体笔记用 [[笔记名]]；\n- 完成后用中文总结你做了什么。`;
      const history = (session?.turns || [])
        .filter((t) => t.role === 'user' || t.role === 'assistant')
        .map((t) => ({ role: t.role as 'user' | 'assistant', text: t.text || '' }));
      const activities: ToolActivity[] = [];
      const text = await aiService.agentChat(kbId, sys, q, {
        history,
        onActivity: (a) => {
          activities.push(a);
          if (session) sessionStore.append(session.id, { role: 'tool', text: `🔧 ${a.name}: ${a.result.slice(0, 200)}`, skill: 'agent', ts: Date.now() });
        }
      });
      return { kind: 'tool', steps: activities, text } as any;
    }
  }
};

class AIHub {
  /** 执行一个 Skill 调用 */
  async run(req: AIRequest): Promise<AIResponse> {
    const skill = skills[req.skill];
    if (!skill) throw new Error('未知 Skill: ' + req.skill);
    // 会话装配
    let session: AISession | undefined;
    if (req.sessionId) {
      session = sessionStore.get(req.sessionId);
    } else if (skill.stateful) {
      session = sessionStore.create(skill.id, req.kbId);
    }
    // 先记录用户轮次
    if (session && req.input.text !== undefined && !req.confirm) {
      sessionStore.append(session.id, { role: 'user', text: String(req.input.text || req.input.question || ''), skill: skill.id, ts: Date.now() });
    }
    const ctx = { input: req.input, kbId: req.kbId, session, confirm: req.confirm, ai: aiLike };
    const res = await skill.run(ctx);
    // 记录助手轮次
    if (session) {
      const text = res.kind === 'text' ? res.text : res.kind === 'structured' ? JSON.stringify(res.data) : '';
      sessionStore.append(session.id, { role: 'assistant', text, skill: skill.id, ts: Date.now() });
      sessionStore.trim(session.id);
    }
    // 把 sessionId 透传给渲染层（首轮新建时）
    (res as any).sessionId = session?.id;
    return res;
  }

  getSession(id: string): AISession | undefined {
    return sessionStore.get(id);
  }
}

export const aiHub = new AIHub();
export { skills as builtinSkills };
