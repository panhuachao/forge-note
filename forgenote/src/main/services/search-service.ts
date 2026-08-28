// 检索服务（S1 重构：SQLite 持久化 + RAG 分块 + 增量维护 + 查询不阻塞）
// 索引以 SQLite（note_chunks / note_meta）为持久真源，内存为热缓存，
// 启动时从 DB 加载，写入/删除经 fs-service 单通道增量更新，查询路径不再触发全目录重扫。
import { promises as fs } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';
import { isMarkdown, isHidden } from '../utils/fs';
import { getKB, upsertChunks, removeChunks, upsertNoteMeta, removeNoteMeta, loadChunks, loadAllMeta, clearNoteMeta, clearChunks, type ChunkRow } from './store';
import { readFrontmatter } from '../utils/markdown';

interface Chunk extends ChunkRow {
  tokens: Set<string>;
  noteName: string;
  notePath: string;
}
interface MetaRow {
  mtime: number;
  size: number;
  templateDirId?: string;
  hash?: string;
  /** 从笔记 FrontMatter 派生的摘要检索副本（文件为真源） */
  summary?: string;
  /** 从笔记 FrontMatter 派生的标签检索副本（文件为真源） */
  tags?: string[];
}
interface KBIndex {
  chunks: Chunk[];
  meta: Map<string, MetaRow>;
  /** 按 mtime 降序的时间索引，时间窗口查询（recentChunks / listRecentPaths）直接切片，避免每次全扫 */
  sortedByMtime: { notePath: string; mtime: number }[];
  ts: number;
}

class SearchService {
  private indexes = new Map<string, KBIndex>();

  private newChunk(row: ChunkRow, notePath: string): Chunk {
    return { ...row, tokens: this.tokenize(row.chunk_text), noteName: notePath.split('/').pop() || notePath, notePath };
  }

  /** 重建时间索引（meta 变更后调用，O(n log n)） */
  private rebuildMtimeIndex(idx: KBIndex): void {
    idx.sortedByMtime = [...idx.meta.entries()]
      .map(([notePath, m]) => ({ notePath, mtime: m.mtime }))
      .sort((a, b) => b.mtime - a.mtime);
  }

  private hashContent(content: string): string {
    return createHash('sha1').update(content).digest('hex');
  }

  /**
   * 确保某知识库索引已在内存（冷启动从 SQLite 加载，不触发全目录扫描）
   */
  private async ensure(kbId: string): Promise<KBIndex> {
    let idx = this.indexes.get(kbId);
    if (idx) return idx;
    idx = { chunks: [], meta: new Map(), sortedByMtime: [], ts: Date.now() };
    const rows = loadChunks(kbId);
    for (const { notePath, chunk } of rows) {
      idx.chunks.push(this.newChunk(chunk, notePath));
    }
    for (const [notePath, m] of loadAllMeta(kbId)) {
      idx.meta.set(notePath, {
        mtime: m.mtime,
        size: m.size,
        templateDirId: m.template_dir_id ?? undefined,
        hash: m.hash ?? undefined,
        summary: m.summary ?? undefined,
        tags: m.tags ? JSON.parse(m.tags) : undefined
      });
    }
    this.rebuildMtimeIndex(idx);
    this.indexes.set(kbId, idx);
    return idx;
  }

  /**
   * 全量重建（启动/手动触发，后台执行，不在查询路径上）
   * - 先清空 SQLite 中的 note_meta / note_chunks 再 walk 文件，保证被删除的笔记留下的旧记录不会残留
   * - 重新提取 FrontMatter 的 summary / tags 一并写入 meta，供「标签」面板与检索复用
   */
  async reindex(kbId: string): Promise<number> {
    const kb = getKB(kbId);
    if (!kb) return 0;
    clearChunks(kbId);
    clearNoteMeta(kbId);
    const collected: { notePath: string; content: string; mtime: number; size: number; templateDirId?: string }[] = [];
    await this.walk(kb.rootPath, '', collected);
    const idx: KBIndex = { chunks: [], meta: new Map(), sortedByMtime: [], ts: Date.now() };
    for (const n of collected) {
      const chunks = this.chunkNote(n.content);
      upsertChunks(kbId, n.notePath, chunks);
      const hash = this.hashContent(n.content);
      const fm = readFrontmatter(n.content);
      const summary = fm.summary ?? '';
      const tags = fm.tags;
      upsertNoteMeta(kbId, n.notePath, n.mtime, n.size, n.templateDirId, hash, summary, tags);
      idx.meta.set(n.notePath, { mtime: n.mtime, size: n.size, templateDirId: n.templateDirId, hash, summary, tags });
      for (const c of chunks) idx.chunks.push(this.newChunk(c, n.notePath));
    }
    this.rebuildMtimeIndex(idx);
    this.indexes.set(kbId, idx);
    return idx.chunks.length;
  }

