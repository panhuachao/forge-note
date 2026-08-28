// 会话存储：承载多轮上下文（见 doc/AI调用重构技术方案.md §4.2）
//
// 持久化（doc/AI智能管家重构方案.md §5.3 P1-1）：
// - 落盘位置沿用项目惯例：<kbRoot>/.forge/ai-sessions/<sessionId>.json（与 user-profile.json 同级）
// - 内存 Map 始终为准，写盘为**异步防抖**，不阻塞任何 AI 响应路径
// - 进程重启后按 sessionId 惰性加载，实现「重启不丢上下文」
// - 未绑定知识库（kbId 为空）的会话只存在于内存，不写盘
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getKB } from './store';
import { AISession, AITurn } from '@shared/types/ai';

const SESSIONS_DIR = path.join('.forge', 'ai-sessions');
/** 单个知识库最多保留的会话数（超出按更新时间 LRU 淘汰） */
const MAX_SESSIONS_PER_KB = 50;
/** 会话文件过期时间：30 天 */
const MAX_AGE_MS = 30 * 24 * 3600_000;
/** 写盘防抖间隔 */
const FLUSH_DELAY_MS = 800;

class SessionStore {
  private sessions = new Map<string, AISession>();
  private dirty = new Set<string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  /* ==================== 持久化基础设施 ==================== */

  private dirOf(kbId?: string): string | null {
    if (!kbId) return null;
    try {
      const kb = getKB(kbId);
      return kb ? path.join(kb.rootPath, SESSIONS_DIR) : null;
    } catch {
      return null;
    }
  }

  private fileOf(id: string, kbId?: string): string | null {
    const dir = this.dirOf(kbId);
    return dir ? path.join(dir, `${id}.json`) : null;
  }

  /** 标记会话为脏并安排防抖写盘 */
  private markDirty(id: string, kbId?: string): void {
    if (!kbId) return; // 无知识库上下文的会话不持久化
    this.dirty.add(id);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => void this.flush(), FLUSH_DELAY_MS);
  }

  /** 批量落盘；失败仅告警，绝不影响内存中的会话 */
  private async flush(): Promise<void> {
    this.flushTimer = null;
    const ids = Array.from(this.dirty);
    this.dirty.clear();
    for (const id of ids) {
      const s = this.sessions.get(id);
      if (!s) continue;
      const file = this.fileOf(id, s.kbId);
      if (!file) continue;
      try {
        await fs.promises.mkdir(path.dirname(file), { recursive: true });
        await fs.promises.writeFile(file, JSON.stringify(s), 'utf-8');
      } catch {
        /* 写盘失败不影响会话本身 */
      }
    }
  }

  /** 淘汰过期 / 超量的会话文件 */
  private prune(kbId?: string): void {
    const dir = this.dirOf(kbId);
    if (!dir || !fs.existsSync(dir)) return;
    try {
      const entries = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => {
          const p = path.join(dir, f);
          try {
            return { p, mtime: fs.statSync(p).mtimeMs };
          } catch {
            return null;
          }
        })
        .filter((x): x is { p: string; mtime: number } => !!x)
        .sort((a, b) => b.mtime - a.mtime);
      const now = Date.now();
      // 超出上限的直接删除
      for (const e of entries.slice(MAX_SESSIONS_PER_KB)) void fs.promises.unlink(e.p).catch(() => {});
      // 上限内但已过期的也删除
      for (const e of entries.slice(0, MAX_SESSIONS_PER_KB)) {
        if (now - e.mtime > MAX_AGE_MS) void fs.promises.unlink(e.p).catch(() => {});
      }
    } catch {
      /* 清理失败忽略 */
    }
  }

  /* ==================== 对外 API（保持同步签名） ==================== */

  create(skill: string, kbId?: string, seed?: AITurn[]): AISession {
    const now = Date.now();
    const id = `sess_${now}_${Math.random().toString(36).slice(2, 8)}`;
    const s: AISession = { id, skill, kbId, turns: seed ? seed.map((t) => ({ ...t })) : [], createdAt: now, updatedAt: now };
    this.sessions.set(id, s);
    this.markDirty(id, kbId);
    this.prune(kbId);
    return s;
  }

  /**
   * 取会话。内存未命中时按 kbId 从磁盘惰性恢复（进程重启后续接上下文）。
   * kbId 缺省时只查内存。
   */
  get(id: string, kbId?: string): AISession | undefined {
    const hit = this.sessions.get(id);
    if (hit) return hit;
    const file = this.fileOf(id, kbId);
    if (!file || !fs.existsSync(file)) return undefined;
    try {
      const s = JSON.parse(fs.readFileSync(file, 'utf-8')) as AISession;
      if (!s?.id || !Array.isArray(s.turns)) return undefined;
      this.sessions.set(id, s);
      return s;
    } catch {
      return undefined;
    }
  }

  append(id: string, turn: AITurn): AISession | undefined {
    const s = this.sessions.get(id);
    if (!s) return undefined;
    s.turns.push(turn);
    s.updatedAt = Date.now();
    this.sessions.set(id, s);
    this.markDirty(id, s.kbId);
    return s;
  }

  setDraft(id: string, draft: unknown): AISession | undefined {
    const s = this.sessions.get(id);
    if (!s) return undefined;
    s.draft = draft;
    s.updatedAt = Date.now();
    this.markDirty(id, s.kbId);
    return s;
  }

  clearDraft(id: string): AISession | undefined {
    const s = this.sessions.get(id);
    if (!s) return undefined;
    s.draft = undefined;
    this.markDirty(id, s.kbId);
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
    this.markDirty(id, s.kbId);
  }

  /** 销毁会话：同时清理内存与磁盘文件 */
  dispose(id: string): void {
    const s = this.sessions.get(id);
    this.sessions.delete(id);
    this.dirty.delete(id);
    const file = this.fileOf(id, s?.kbId);
    if (file) void fs.promises.unlink(file).catch(() => {});
  }

  /** 列出某知识库的历史会话（按更新时间倒序），供"继续上次对话"使用 */
  listByKB(kbId: string, limit = 20): AISession[] {
    const dir = this.dirOf(kbId);
    if (!dir || !fs.existsSync(dir)) return [];
    try {
      return fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => {
          try {
            return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as AISession;
          } catch {
            return null;
          }
        })
        .filter((s): s is AISession => !!s?.id)
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
        .slice(0, limit);
    } catch {
      return [];
    }
  }

  /** 进程退出前调用：立即落盘所有脏会话 */
  async flushAll(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }
}

export const sessionStore = new SessionStore();
