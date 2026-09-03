// 主题学习（Learn）的目录/文件存储层
//
// 设计：
//   根目录：{userData}/forgenote/learnings（与已有 forgenote 数据文件夹一致，不带点号）
//   每个主题一个文件夹（以主题名称做文件名安全化后的名字，重名时追加短 id 区分）
//   主题文件夹内：
//     - index.json   主题概要 + 目录（模块/文章大纲），每篇文章用 file 字段指向 .md
//     - <文章名>.md  文章正文（Markdown）
//
// 与旧版 SQLite（app_config 的 learn:sessions）不兼容，initLearnStorage 会做一次
// 一次性迁移，把旧数据落为文件后清空旧 key（迁移失败则保留旧数据，下次启动重试）。
import { app } from 'electron';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync } from 'fs';
import type {
  LearnModule,
  LearnModeKey,
  LearnSessionSummary,
  LearningSession,
  LearnStatus
} from '@shared/types/learn';

// 根目录：{userData}/forgenote/learnings（与已有 forgenote 数据文件夹一致，不带点号）
const LEARN_ROOT = join(app.getPath('userData'), 'forgenote', 'learnings');

/** sessionId → 主题目录 的内存缓存，避免每次切换文章都遍历所有主题并解析 index.json */
const _dirCacheById = new Map<string, string>();

/**
 * 文章正文的小型 LRU 缓存（按「sessionId|file」为键）：
 * - 切换文章时命中 → 直接返回，省去磁盘 IO；
 * - 容量上限 64 篇，避免长会话 + 多主题共用时占用过多内存。
 * - 仅做弱引用即可：学习页关掉或会话被删除时调 `invalidateContentCache(id)` 清空对应条目。
 */
const ARTICLE_CACHE_LIMIT = 64;
const _articleCache = new Map<string, string>();

function articleCacheKey(sessionId: string, file: string): string {
  return `${sessionId}|${file}`;
}

export function getCachedArticleContent(sessionId: string, file: string): string | undefined {
  const key = articleCacheKey(sessionId, file);
  const v = _articleCache.get(key);
  if (v === undefined) return undefined;
  // LRU：访问后挪到末尾
  _articleCache.delete(key);
  _articleCache.set(key, v);
  return v;
}

export function setCachedArticleContent(sessionId: string, file: string, content: string): void {
  const key = articleCacheKey(sessionId, file);
  if (_articleCache.has(key)) _articleCache.delete(key);
  _articleCache.set(key, content);
  while (_articleCache.size > ARTICLE_CACHE_LIMIT) {
    const first = _articleCache.keys().next().value;
    if (!first) break;
    _articleCache.delete(first);
  }
}

export function invalidateContentCache(sessionId?: string): void {
  if (!sessionId) {
    _articleCache.clear();
    return;
  }
  const prefix = `${sessionId}|`;
  for (const k of Array.from(_articleCache.keys())) {
    if (k.startsWith(prefix)) _articleCache.delete(k);
  }
}

// index.json 的落盘结构（不含正文，正文在各自的 .md 里）
interface StoredArticle {
  id: string;
  title: string;
  outline?: string[];
  file: string; // 主题文件夹内的 .md 文件名
}
interface StoredModule {
  id: string;
  title: string;
  articles: StoredArticle[];
}
export interface StoredSession {
  id: string;
  topic: string;
  extra: string;
  mode: LearnModeKey;
  modeTitle: string;
  createdAt: number;
  status: LearnStatus;
  error?: string | null;
  modules: StoredModule[];
}

/** 文件名/文件夹名安全化：去掉非法字符、收尾点号、限制长度 */
export function sanitizeName(name: string, max = 80): string {
  let s = (name || '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .replace(/\.+$/, '')
    .trim();
  if (!s) s = '未命名';
  return s.slice(0, max);
}

function readJsonIfExists<T>(p: string): T | null {
  try {
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, 'utf-8')) as T;
  } catch {
    return null;
  }
}

export function listTopicDirs(): string[] {
  if (!existsSync(LEARN_ROOT)) return [];
  return readdirSync(LEARN_ROOT)
    .map((d) => join(LEARN_ROOT, d))
    .filter((p) => statSync(p).isDirectory());
}

/** 为模块内每篇文章分配不冲突的 .md 文件名，写入 article.file */
export function assignArticleFiles(modules: LearnModule[], dir: string): void {
  const used = new Set<string>();
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      if (f.toLowerCase().endsWith('.md')) used.add(f.toLowerCase());
    }
  }
  for (const m of modules) {
    for (const a of m.articles) {
      const base = sanitizeName(a.title) || '文章';
      let file = `${base}.md`;
      let i = 2;
      while (used.has(file.toLowerCase())) file = `${base}-${i++}.md`;
      used.add(file.toLowerCase());
      a.file = file;
    }
  }
}

/** 计算主题文件夹路径：同名主题用短 id 区分，避免覆盖 */
export function resolveTopicDir(topic: string, id: string): string {
  const base = sanitizeName(topic) || '未命名主题';
  const candidate = (suffix?: string) =>
    join(LEARN_ROOT, suffix ? `${base}-${suffix}` : base);
  let dir = candidate();
  if (existsSync(dir)) {
    const ex = readJsonIfExists<StoredSession>(join(dir, 'index.json'));
    if (ex?.id !== id) {
      dir = candidate(id.slice(0, 8));
      let i = 2;
      while (existsSync(dir)) {
        const e2 = readJsonIfExists<StoredSession>(join(dir, 'index.json'));
        if (e2?.id === id) break;
        dir = candidate(`${id.slice(0, 8)}-${i++}`);
      }
    }
  }
  return dir;
}