  /**
   * 仅重建笔记分段（note_chunks）：用于笔记正文已修改但分段策略/锚点错乱时刷新 RAG 索引
   * 不会清空 note_meta，已有的 summary/tags 保留。
   */
  async rebuildChunks(kbId: string): Promise<number> {
    const kb = getKB(kbId);
    if (!kb) return 0;
    const idx = await this.ensure(kbId);
    clearChunks(kbId);
    idx.chunks = [];
    const collected: { notePath: string; content: string; mtime: number; size: number; templateDirId?: string }[] = [];
    await this.walk(kb.rootPath, '', collected);
    let total = 0;
    for (const n of collected) {
      const chunks = this.chunkNote(n.content);
      upsertChunks(kbId, n.notePath, chunks);
      for (const c of chunks) idx.chunks.push(this.newChunk(c, n.notePath));
      total += chunks.length;
    }
    this.rebuildMtimeIndex(idx);
    idx.ts = Date.now();
    this.indexes.set(kbId, idx);
    return total;
  }

  /**
   * 仅重建笔记 meta（mtime/size/hash/summary/tags）：fix "标签面板能看到、笔记里却查不到" 类的旧记录残留。
   * 不动 note_chunks。
   */
  async rebuildNoteMeta(kbId: string): Promise<number> {
    const kb = getKB(kbId);
    if (!kb) return 0;
    const idx = await this.ensure(kbId);
    clearNoteMeta(kbId);
    idx.meta.clear();
    const collected: { notePath: string; content: string; mtime: number; size: number; templateDirId?: string }[] = [];
    await this.walk(kb.rootPath, '', collected);
    for (const n of collected) {
      const hash = this.hashContent(n.content);
      const fm = readFrontmatter(n.content);
      const summary = fm.summary ?? '';
      const tags = fm.tags;
      upsertNoteMeta(kbId, n.notePath, n.mtime, n.size, n.templateDirId, hash, summary, tags);
      idx.meta.set(n.notePath, { mtime: n.mtime, size: n.size, templateDirId: n.templateDirId, hash, summary, tags });
    }
    this.rebuildMtimeIndex(idx);
    idx.ts = Date.now();
    this.indexes.set(kbId, idx);
    return idx.meta.size;
  }

