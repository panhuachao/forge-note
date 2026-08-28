// 统一 AI 调用入口（方案 §4 · 防腐层 + 会话上下文 + Skill 路由）
// 渲染层 / IPC 一律只调 aiHub.run(req)，由它：按 skill 路由 → 挂载多轮 SessionStore → 调用 Skill。
// 流式场景调用 aiHub.runStream(req, onToken)（方案 §三.1）。旧 window.forge.ai.* 业务方法保留兼容。
import { getSkill, SKILLS, runTimeSummary, routeSkill, compressHistory, type AISkillCtx } from './skill-engine';
import { sessionStore } from './session-store';
import { aiService } from './ai-service';
import { profileService } from './profile-service';
import type { AIRequest, AIResponse, AITurn, AIRefHit, AIUsage, ToolActivity } from '@shared/types/ai';

/** 从统一 AIResponse 取出纯文本（用于会话落盘） */
function textOf(r: AIResponse): string {
  if (r.kind === 'text' || r.kind === 'stream') return r.text;
  if (r.kind === 'structured') return typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
  return '';
}

/** 运行结果（携带会话/引用/用量，方案 §三.2 / §三.3） */
export type AIHubResult = AIResponse & { sessionId?: string; refs?: AIRefHit[]; usage?: AIUsage };

class AIHub {
  /** 统一入口（非流式） */
  async run(req: AIRequest): Promise<AIHubResult> {
    const skill = getSkill(req.skill);
    if (!skill) return { kind: 'text', text: `未支持的技能: ${req.skill}` };

    const input: AISkillCtx['input'] = {
      text: String(req.input?.text ?? req.input?.question ?? ''),
      question: req.input?.question ? String(req.input.question) : undefined,
      dirId: req.input?.dirId ? String(req.input.dirId) : undefined
    };

    const { sessionId, history } = this.resolveSession(skill, req);
    if (sessionId && input.text) sessionStore.append(sessionId, { role: 'user', text: input.text, ts: Date.now() });

    const ctx: AISkillCtx = {
      kbId: req.kbId,
      input,
      history,
      pendingDraft: req.confirm ? req.draft : undefined,
      onActivity: req.onActivity
    };

    const t0 = Date.now();
    let resp: AIHubResult;
    try {
      const r = await skill.run(ctx);
      resp = { ...r, sessionId };
    } catch (e) {
      if (skill.localFallback) {
        const r = await skill.localFallback(ctx);
        resp = { ...r, sessionId };
      } else {
        resp = { kind: 'text', text: `AI 调用失败: ${String(e)}`, sessionId };
      }
    }
    this.afterRun(skill, sessionId, resp, t0);
    this.scheduleProfileExtract(req, skill, resp, sessionId);
    return resp;
  }

  /**
   * 流式入口（方案 §三.1）。逐 token 调用 onToken(delta)。
   * - ask 技能：正文逐 token 流式，首片携带 refs，末片携带 usage。
   * - 其余技能：一次性 run 后把整段作为单 token 推送（同样记录用量）。
   * 返回最终完整结果（含 sessionId/refs/usage）。
   */
  async runStream(
    req: AIRequest,
    onToken: (delta: string) => void,
    onActivity?: (a: ToolActivity) => void
  ): Promise<AIHubResult> {
    // 模型自路由：skill === 'auto' 时由模型从已注册能力中挑选最合适的一项（#1）
    const skillId = req.skill === 'auto' ? await routeSkill(String(req.input?.text ?? req.input?.question ?? '')) : req.skill;
    const skill = getSkill(skillId);
    if (!skill) {
      onToken(`未支持的技能: ${skillId}`);
      return { kind: 'text', text: `未支持的技能: ${skillId}` };
    }

    const input: AISkillCtx['input'] = {
      text: String(req.input?.text ?? req.input?.question ?? ''),
      question: req.input?.question ? String(req.input.question) : undefined,
      dirId: req.input?.dirId ? String(req.input.dirId) : undefined
    };
    const { sessionId, history } = this.resolveSession(skill, req);
    if (sessionId && input.text) sessionStore.append(sessionId, { role: 'user', text: input.text, ts: Date.now() });

    const t0 = Date.now();
    let full = '';
    let refs: AIRefHit[] | undefined;
    let usage: AIUsage | undefined;

    if (skill.id === 'ask' && skill.stateful) {
      // 时间维度问题（「今天/本周/最近 N 天」）先走专门路径；命中则基于 mtime 筛出的笔记正文总结。
      const ts = await runTimeSummary(req.kbId ?? '', String(input.text ?? ''), history, onToken, onActivity);
      if (ts) {
        full = ts.text;
        refs = ts.refs;
        usage = ts.usage;
      } else {
        // 流式问答
        for await (const chunk of aiService.askStream(req.kbId, this.toChatHistory(history), String(input.text ?? ''))) {
          if (chunk.refs) refs = chunk.refs;
          if (chunk.usage) usage = { ...chunk.usage, ms: Date.now() - t0 };
          if (chunk.delta) {
            full += chunk.delta;
            onToken(chunk.delta);
          }
        }
      }
    } else {
      // 非流式技能：一次性执行后推送整段
      const ctx: AISkillCtx = { kbId: req.kbId, input, history, pendingDraft: req.confirm ? req.draft : undefined, onActivity: req.onActivity ?? onActivity };
      let r: AIResponse & { refs?: AIRefHit[]; usage?: AIUsage };
      try {
        r = await skill.run(ctx);
      } catch (e) {
        r = skill.localFallback ? await skill.localFallback(ctx) : { kind: 'text', text: `AI 调用失败: ${String(e)}` };
      }
      full = textOf(r);
      refs = r.refs;
      usage = r.usage;
      onToken(full);
    }

    const resp: AIHubResult = { kind: 'text', text: full, sessionId, refs, usage };
    this.afterRun(skill, sessionId, resp, t0);
    this.scheduleProfileExtract(req, skill, resp, sessionId);
    return resp;
  }