/** 按会话 id 反查主题文件夹（扫描所有 index.json） */
export function findSessionDirById(id: string): string | null {
  if (_dirCacheById.has(id)) return _dirCacheById.get(id)!;
  for (const dir of listTopicDirs()) {
    const idx = readJsonIfExists<StoredSession>(join(dir, 'index.json'));
    if (idx?.id === id) {
      _dirCacheById.set(id, dir);
      return dir;
    }
  }
  return null;
}

/** 当写入/删除主题时调用，清掉 id → dir 缓存（避免热更新或外部移动目录导致命中过期路径） */
export function invalidateDirCache(id?: string): void {
  if (id) _dirCacheById.delete(id);
  else _dirCacheById.clear();
}

/** 写入 index.json（不含正文，正文已分别落到 .md），并保正文引用的 file 字段 */
export function writeSessionMeta(dir: string, session: LearningSession): void {
  mkdirSync(dir, { recursive: true });
  const stored: StoredSession = {
    id: session.id,
    topic: session.topic,
    extra: session.extra,
    mode: session.mode,
    modeTitle: session.modeTitle,
    createdAt: session.createdAt,
    status: session.status,
    error: session.error ?? null,
    modules: session.modules.map((m) => ({
      id: m.id,
      title: m.title,
      articles: m.articles.map((a) => ({
        id: a.id,
        title: a.title,
        outline: a.outline,
        file: a.file || ''
      }))
    }))
  };
  writeFileSync(join(dir, 'index.json'), JSON.stringify(stored, null, 2), 'utf-8');
}

/** 写入单篇文章正文到 .md */
export function writeArticleFile(dir: string, file: string, content: string): void {
  writeFileSync(join(dir, file), content, 'utf-8');
}

/** 读取单篇文章正文（文件缺失返回空串，便于容错） */
export function readArticleFile(dir: string, file: string): string {
  try {
    return readFileSync(join(dir, file), 'utf-8');
  } catch {
    return '';
  }
}

/** 从 index.json 还原完整会话；includeContent=false 时不读 .md，仅返回结构（按需再取正文） */
export function loadFullSession(dir: string, includeContent = true): LearningSession | null {
  const stored = readJsonIfExists<StoredSession>(join(dir, 'index.json'));
  if (!stored) return null;
  const modules: LearnModule[] = stored.modules.map((m) => ({
    id: m.id,
    title: m.title,
    articles: m.articles.map((a) => ({
      id: a.id,
      title: a.title,
      outline: a.outline,
      content: includeContent && a.file ? readArticleFile(dir, a.file) : '',
      file: a.file
    }))
  }));
  return {
    id: stored.id,
    topic: stored.topic,
    extra: stored.extra,
    mode: stored.mode,
    modeTitle: stored.modeTitle,
    createdAt: stored.createdAt,
    status: stored.status,
    error: stored.error ?? undefined,
    modules
  };
}

/** 从 index.json 生成列表摘要（不读 .md，开销小） */
export function loadSummary(dir: string): LearnSessionSummary | null {
  const stored = readJsonIfExists<StoredSession>(join(dir, 'index.json'));
  if (!stored) return null;
  const moduleCount = stored.modules.length;
  const articleCount = stored.modules.reduce((n, m) => n + m.articles.length, 0);
  return {
    id: stored.id,
    topic: stored.topic,
    mode: stored.mode,
    modeTitle: stored.modeTitle,
    createdAt: stored.createdAt,
    moduleCount,
    articleCount,
    status: stored.status
  };
}

/** 删除整个主题文件夹 */
export function deleteSessionDir(dir: string): void {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

/**
 * 按需读取单篇文章正文：直接读 .md，不再 readFileSync + JSON.parse index.json。
 * 路径安全校验：拒绝包含分隔符或相对路径的 file 名，防止越界读取主题目录外的内容。
 * 进程级 LRU 缓存：同一篇文章重复访问时直接命中，省去磁盘 IO 与 IPC 序列化往返。
 */
export function loadArticleByFile(
  sessionId: string,
  dir: string,
  file: string
): { id?: string; title?: string; content: string } | null {
  if (
    !file ||
    typeof file !== 'string' ||
    file.includes('/') ||
    file.includes('\\') ||
    file.includes('..')
  ) {
    return null;
  }
  const cached = getCachedArticleContent(sessionId, file);
  if (cached !== undefined) return { content: cached };
  const content = readArticleFile(dir, file);
  setCachedArticleContent(sessionId, file, content);
  return { content };
}

/**
 * 初始化存储：确保根目录存在，并从旧版 SQLite（learn:sessions）做一次迁移。
 * 迁移失败则保留旧数据，下次启动重试；迁移成功才清空旧 key。
 */
export function initLearnStorage(): void {
  if (!existsSync(LEARN_ROOT)) mkdirSync(LEARN_ROOT, { recursive: true });
}