  /**
   * 重建标签索引（只刷新 note_meta.tags）：用户改了 frontmatter tags 后想让面板立刻看到
   * 也用于清理"笔记已删但 tags 仍残留"的旧 sqlite 行。
   */
  async rebuildTagIndex(kbId: string): Promise<number> {
    const kb = getKB(kbId);
    if (!kb) return 0;
    const idx = await this.ensure(kbId);
    const collected: { notePath: string; content: string }[] = [];
    const walkTags = async (abs: string, rel: string) => {
      let entries;
      try {
        entries = await fs.readdir(abs, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (isHidden(e.name) && e.name !== '.kb_template.json') continue;
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        const childAbs = join(abs, e.name);
        if (e.isDirectory()) await walkTags(childAbs, childRel);
        else if (isMarkdown(e.name)) {
          try {
            const content = await fs.readFile(childAbs, 'utf-8');
            collected.push({ notePath: childRel, content });
          } catch {
            /* 跳过不可读 */
          }
        }
      }
    };
    await walkTags(kb.rootPath, '');
    const walkLive = new Set<string>();
    for (const n of collected) walkLive.add(n.notePath);
    // 删掉"文件已不存在"的旧 meta 行（标签旧记录残留就是它造成的）
    for (const path of [...idx.meta.keys()]) {
      if (!walkLive.has(path)) {
        removeNoteMeta(kbId, path);
        idx.meta.delete(path);
      }
    }
    // 重新写入 tags/summary，保留已有的 mtime/size/hash
    for (const n of collected) {
      const fm = readFrontmatter(n.content);
      const summary = fm.summary ?? '';
      const tags = fm.tags;
      const prev = idx.meta.get(n.notePath);
      const mtime = prev?.mtime ?? 0;
      const size = prev?.size ?? 0;
      const hash = prev?.hash;
      const templateDirId = prev?.templateDirId;
      upsertNoteMeta(kbId, n.notePath, mtime, size, templateDirId, hash, summary, tags);
      if (prev) {
        prev.summary = summary;
        prev.tags = tags;
      }
    }
    idx.ts = Date.now();
    this.indexes.set(kbId, idx);
    return walkLive.size;
  }

  private async walk(abs: string, rel: string, out: { notePath: string; content: string; mtime: number; size: number; templateDirId?: string }[]): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (isHidden(e.name) && e.name !== '.kb_template.json') continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      const childAbs = join(abs, e.name);
      if (e.isDirectory()) {
        await this.walk(childAbs, childRel, out);
      } else if (isMarkdown(e.name)) {
        try {
          const stat = await fs.stat(childAbs);
          if (stat.size > 2 * 1024 * 1024) continue; // > 2MB 跳过
          const content = await fs.readFile(childAbs, 'utf-8');
          out.push({ notePath: childRel, content, mtime: stat.mtimeMs, size: stat.size, templateDirId: this.matchDirId(childRel) });
        } catch {}
      }
    }
  }

  private matchDirId(dirPath: string): string | undefined {
    const m = /^(\d{2})/.exec(dirPath.split('/').pop() || '');
    return m ? m[1] : undefined;
  }

  private tokenize(s: string): Set<string> {
    const cnTokens = s.match(/[\u4e00-\u9fa5]{2,}/g) || [];
    const enTokens = s.toLowerCase().match(/[a-z0-9_]{2,}/g) || [];
    return new Set([...cnTokens, ...enTokens]);
  }

  /**
   * 分块：按 Markdown 标题层级切分，单块超 800 字按段落再切；带 heading 面包屑与行号。
   */
  private chunkNote(content: string): ChunkRow[] {
    const lines = content.split('\n');
    const chunks: ChunkRow[] = [];
    let curHeading = '';
    let buf: string[] = [];
    let startLine = 1;
    let idx = 0;
    const flush = (linesArr: string[], from: number) => {
      if (linesArr.length === 0) return;
      let text = linesArr.join('\n');
      let segStart = from;
      while (text.length > 0) {
        const cut = text.length > 800 ? text.lastIndexOf('\n', 800) : -1;
        const piece = cut > 0 ? text.slice(0, cut) : text.slice(0, 800);
        const pieceLines = piece.split('\n').length;
        chunks.push({ chunk_idx: idx++, chunk_text: piece, heading: curHeading || null, start_line: segStart, end_line: segStart + pieceLines - 1 });
        text = text.slice(piece.length);
        segStart += pieceLines;
      }
    };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const h = /^(#{1,6})\s+(.*)$/.exec(line);
      if (h) {
        flush(buf, startLine);
        buf = [];
        startLine = i + 1;
        curHeading = h[2].trim();
      } else {
        buf.push(line);
      }
    }
    flush(buf, startLine);
    if (chunks.length === 0) chunks.push({ chunk_idx: 0, chunk_text: content, heading: null, start_line: 1, end_line: lines.length });
    return chunks;
  }

  /**
   * 增量更新单篇（fs-service 单通道写入时调用）：同时维护内存 + SQLite
   */
  async upsertNote(kbId: string, notePath: string, content: string, mtime: number, size: number, templateDirId?: string): Promise<void> {
    const idx = await this.ensure(kbId);
    const hash = this.hashContent(content);

    // 从 FrontMatter 派生 summary / tags（content 含文件头，syncIndex 传入 raw）
    const fm = readFrontmatter(content);
    const summary = fm.summary ?? '';
    const tags = fm.tags;

    // #11 去重短路：内容 hash 未变（即使 mtime 被外部工具重置/保真复制）则跳过
    // 昂贵的 tokenize + chunkNote + 全量分块写库，仅刷新 meta 的 mtime/size/summary/tags。
    const prev = idx.meta.get(notePath);
    if (prev && prev.hash === hash) {
      upsertNoteMeta(kbId, notePath, mtime, size, templateDirId, hash, summary, tags);
      prev.mtime = mtime;
      prev.size = size;
      prev.templateDirId = templateDirId;
      prev.tags = tags;
      prev.summary = summary;
      this.rebuildMtimeIndex(idx);
      idx.ts = Date.now();
      return;
    }

    const chunks = this.chunkNote(content);
    upsertChunks(kbId, notePath, chunks);
    upsertNoteMeta(kbId, notePath, mtime, size, templateDirId, hash, summary, tags);
    idx.chunks = idx.chunks.filter((c) => c.notePath !== notePath);
    for (const c of chunks) idx.chunks.push(this.newChunk(c, notePath));
    idx.meta.set(notePath, { mtime, size, templateDirId, hash, tags, summary });
    this.rebuildMtimeIndex(idx);
    idx.ts = Date.now();
  }

  async removeNote(kbId: string, notePath: string): Promise<void> {
    const idx = this.indexes.get(kbId);
    if (idx) {
      idx.chunks = idx.chunks.filter((c) => c.notePath !== notePath);
      idx.meta.delete(notePath);
      this.rebuildMtimeIndex(idx);
    }
    removeChunks(kbId, notePath);
    removeNoteMeta(kbId, notePath);
  }

  /**
   * 搜索：纯内存匹配，不触发全目录重扫（S1 稳定性：查询不再阻塞）
   */
  async query(kbId: string, q: string, opts?: { templateDirIds?: string[]; limit?: number; sinceTs?: number }): Promise<import('@shared/types').SearchResult[]> {
    const limit = opts?.limit ?? 50;
    const idx = await this.ensure(kbId);
    const tokens = [...this.tokenize(q)];
    if (tokens.length === 0) return [];
    const qLower = q.toLowerCase();
    const filterDirs = opts?.templateDirIds && opts.templateDirIds.length > 0 ? new Set(opts.templateDirIds) : null;

    const results: { chunk: Chunk; score: number; snippet: string; matchType: import('@shared/types').SearchResult['matchType'] }[] = [];
    for (const c of idx.chunks) {
      const meta = idx.meta.get(c.notePath);
      if (opts?.sinceTs && meta && meta.mtime < opts.sinceTs) continue; // 时间收敛
      if (filterDirs && (!meta?.templateDirId || !filterDirs.has(meta.templateDirId))) continue;
      let score = 0;
      let matchType: import('@shared/types').SearchResult['matchType'] = 'content';
      if (c.noteName.toLowerCase().includes(qLower)) {
        score += 10;
        matchType = 'title';
      }
      for (const t of tokens) {
        if (c.tokens.has(t)) score += 2;
      }
      if (score === 0) continue;
      const idx2 = c.chunk_text.toLowerCase().indexOf(qLower);
      const snippet = idx2 >= 0
        ? c.chunk_text.slice(Math.max(0, idx2 - 30), idx2 + 80).replace(/\n+/g, ' ')
        : c.chunk_text.slice(0, 120).replace(/\n+/g, ' ');
      results.push({ chunk: c, score, snippet, matchType });
    }
    results.sort((a, b) => b.score - a.score);

    // 按 notePath 去重：同一篇笔记只保留最高分的命中片段，避免列表重复
    const bestByNote = new Map<string, typeof results[0]>();
    for (const r of results) {
      const path = r.chunk.notePath;
      const prev = bestByNote.get(path);
      if (!prev || r.score > prev.score || (r.score === prev.score && r.matchType === 'title' && prev.matchType !== 'title')) {
        bestByNote.set(path, r);
      }
    }
    const deduped = [...bestByNote.values()].sort((a, b) => b.score - a.score);

    return deduped.slice(0, limit).map((r) => ({
      notePath: r.chunk.notePath,
      noteName: r.chunk.noteName,
      snippet: r.snippet,
      templateDirId: idx.meta.get(r.chunk.notePath)?.templateDirId,
      matchType: r.matchType,
      score: r.score,
      heading: r.chunk.heading ?? undefined,
      startLine: r.chunk.start_line ?? undefined
    }));
  }

  /** 时间窗口列出最近修改的笔记路径（供 runTimeSummary 收敛候选集） */
  async listRecentPaths(kbId: string, sinceTs: number, limit = 50): Promise<{ notePath: string; mtime: number }[]> {
    const idx = await this.ensure(kbId);
    // #2 时间索引：sortedByMtime 已按 mtime 降序，直接过滤切片，O(n) 不重新排序
    const out: { notePath: string; mtime: number }[] = [];
    for (const e of idx.sortedByMtime) {
      if (e.mtime < sinceTs) break; // 已降序，此后均更小
      out.push(e);
      if (out.length >= limit) break;
    }
    return out;
  }

  /**
   * 时间窗口召回：返回该窗口内所有笔记的分块（不依赖关键词），供「总结本周/今天」类请求。
   * 时间窗口本身就是检索条件，命中即纳入，不再要求查询词命中。
   */
  async recentChunks(kbId: string, sinceTs: number, limit = 50): Promise<import('@shared/types').SearchResult[]> {
    const idx = await this.ensure(kbId);
    // #2 时间索引：用 sortedByMtime 收敛窗口内笔记路径集合，避免遍历整 meta Map
    const recent = new Set<string>();
    for (const e of idx.sortedByMtime) {
      if (e.mtime < sinceTs) break;
      recent.add(e.notePath);
    }
    const out: import('@shared/types').SearchResult[] = [];
    for (const c of idx.chunks) {
      if (!recent.has(c.notePath)) continue;
      out.push({
        notePath: c.notePath,
        noteName: c.noteName,
        snippet: c.chunk_text.slice(0, 200).replace(/\n+/g, ' '),
        templateDirId: idx.meta.get(c.notePath)?.templateDirId,
        matchType: 'content',
        score: c.start_line && c.start_line <= 1 ? 1 : 0.5, // 首块优先
        heading: c.heading ?? undefined,
        startLine: c.start_line ?? undefined
      });
    }
    return out.slice(0, limit);
  }
}

export const searchService = new SearchService();
