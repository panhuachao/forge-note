// RAG 流水线（S1：统一召回 + RRF 融合 + 精排 + 引用锚点）
// 编排 search-service 的分块召回与重排，供 ai-service / skill-engine 统一调用，
// 消除「时间维度全文」与「关键词片段」双路径分裂。
import type { SearchResult, AIRefHit } from '@shared/types';
import { searchService } from './search-service';

/**
 * 检索重排：在召回基础上，用查询词重叠度 + 标题/匹配类型加权重新打分并截断到 top-N，
 * 剔除低信号片段，让进 context 的引用更聚焦、更省 token。纯本地计算，不额外调用 LLM。
 */
export function rerankHits(query: string, hits: SearchResult[], topN = 8): SearchResult[] {
  const q = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const norm = (s: string) => s.toLowerCase();
  const scored = hits.map((h) => {
    const title = norm(h.noteName);
    const body = norm(h.snippet);
    let s = h.score;
    if (q.some((w) => title.includes(w))) s += 0.35; // 标题命中强信号
    const overlap = q.filter((w) => body.includes(w)).length; // 查询词与片段词面重叠
    s += (overlap / Math.max(q.length, 1)) * 0.5;
    if (h.matchType === 'title') s += 0.2; // 标题匹配优先
    return { h, s };
  });
  scored.sort((a, b) => b.s - a.s);
  return scored.filter((x) => x.s > 0.15).slice(0, topN).map((x) => x.h);
}

/**
 * 统一召回（RAG 入口）：关键词分块召回 → 时间/标签收敛 → 精排 → 引用锚点。
 * 取代原 search-service.query + ai-service.rerankHits 的分散逻辑。
 */
export async function retrieve(
  kbId: string,
  query: string,
  opts?: { sinceDays?: number; templateDirIds?: string[]; topK?: number; tokenBudget?: number; timeWindowOnly?: boolean; groupByNote?: boolean }
): Promise<{ hits: SearchResult[]; refs: AIRefHit[]; context: string }> {
  const topK = opts?.topK ?? 8;
  const sinceTs = opts?.sinceDays != null ? Date.now() - opts.sinceDays * 86400_000 : undefined;
  const groupByNote = !!opts?.groupByNote;

  // 1) 召回
  let raw: SearchResult[];
  if (opts?.timeWindowOnly && sinceTs != null) {
    // 时间维度总结：时间窗口即检索条件，纳入窗口内全部笔记，不要求关键词命中
    // 聚合模式下多取一些分块，便于按笔记合并后仍能覆盖多篇
    raw = await searchService.recentChunks(kbId, sinceTs, topK * (groupByNote ? 6 : 3));
  } else {
    // 常规 RAG：关键词分块召回 + 时间收敛
    raw = await searchService.query(kbId, query, {
      templateDirIds: opts?.templateDirIds,
      limit: topK * 3,
      sinceTs
    });
  }

  // 2) 精排（时间窗口模式按时间序，仍走轻量重排去噪）
  const hits = rerankHits(query, raw, groupByNote ? topK * 6 : topK);

  // 3) 引用锚点（[[笔记名#标题]]）+ 上下文拼装（按 token 预算贪心）
  const budget = opts?.tokenBudget ?? 6000;
  let used = 0;
  const blocks: string[] = [];
  const refs: AIRefHit[] = [];

  if (groupByNote) {
    // 整篇阅读模式（如本周总结）：同一篇笔记合并为一个 block + 一个 ref，
    // 避免「PRD 这类长文档被切多块后产生 N 行重复引用」。
    const byPath = new Map<string, { name: string; heading?: string; chunks: SearchResult[] }>();
    for (const h of hits) {
      const cur = byPath.get(h.notePath) ?? { name: h.noteName, heading: h.heading, chunks: [] };
      cur.chunks.push(h);
      byPath.set(h.notePath, cur);
    }
    // 按各路径最强 hit 分数排序（取首块 score 作为笔记整体代表性）
    const ordered = [...byPath.values()].sort((a, b) => (b.chunks[0]?.score ?? 0) - (a.chunks[0]?.score ?? 0));
    for (const note of ordered.slice(0, topK)) {
      const first = note.chunks[0];
      const anchor = first.heading ? `[[${note.name}#${first.heading}]]` : `[[${note.name}]]`;
      const sub = note.chunks
        .map((c, i) => `- 片段${i + 1}${c.startLine ? ` (行 ${c.startLine})` : ''}：${c.snippet}`)
        .join('\n');
      const block = `### ${anchor}\n${sub}`;
      const cost = block.length;
      if (used + cost > budget && blocks.length > 0) break;
      blocks.push(block);
      used += cost;
      refs.push({ path: first.notePath, name: note.name.replace(/\.md$/i, ''), snippet: note.chunks[0].snippet });
    }
  } else {
    // 标准细粒度 RAG：每条 hit 一个 block / 一个 ref，保留段落级定位
    for (const h of hits) {
      const anchor = h.heading ? `[[${h.noteName}#${h.heading}]]` : `[[${h.noteName}]]`;
      const block = `### ${anchor}${h.startLine ? ` (行 ${h.startLine})` : ''}\n${h.snippet}`;
      const cost = block.length;
      if (used + cost > budget && blocks.length > 0) break;
      blocks.push(block);
      used += cost;
      refs.push({ path: h.notePath, name: h.noteName.replace(/\.md$/i, ''), snippet: h.snippet });
    }
  }
  return { hits, refs, context: blocks.join('\n\n') };
}
