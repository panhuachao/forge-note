// SQLite 配置存储（better-sqlite3）
import Database from 'better-sqlite3';
import { app } from 'electron';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import type { KnowledgeBase, AIConfigPreset, AuditEntry } from '@shared/types';

let db: Database.Database | null = null;

function getDbPath(): string {
  const dir = join(app.getPath('userData'), 'forgenote');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, 'config.db');
}

export function initStore(): void {
  if (db) return;
  db = new Database(getDbPath());
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS kbs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      root_path TEXT NOT NULL,
      template_id TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ai_presets (
      kb_id TEXT NOT NULL,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (kb_id, name)
    );
    CREATE TABLE IF NOT EXISTS audit (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      kb_id TEXT,
      action TEXT NOT NULL,
      payload TEXT NOT NULL,
      undone INTEGER NOT NULL DEFAULT 0
    );
    -- RAG 分块索引持久化（S1：替代纯内存索引，重启不丢、增量维护）
    -- summary / tags 为从笔记 FrontMatter 派生的检索副本，
    -- 笔记变动时由 syncIndex 重新提取写入（SQLite 永远以文件为真源）。
    CREATE TABLE IF NOT EXISTS note_meta (
      kb_id TEXT NOT NULL,
      note_path TEXT NOT NULL,
      mtime INTEGER NOT NULL,
      size INTEGER NOT NULL,
      template_dir_id TEXT,
      hash TEXT,
      summary TEXT,
      tags TEXT,
      PRIMARY KEY (kb_id, note_path)
    );
    CREATE TABLE IF NOT EXISTS note_chunks (
      kb_id TEXT NOT NULL,
      note_path TEXT NOT NULL,
      chunk_idx INTEGER NOT NULL,
      chunk_text TEXT NOT NULL,
      heading TEXT,
      start_line INTEGER,
      end_line INTEGER,
      PRIMARY KEY (kb_id, note_path, chunk_idx)
    );
  `);

  // 旧库补充列（新库 CREATE 已含），列已存在则忽略
  try {
    db.exec('ALTER TABLE note_meta ADD COLUMN hash TEXT');
  } catch {
    /* 列已存在 */
  }
  try {
    db.exec('ALTER TABLE note_meta ADD COLUMN summary TEXT');
  } catch {
    /* 列已存在 */
  }
  try {
    db.exec('ALTER TABLE note_meta ADD COLUMN tags TEXT');
  } catch {
    /* 列已存在 */
  }

  // 显式索引：时间窗口查询按 mtime 收敛、分块按 (kb_id, note_path, chunk_idx) 有序加载，
  // 避免 recentChunks / listRecentPaths / loadChunks 全表扫描
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_note_meta_mtime ON note_meta(kb_id, mtime);
    CREATE INDEX IF NOT EXISTS idx_note_chunks_kb_path ON note_chunks(kb_id, note_path, chunk_idx);
    CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit(kb_id, ts);
  `);

  // schema 版本占位（当前 1），后续迁移以 PRAGMA user_version 比对增量执行
  db.pragma('user_version = 1');
}

/** 优雅关闭：落盘 WAL、释放连接（在 app before-quit 调用，避免 WAL 残留未合并） */
export function closeStore(): void {
  if (!db) return;
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    /* ignore */
  }
  db.close();
  db = null;
}

// ============ RAG 分块索引（SQLite 持久化） ============
export interface ChunkRow {
  chunk_idx: number;
  chunk_text: string;
  heading: string | null;
  start_line: number | null;
  end_line: number | null;
}
export interface NoteMetaRow {
  mtime: number;
  size: number;
  template_dir_id: string | null;
  hash: string | null;
  /** 从笔记 FrontMatter 派生的摘要检索副本（文件为真源） */
  summary: string | null;
  /** 从笔记 FrontMatter 派生的标签检索副本（JSON 数组字符串，文件为真源） */
  tags: string | null;
}