  /** 解析/创建会话（stateful 才有多轮上下文） */
  private resolveSession(skill: ReturnType<typeof getSkill>, req: AIRequest): { sessionId?: string; history: AITurn[] } {
    if (!skill?.stateful) return { history: req.history ?? [] };
    let sessionId = req.sessionId;
    let history: AITurn[] = req.history ?? [];
    if (sessionId) {
      const s = sessionStore.get(sessionId);
      if (s) history = s.turns;
    } else {
      const seed = (req.history ?? []).map((t) => ({ ...t }));
      sessionId = sessionStore.create(skill.id, req.kbId, seed) as unknown as string;
    }
    return { sessionId, history };
  }

  private toChatHistory(turns: AITurn[]): { role: 'user' | 'assistant'; text: string }[] {
    const pairs = turns
      .filter((t) => (t.role === 'user' || t.role === 'assistant') && t.text)
      .map((t) => ({ role: t.role as 'user' | 'assistant', text: t.text! }));
    // #5 历史压缩：与 skill-engine 一致，超长历史只保留最近 8 轮原文
    return compressHistory(pairs, 8);
  }

  /** 落盘助手回合 + 记录 token 用量（成本可观测，方案 §三.3） */
  private afterRun(skill: ReturnType<typeof getSkill>, sessionId: string | undefined, resp: AIHubResult, t0: number): void {
    if (skill?.stateful && sessionId) {
      sessionStore.append(sessionId, { role: 'assistant', text: textOf(resp), ts: Date.now() });
    }
    const u = resp.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0, ms: Date.now() - t0 };
    void aiService.recordUsage(skill?.id ?? 'unknown', { promptTokens: u.promptTokens, completionTokens: u.completionTokens, ms: u.ms });
  }

  /**
   * 阶段 B：交互后异步抽取用户画像增量（fire-and-forget，绝不阻塞/影响主响应）。
   * 仅对文本交互类 Skill（ask / diagnose 等）触发；未配置 AI 时静默跳过。
   */
  private scheduleProfileExtract(req: AIRequest, skill: ReturnType<typeof getSkill>, resp: AIHubResult, _sessionId?: string): void {
    const id = skill?.id;
    if (id !== 'ask' && id !== 'diagnose') return; // 仅对问答/诊断这类文本交互抽取
    if (!req.kbId) return;
    const userText = String(req.input?.text ?? req.input?.question ?? '');
    const assistantText = textOf(resp);
    if (!userText.trim() && !assistantText.trim()) return;
    // 异步执行，吞掉所有错误
    void (async () => {
      try {
        const current = await profileService.getProfile(req.kbId!);
        const result = await aiService.extractProfile(req.kbId!, userText, assistantText, current);
        if (result.updates.length === 0) return;
        await profileService.mergeExtract(req.kbId!, result, id);
      } catch {
        /* 画像抽取失败不影响主流程 */
      }
    })();
  }

  /** 列出所有已注册 Skill（供设置/调试查看可扩展能力） */
  listSkills() {
    return Object.values(SKILLS).map((s) => ({ id: s.id, title: s.title, description: s.description, stateful: !!s.stateful, awaitConfirm: !!s.awaitConfirm, useTools: s.useTools ?? [] }));
  }
}

export const aiHub = new AIHub();
