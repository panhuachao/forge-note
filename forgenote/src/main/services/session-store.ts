// 会话存储：承载多轮上下文（见 doc/AI调用重构技术方案.md §4.2）
// 当前为进程内内存实现；如需跨会话持久化，可后续落地到知识库 .forge/ai-sessions/
import { AISession, AITurn } from '@shared/types/ai';

class SessionStore {
  private sessions = new Map<string, AISession>();

  create(skill: string, kbId?: string): AISession {
    const now = Date.now();
    const id = `sess_${now}_${Math.random().toString(36).slice(2, 8)}`;
    const s: AISession = { id, skill, kbId, turns: [], createdAt: now, updatedAt: now };
    this.sessions.set(id, s);
    return s;
  }

  get(id: string): AISession | undefined {
    return this.sessions.get(id);
  }

  append(id: string, turn: AITurn): AISession | undefined {
    const s = this.sessions.get(id);
    if (!s) return undefined;
    s.turns.push(turn);
    s.updatedAt = Date.now();
    this.sessions.set(id, s);
    return s;
  }

  setDraft(id: string, draft: unknown): AISession | undefined {
    const s = this.sessions.get(id);
    if (!s) return undefined;
    s.draft = draft;
    s.updatedAt = Date.now();
    return s;
  }

  clearDraft(id: string): AISession | undefined {
    const s = this.sessions.get(id);
    if (!s) return undefined;
    s.draft = undefined;
    return s;
  }

  /** 截断过长的历史（按 token 估算，粗略按字符数） */
  trim(id: string, maxChars = 12000): void {
    const s = this.sessions.get(id);
    if (!s) return;
    let total = 0;
    const kept: AITurn[] = [];
    for (let i = s.turns.length - 1; i >= 0; i--) {
      const t = s.turns[i];
      const len = (t.text || '').length;
      if (total + len > maxChars && kept.length > 0) break;
      total += len;
      kept.unshift(t);
    }
    s.turns = kept;
  }

  dispose(id: string): void {
    this.sessions.delete(id);
  }
}

export const sessionStore = new SessionStore();