export function upsertNoteMeta(
  kbId: string,
  notePath: string,
  mtime: number,
  size: number,
  templateDirId?: string,
  hash?: string,
  summary?: string,
  tags?: string[]
): void {
  getDb()
    .prepare(
      'INSERT OR REPLACE INTO note_meta (kb_id, note_path, mtime, size, template_dir_id, hash, summary, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      kbId,
      notePath,
      mtime,
      size,
      templateDirId ?? null,
      hash ?? null,
      summary ?? null,
      tags && tags.length ? JSON.stringify(tags) : null
    );
}

export function removeNoteMeta(kbId: string, notePath: string): void {
  getDb().prepare('DELETE FROM note_meta WHERE kb_id = ? AND note_path = ?').run(kbId, notePath);
}

/** 清空某知识库的全部 note_meta 行（仅索引重建工具使用，前端走 IPC） */
export function clearNoteMeta(kbId: string): void {
  getDb().prepare('DELETE FROM note_meta WHERE kb_id = ?').run(kbId);
}

/** 清空某知识库的全部 note_chunks 行（同上，仅供索引重建使用） */
export function clearChunks(kbId: string): void {
  getDb().prepare('DELETE FROM note_chunks WHERE kb_id = ?').run(kbId);
}

export function getNoteMeta(kbId: string, notePath: string): NoteMetaRow | null {
  const row = getDb()
    .prepare('SELECT mtime, size, template_dir_id, hash, summary, tags FROM note_meta WHERE kb_id = ? AND note_path = ?')
    .get(kbId, notePath) as NoteMetaRow | undefined;
  return row || null;
}

/** 全量加载某知识库的分块（冷启动重建内存索引用） */
export function loadChunks(kbId: string): { notePath: string; chunk: ChunkRow }[] {
  const rows = getDb()
    .prepare('SELECT note_path, chunk_idx, chunk_text, heading, start_line, end_line FROM note_chunks WHERE kb_id = ? ORDER BY note_path, chunk_idx')
    .all(kbId) as { note_path: string; chunk_idx: number; chunk_text: string; heading: string | null; start_line: number | null; end_line: number | null }[];
  return rows.map((r) => ({ notePath: r.note_path, chunk: { chunk_idx: r.chunk_idx, chunk_text: r.chunk_text, heading: r.heading, start_line: r.start_line, end_line: r.end_line } }));
}

export function loadAllMeta(kbId: string): Map<string, NoteMetaRow> {
  const rows = getDb()
    .prepare('SELECT note_path, mtime, size, template_dir_id, hash, summary, tags FROM note_meta WHERE kb_id = ?')
    .all(kbId) as { note_path: string; mtime: number; size: number; template_dir_id: string | null; hash: string | null; summary: string | null; tags: string | null }[];
  const m = new Map<string, NoteMetaRow>();
  for (const r of rows)
    m.set(r.note_path, {
      mtime: r.mtime,
      size: r.size,
      template_dir_id: r.template_dir_id,
      hash: r.hash,
      summary: r.summary,
      tags: r.tags
    });
  return m;
}

/** 增量更新某笔记的分块（先删后插，与内存索引同事务语义） */
export function upsertChunks(kbId: string, notePath: string, chunks: ChunkRow[]): void {
  const db = getDb();
  const del = db.prepare('DELETE FROM note_chunks WHERE kb_id = ? AND note_path = ?');
  const ins = db.prepare('INSERT OR REPLACE INTO note_chunks (kb_id, note_path, chunk_idx, chunk_text, heading, start_line, end_line) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const tx = db.transaction(() => {
    del.run(kbId, notePath);
    for (const c of chunks) ins.run(kbId, notePath, c.chunk_idx, c.chunk_text, c.heading ?? null, c.start_line ?? null, c.end_line ?? null);
  });
  tx();
}

export function removeChunks(kbId: string, notePath: string): void {
  getDb().prepare('DELETE FROM note_chunks WHERE kb_id = ? AND note_path = ?').run(kbId, notePath);
}

function getDb(): Database.Database {
  if (!db) throw new Error('Store not initialized');
  return db;
}

