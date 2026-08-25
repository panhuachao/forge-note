// 简易搜索服务 - 基于内容扫描与字符串匹配
// 注：生产环境应使用 SQLite FTS5 + LanceDB 向量；此处用内存倒排索引保证 V1.1 MVP 可用
import { promises as fs } from 'fs';
import { join } from 'path';
import { isMarkdown, isHidden } from '../utils/fs';
import { getKB } from './store';

interface IndexEntry {
  path: string;
  name: string;
  tokens: Set<string>;
  content: string; // 缓存前 8KB
  templateDirId?: string;
}

class SearchService {
  private indexes = new Map<string, { entries: IndexEntry[]; ts: number }>();

  /**
   * 重建索引
   */
  async reindex(kbId: string): Promise<number> {
    const kb = getKB(kbId);
    if (!kb) return 0;
    const entries: IndexEntry[] = [];
    await this.walk(kb.rootPath, '', entries);
    this.indexes.set(kbId, { entries, ts: Date.now() });
    return entries.length;
  }

  private async walk(abs: string, rel: string, out: IndexEntry[]): Promise<void> {
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
          out.push({
            path: childRel,
            name: e.name,
            tokens: this.tokenize(content),
            content: content.slice(0, 8192),
            templateDirId: this.matchDirId(rel)
          });
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
    const enTokens = (s.toLowerCase().match(/[a-z0-9_]{2,}/g) || []);
    return new Set([...cnTokens, ...enTokens]);
  }

  /**
   * 搜索
   */
  async query(kbId: string, q: string, opts?: { templateDirIds?: string[]; limit?: number }): Promise<import('@shared/types').SearchResult[]> {
    const limit = opts?.limit ?? 50;
    const idx = this.indexes.get(kbId);
    if (!idx || Date.now() - idx.ts > 60_000) {
      await this.reindex(kbId);
    }
    const data = this.indexes.get(kbId)!;
    const tokens = [...this.tokenize(q)];
    if (tokens.length === 0) return [];
    const filterDirs = opts?.templateDirIds && opts.templateDirIds.length > 0 ? new Set(opts.templateDirIds) : null;

    const results: { entry: IndexEntry; score: number; snippet: string; matchType: import('@shared/types').SearchResult['matchType'] }[] = [];
    for (const e of data.entries) {
      if (filterDirs && (!e.templateDirId || !filterDirs.has(e.templateDirId))) continue;
      // 文件名命中
      const nameLower = e.name.toLowerCase();
      const qLower = q.toLowerCase();
      let score = 0;
      let matchType: import('@shared/types').SearchResult['matchType'] = 'content';
      if (nameLower.includes(qLower)) {
        score += 10;
        matchType = 'title';
      }
      // token 命中
      for (const t of tokens) {
        if (e.tokens.has(t)) score += 2;
      }
      if (score === 0) continue;
      const idx2 = e.content.toLowerCase().indexOf(qLower);
      const snippet = idx2 >= 0
        ? e.content.slice(Math.max(0, idx2 - 30), idx2 + 80).replace(/\n+/g, ' ')
        : e.content.slice(0, 120).replace(/\n+/g, ' ');
      results.push({ entry: e, score, snippet, matchType });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit).map((r) => ({
      notePath: r.entry.path,
      noteName: r.entry.name,
      snippet: r.snippet,
      templateDirId: r.entry.templateDirId,
      matchType: r.matchType,
      score: r.score
    }));
  }
}

export const searchService = new SearchService();