// ============ 知识库 ============
export function listKBs(): KnowledgeBase[] {
  const rows = getDb()
    .prepare('SELECT id, name, root_path as rootPath, template_id as templateId, created_at as createdAt FROM kbs ORDER BY created_at DESC')
    .all() as KnowledgeBase[];
  return rows;
}

export function addKB(kb: KnowledgeBase): void {
  getDb()
    .prepare('INSERT OR REPLACE INTO kbs (id, name, root_path, template_id, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(kb.id, kb.name, kb.rootPath, kb.templateId ?? null, kb.createdAt);
}

export function removeKB(id: string): void {
  getDb().prepare('DELETE FROM kbs WHERE id = ?').run(id);
}

export function getKB(id: string): KnowledgeBase | null {
  const row = getDb()
    .prepare('SELECT id, name, root_path as rootPath, template_id as templateId, created_at as createdAt FROM kbs WHERE id = ?')
    .get(id) as KnowledgeBase | undefined;
  return row || null;
}

export function updateKBTemplate(id: string, templateId: string | null): void {
  getDb().prepare('UPDATE kbs SET template_id = ? WHERE id = ?').run(templateId, id);
}

// ============ App Config (key-value) ============
export function getConfig<T = unknown>(key: string, def?: T): T | undefined {
  const row = getDb().prepare('SELECT value FROM app_config WHERE key = ?').get(key) as { value: string } | undefined;
  if (!row) return def;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return def;
  }
}

export function setConfig(key: string, value: unknown): void {
  getDb()
    .prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)')
    .run(key, JSON.stringify(value));
}

// ============ AI 预设 ============
export function getAIPresets(kbId: string): AIConfigPreset[] {
  const rows = getDb()
    .prepare('SELECT name, content, active FROM ai_presets WHERE kb_id = ?')
    .all(kbId) as { name: string; content: string; active: number }[];
  return rows.map((r) => ({ name: r.name, content: r.content, active: !!r.active }));
}

export function saveAIPreset(kbId: string, preset: AIConfigPreset): void {
  const cur = getDb().prepare('SELECT 1 FROM ai_presets WHERE kb_id = ? AND name = ?').get(kbId, preset.name);
  if (cur) {
    getDb()
      .prepare('UPDATE ai_presets SET content = ?, active = ? WHERE kb_id = ? AND name = ?')
      .run(preset.content, preset.active ? 1 : 0, kbId, preset.name);
  } else {
    getDb()
      .prepare('INSERT INTO ai_presets (kb_id, name, content, active) VALUES (?, ?, ?, ?)')
      .run(kbId, preset.name, preset.content, preset.active ? 1 : 0);
  }
}

export function setActiveAIPreset(kbId: string, name: string): void {
  getDb().prepare('UPDATE ai_presets SET active = 0 WHERE kb_id = ?').run(kbId);
  getDb().prepare('UPDATE ai_presets SET active = 1 WHERE kb_id = ? AND name = ?').run(kbId, name);
}

// ============ 审计日志 ============
export function addAudit(entry: AuditEntry, kbId?: string): void {
  getDb()
    .prepare('INSERT INTO audit (id, ts, kb_id, action, payload, undone) VALUES (?, ?, ?, ?, ?, ?)')
    .run(entry.id, entry.ts, kbId ?? null, entry.action, JSON.stringify(entry.payload), entry.undone ? 1 : 0);
}

export function listAudit(kbId: string, limit = 200): AuditEntry[] {
  const rows = getDb()
    .prepare('SELECT id, ts, action, payload, undone FROM audit WHERE kb_id = ? ORDER BY ts DESC LIMIT ?')
    .all(kbId, limit) as { id: string; ts: number; action: string; payload: string; undone: number }[];
  return rows.map((r) => ({
    id: r.id,
    ts: r.ts,
    action: r.action as AuditEntry['action'],
    payload: JSON.parse(r.payload),
    undone: !!r.undone
  }));
}

export function markAuditUndone(id: string): void {
  getDb().prepare('UPDATE audit SET undone = 1 WHERE id = ?').run(id);
}
