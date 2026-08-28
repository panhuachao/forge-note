// MCP 工具运行时（本地知识库工具）见 doc/AI调用重构技术方案.md §6.2
// 以 MCP 工具形态暴露知识库能力，供模型在推理中主动调用（检索/读/写/诊断）。
import { fsService } from './fs-service';
import { searchService } from './search-service';
import { linkIndex } from './link-index';
import { aiService } from './ai-service';
import { auditService } from './audit-service';
import { getKB } from './store';
import { readFrontmatter } from '../utils/markdown';
import { previewNotePatch, applyNotePatch, normalizeOps } from './note-patch';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface MCPTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ToolCtx {
  kbId: string;
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ToolActivity {
  name: string;
  args: Record<string, unknown>;
  result: string;
}

// 工具 Schema（OpenAI function calling 风格）
export const KB_TOOLS: MCPTool[] = [
  {
    name: 'kb_search',
    description: '在知识库中全文检索笔记，返回匹配片段（noteName / notePath / snippet）。当需要查找某主题已有内容时调用。',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: '检索关键词' }, limit: { type: 'number', description: '返回条数，默认 8' } },
      required: ['query']
    }
  },
  {
    name: 'kb_read_note',
    description: '读取指定笔记的完整内容（含 frontmatter）。参数为相对路径，如 01 项目/foo.md',
    input_schema: {
      type: 'object',
      properties: { notePath: { type: 'string', description: '笔记相对路径' } },
      required: ['notePath']
    }
  },
  {
    name: 'kb_list_notes',
    description: '列出知识库笔记。可按目录过滤，或按时间窗口（sinceDays）筛近 N 天修改过的笔记，返回路径与 mtime，便于按"今天/本周"等时间维度筛选。',
    input_schema: {
      type: 'object',
      properties: {
        dirPath: { type: 'string', description: '目录相对路径，留空列全部' },
        limit: { type: 'number', description: '返回条数，默认 50' },
        sinceDays: { type: 'number', description: '仅返回近 N 天修改过的笔记（按 mtime 过滤）。常用于"今天/本周"类时间维度问题。' }
      }
    }
  },
  {
    name: 'kb_write_note',
    description: '创建或覆盖写入一篇笔记。append=true 时追加到正文末尾。写操作会记入审计。',
    input_schema: {
      type: 'object',
      properties: {
        notePath: { type: 'string', description: '笔记相对路径，如 10 知识库/卡片.md' },
        content: { type: 'string', description: '笔记全文（append=false）或追加内容（append=true）' },
        append: { type: 'boolean', description: '是否追加，默认 false（覆盖）' }
      },
      required: ['notePath', 'content']
    }
  },
  {
    name: 'kb_preview_patch',
    description:
      '对指定笔记生成修改预览（diff），不会写入文件。当你想修改笔记正文或 frontmatter 时，必须先调用本工具生成预览，让用户确认。返回 previewId 与 diff。',
    input_schema: {
      type: 'object',
      properties: {
        notePath: { type: 'string', description: '笔记相对路径' },
        ops: {
          type: 'array',
          description: '修改操作列表',
          items: {
            type: 'object',
            properties: {
              op: {
                type: 'string',
                enum: ['set_frontmatter', 'replace', 'insert_after', 'append', 'delete_lines'],
                description:
                  'set_frontmatter=改 frontmatter 字段；replace=替换正文文本；insert_after=在锚点后插入；append=追加到末尾；delete_lines=删除行'
              },
              key: { type: 'string', description: 'frontmatter 键名（op=set_frontmatter）' },
              value: { description: 'frontmatter 值（op=set_frontmatter）' },
              oldText: { type: 'string', description: '被替换的原始文本（op=replace）' },
              newText: { type: 'string', description: '替换后的文本（op=replace）' },
              anchor: { type: 'string', description: '定位锚点文本（op=insert_after）' },
              text: { type: 'string', description: '插入/追加的文本（op=insert_after / append）' },
              startLine: { type: 'number', description: '起始行号，1-based（op=delete_lines）' },
              endLine: { type: 'number', description: '结束行号，含（op=delete_lines）' }
            },
            required: ['op']
          }
        }
      },
      required: ['notePath', 'ops']
    }
  },
  {
    name: 'kb_apply_patch',
    description:
      '将已生成预览的修改真正写入笔记。只有在用户已明确确认该修改后才能调用；传入 previewId 可保证所见即所改。',
    input_schema: {
      type: 'object',
      properties: {
        notePath: { type: 'string', description: '笔记相对路径' },
        previewId: { type: 'string', description: 'kb_preview_patch 返回的预览 id（强烈建议传入）' },
        ops: { type: 'array', description: '修改操作列表（无 previewId 时必填）' }
      },
      required: ['notePath']
    }
  },
  {
    name: 'kb_suggest_dir',
    description: '为某篇笔记推荐最合适的归属目录。返回建议目录与理由。',
    input_schema: {
      type: 'object',
      properties: { notePath: { type: 'string', description: '笔记相对路径' } },
      required: ['notePath']
    }
  },
  {
    name: 'kb_link_graph',
    description: '获取某篇笔记的双向链接邻域（出链目标 + 反向链接），用于理解关联关系。',
    input_schema: {
      type: 'object',
      properties: { notePath: { type: 'string', description: '笔记相对路径' }, depth: { type: 'number', description: '扩散层数，默认 1' } },
      required: ['notePath']
    }
  },
  {
    name: 'kb_diagnose',
    description: '对知识库做健康诊断（失效链接、空目录、重复标题等）。',
    input_schema: { type: 'object', properties: {} }
  },

  /* ==== 知识库级只读工具（doc/AI智能管家重构方案.md §5.2 P2-2）====
   * 让 AI 具备「全局视角」：统计、查重、孤儿、标签体系、结构评审、过期内容。
   * 全部只读，不进 WRITE_TOOLS，无需用户确认。 */
  {
    name: 'kb_stats',
    description:
      '知识库整体统计：笔记数、目录数、标签数、链接数、总字数、平均篇幅、近 30 天更新量。用于回答「我的知识库有多大 / 增长如何」这类全局问题。',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'kb_duplicates',
    description:
      '检测可能重复的笔记：标题相同或正文高度相似（字符 3-gram Jaccard）。返回可疑配对与相似度，供合并去重决策。',
    input_schema: {
      type: 'object',
      properties: {
        threshold: { type: 'number', description: '正文相似度阈值 0~1，默认 0.75' },
        limit: { type: 'number', description: '最多返回多少对，默认 10' }
      }
    }
  },
  {
    name: 'kb_orphans',
    description:
      '找出孤立笔记：既无出链、又无入链、且没有标签的笔记。这类笔记通常未融入知识体系，是整理的重点对象。',
    input_schema: {
      type: 'object',
      properties: { limit: { type: 'number', description: '最多返回多少条，默认 30' } }
    }
  },
  {
    name: 'kb_tag_tree',
    description:
      '标签体系分析：各标签使用次数、稀疏标签（仅 1 篇使用）、无标签笔记数。用于标签治理（合并同义标签、补全标签）。',
    input_schema: {
      type: 'object',
      properties: { limit: { type: 'number', description: '最多列出多少个标签，默认 40' } }
    }
  },
  {
    name: 'kb_structure_review',
    description:
      '目录结构评审：目录数、最大层级深度、空目录、笔记最集中的目录、过深目录。用于判断知识库结构是否合理。',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'kb_stale',
    description: '找出长期未更新的笔记（默认超过 180 天），便于归档或回顾。',
    input_schema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: '未更新天数阈值，默认 180' },
        limit: { type: 'number', description: '最多返回多少条，默认 30' }
      }
    }
  }
];

/**
 * 会产生副作用的「写类工具」。
 * 未拿到用户确认前，这些工具不应出现在模型可见的工具列表中（doc/MCP技术实现方案.md §4.2）。
 */
export const WRITE_TOOLS = new Set<string>(['kb_write_note', 'kb_apply_patch']);

function walkNotes(root: string, dir: string, out: string[], limit: number): void {
  if (out.length >= limit) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) walkNotes(root, rel, out, limit);
    else if (e.isFile() && e.name.endsWith('.md')) {
      out.push(rel);
      if (out.length >= limit) return;
    }
  }
}

/** 递归收集近 N 天新增/修改过的 .md 笔记（含 mtime），按时间倒序 */
function walkRecentNotes(
  root: string,
  dir: string,
  out: Array<{ path: string; mtime: number }>,
  limit: number,
  sinceTs: number
): void {
  if (out.length >= limit) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const rel = dir ? `${dir}/${e.name}` : e.name;
    const abs = path.join(root, rel);
    if (e.isDirectory()) {
      walkRecentNotes(root, rel, out, limit, sinceTs);
    } else if (e.isFile() && e.name.endsWith('.md')) {
      try {
        const st = fs.statSync(abs);
        if (st.mtimeMs >= sinceTs) {
          out.push({ path: rel, mtime: st.mtimeMs });
        }
      } catch {
        /* 跳过无法 stat 的文件 */
      }
      if (out.length >= limit) return;
    }
  }
}

/* ==================== 知识库级扫描（doc/AI智能管家重构方案.md §5.2 P2-2） ==================== */
// 现有 9 个工具全部是「笔记级」操作，AI 无法对知识库全局把脉。
// 这里提供一次全库扫描，供 kb_stats / kb_duplicates / kb_orphans / kb_tag_tree /
// kb_structure_review / kb_stale 六个只读工具共用，也被巡检服务复用。

/** 单篇笔记的轻量元数据（不持有全文，content 仅保留截断片段用于相似度计算） */
export interface NoteMeta {
  path: string;
  /** 不含 .md 的文件名 */
  name: string;
  /** 所属目录相对路径，根目录为空串 */
  dir: string;
  title: string;
  tags: string[];
  outlinks: string[];
  inlinks: string[];
  mtime: number;
  /** 正文字符数 */
  size: number;
  /** 正文截断片段（默认 2000 字），用于正文相似度计算 */
  content: string;
}

/** 扫描上限：超过则只取前 N 篇，避免大库全量读盘卡死 */
const SCAN_LIMIT = 3000;

/**
 * 全库扫描，返回每篇笔记的元数据。
 * 直接读盘解析 frontmatter，**不走 fsService.readNote**——
 * 后者有「惰性回填 createdAt 并写盘」的副作用，只读工具不应产生写入。
 */
export function scanNotes(kbId: string, limit = SCAN_LIMIT, snippetLen = 2000): NoteMeta[] {
  const kb = getKB(kbId);
  if (!kb) return [];
  const paths: string[] = [];
  walkNotes(kb.rootPath, '', paths, limit);
  const out: NoteMeta[] = [];
  for (const p of paths) {
    try {
      const abs = path.join(kb.rootPath, p);
      const raw = fs.readFileSync(abs, 'utf-8');
      const { data, content } = readFrontmatter(raw);
      const fm = (data || {}) as Record<string, unknown>;
      const title =
        String(fm.title || '').trim() ||
        (content.split('\n')[0] || '').replace(/^#\s*/, '').trim() ||
        path.basename(p, '.md');
      const tags = Array.isArray(fm.tags) ? fm.tags.map((t) => String(t).trim()).filter(Boolean) : [];
      let mtime = 0;
      try {
        mtime = fs.statSync(abs).mtimeMs;
      } catch {
        /* 取不到时间就按 0 处理 */
      }
      out.push({
        path: p,
        name: path.basename(p, '.md'),
        dir: path.dirname(p) === '.' ? '' : path.dirname(p),
        title,
        tags,
        outlinks: linkIndex.getOutlinks(kbId, p),
        inlinks: linkIndex.getBacklinks(kbId, p),
        mtime,
        size: content.length,
        content: content.slice(0, snippetLen)
      });
    } catch {
      /* 跳过无法读取的笔记 */
    }
  }
  return out;
}

/** 递归收集所有目录（相对路径，不含根目录），跳过隐藏目录 */
function walkDirs(root: string, dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || !e.isDirectory()) continue;
    const rel = dir ? `${dir}/${e.name}` : e.name;
    out.push(rel);
    walkDirs(root, rel, out);
  }
}

/** 字符 n-gram 集合（用于正文相似度，中文无需分词） */
function charGrams(text: string, n = 3): Set<string> {
  const s = text.replace(/\s+/g, '');
  const set = new Set<string>();
  if (s.length < n) return set;
  for (let i = 0; i + n <= s.length; i++) set.add(s.slice(i, i + n));
  return set;
}

/** Jaccard 相似度 */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const g of a) if (b.has(g)) inter++;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

/** 执行一个工具调用，返回面向模型的文本结果 */
export async function executeTool(call: ToolCall, ctx: ToolCtx): Promise<string> {
  const kbId = ctx.kbId;
  try {
    switch (call.name) {
      case 'kb_search': {
        const hits = await searchService.query(kbId, String(call.args.query || ''), { limit: Number(call.args.limit) || 8 });
        if (!hits.length) return '未检索到相关笔记。';
        return hits
          .map((h) => {
            const anchor = h.heading ? `[[${h.noteName}#${h.heading}]]` : `[[${h.noteName}]]`;
            return `### ${anchor}${h.startLine ? ` (行 ${h.startLine})` : ''}\n路径: ${h.notePath}\n片段: ${h.snippet}`;
          })
          .join('\n\n');
      }
      case 'kb_read_note': {
        const note = await fsService.readNote(kbId, String(call.args.notePath));
        const meta = note.frontmatter || {};
        const title = String(meta.title || (note.content.split('\n')[0] || '').replace(/^#\s*/, '') || note.path);
        const tags = Array.isArray(meta.tags) ? (meta.tags as unknown[]).join(', ') : String(meta.tags || '');
        return `路径: ${note.path}\n标题: ${title}\n标签: ${tags}\n正文:\n${note.content}`;
      }
      case 'kb_list_notes': {
        const kb = getKB(kbId);
        if (!kb) return '知识库不存在';
        const limit = Number(call.args.limit) || 50;
        const sinceDays = Number(call.args.sinceDays);
        if (Number.isFinite(sinceDays) && sinceDays > 0) {
          // 时间窗口：返回近 N 天修改过的笔记（含 mtime）。
          // 锚点策略：sinceDays===1 时按"本地时区今日 0 点"截断（避免 24h 滚动边界在凌晨踩坑），
          //           其他情况按 N×24h 滚动窗口。
          const out: Array<{ path: string; mtime: number }> = [];
          let sinceTs: number;
          let anchorLabel: string;
          if (sinceDays === 1) {
            const d = new Date();
            d.setHours(0, 0, 0, 0);
            sinceTs = d.getTime();
            anchorLabel = `今日 0 点（${d.toLocaleString()}）`;
          } else {
            sinceTs = Date.now() - sinceDays * 86400_000;
            anchorLabel = `近 ${sinceDays} 天`;
          }
          // 调试日志：方便确认"时间路由"分支是否真正命中（开发期可关）
          try {
            // eslint-disable-next-line no-console
            console.debug(`[kb_list_notes] sinceDays=${sinceDays} anchor=${anchorLabel} sinceTs=${new Date(sinceTs).toISOString()}`);
          } catch { /* noop */ }
          walkRecentNotes(kb.rootPath, String(call.args.dirPath || ''), out, limit, sinceTs);
          // 按时间倒序
          out.sort((a, b) => b.mtime - a.mtime);
          if (out.length === 0) {
            return `（${anchorLabel} 以来无新增/修改的笔记）`;
          }
          return out
            .map((n) => `- ${n.path}\n  mtime: ${new Date(n.mtime).toLocaleString()}`)
            .join('\n');
        }
        const out: string[] = [];
        walkNotes(kb.rootPath, String(call.args.dirPath || ''), out, limit);
        return out.length ? out.map((p) => `- ${p}`).join('\n') : '（无笔记）';
      }
      case 'kb_write_note': {
        const notePath = String(call.args.notePath);
        const content = String(call.args.content || '');
        const append = !!call.args.append;
        if (append) {
          const cur = await fsService.readNote(kbId, notePath).catch(() => null);
          const merged = (cur ? cur.content + '\n\n' : '') + content;
          await fsService.writeNote(kbId, notePath, merged);
        } else {
          const exists = await fsService.readNote(kbId, notePath).catch(() => null);
          if (exists) await fsService.writeNote(kbId, notePath, content);
          else await fsService.createNote(kbId, path.dirname(notePath), { name: path.basename(notePath) });
          if (!exists) await fsService.writeNote(kbId, notePath, content);
        }
        auditService.record(kbId, 'move', { notePath, action: 'aiWrite', by: 'ai' });
        return `已写入笔记: ${notePath}`;
      }
      case 'kb_preview_patch': {
        const notePath = String(call.args.notePath || '');
        const ops = normalizeOps(call.args.ops);
        if (!notePath) return '缺少 notePath';
        if (!ops.length) return '缺少有效的 ops';
        const pv = await previewNotePatch(kbId, notePath, ops);
        return [
          '预览已生成。请立即停止调用任何工具，直接按 system 提示输出最终的 ```json 建议块。',
          `previewId: ${pv.previewId}`,
          `notePath: ${pv.notePath}`,
          `canApply: ${pv.canApply}`,
          `affectedLines: ${pv.affectedLines}`,
          `message: ${pv.message || '无'}`,
          `diff（供你判断，不要复制进 JSON）：\n${(pv.diff || '').slice(0, 2000)}`,
          '提示：最终 ```json 建议块中，payload 必须包含 previewId 和 notePath；不要复制 diff 正文。'
        ].join('\n');
      }
      case 'kb_apply_patch': {
        const notePath = String(call.args.notePath || '');
        if (!notePath) return '缺少 notePath';
        const ops = normalizeOps(call.args.ops);
        const previewId = call.args.previewId ? String(call.args.previewId) : undefined;
        if (!ops.length && !previewId) return '缺少 ops 或 previewId';
        const r = await applyNotePatch(kbId, notePath, ops, previewId);
        return r.ok ? `${r.message}（影响 ${r.affected} 处）` : `应用失败：${r.message}`;
      }
      case 'kb_suggest_dir': {
        const sug = await aiService.suggestDir(kbId, String(call.args.notePath));
        return JSON.stringify(sug.slice(0, 3));
      }
      case 'kb_link_graph': {
        const notePath = String(call.args.notePath);
        const out = linkIndex.getOutlinks(kbId, notePath).map((t) => linkIndex.resolve(kbId, t) || t);
        const back = linkIndex.getBacklinks(kbId, notePath);
        return `出链: ${out.join(', ') || '（无）'}\n反向链接: ${back.join(', ') || '（无）'}`;
      }
      case 'kb_diagnose': {
        // 轻量诊断：基于链接索引统计（笔记数 / 链接数 / 失效链接数）
        const kb = getKB(kbId);
        if (!kb) return '知识库不存在';
        const all = linkIndex.getAllOutlinks(kbId);
        let linkCount = 0;
        let broken = 0;
        for (const [notePath, links] of all) {
          linkCount += links.size;
          for (const t of links) {
            if (!linkIndex.resolve(kbId, t)) broken++;
          }
        }
        return `笔记总数: ${all.size}\n链接总数: ${linkCount}\n失效链接: ${broken}`;
      }

      /* ==================== 知识库级只读工具 ==================== */
      case 'kb_stats': {
        const notes = scanNotes(kbId);
        if (!notes.length) return '知识库为空，暂无统计数据。';
        const dirs = new Set(notes.map((n) => n.dir).filter(Boolean));
        const tagSet = new Set<string>();
        let chars = 0;
        let links = 0;
        let untagged = 0;
        for (const n of notes) {
          n.tags.forEach((t) => tagSet.add(t));
          if (!n.tags.length) untagged++;
          chars += n.size;
          links += n.outlinks.length;
        }
        const since30 = Date.now() - 30 * 86400_000;
        const recent = notes.filter((n) => n.mtime >= since30).length;
        return [
          `笔记总数: ${notes.length}`,
          `目录数: ${dirs.size}`,
          `标签数: ${tagSet.size}`,
          `链接总数: ${links}`,
          `正文总字数: ${chars}`,
          `平均篇幅: ${Math.round(chars / notes.length)} 字`,
          `无标签笔记: ${untagged} 篇`,
          `近 30 天更新: ${recent} 篇`
        ].join('\n');
      }

      case 'kb_duplicates': {
        const threshold = Number(call.args.threshold) || 0.75;
        const limit = Number(call.args.limit) || 10;
        const notes = scanNotes(kbId, 600);
        const pairs: { a: string; b: string; score: number; reason: string }[] = [];

        // 1) 标题相同（最可靠的重复信号）
        const byTitle = new Map<string, string[]>();
        for (const n of notes) {
          const key = n.title.trim().toLowerCase();
          if (!key) continue;
          const list = byTitle.get(key);
          if (list) list.push(n.path);
          else byTitle.set(key, [n.path]);
        }
        for (const [, ps] of byTitle) {
          for (let i = 0; i < ps.length - 1 && pairs.length < limit; i++) {
            for (let j = i + 1; j < ps.length && pairs.length < limit; j++) {
              pairs.push({ a: ps[i], b: ps[j], score: 1, reason: '标题相同' });
            }
          }
        }

        // 2) 正文相似（字符 3-gram Jaccard）
        const grams = new Map<string, Set<string>>();
        for (const n of notes) {
          const g = charGrams(n.content);
          if (g.size >= 20) grams.set(n.path, g);
        }
        const keys = Array.from(grams.keys());
        for (let i = 0; i < keys.length && pairs.length < limit; i++) {
          for (let j = i + 1; j < keys.length && pairs.length < limit; j++) {
            const score = jaccard(grams.get(keys[i])!, grams.get(keys[j])!);
            if (score >= threshold) pairs.push({ a: keys[i], b: keys[j], score, reason: '正文高度相似' });
          }
        }

        if (!pairs.length) return '未发现明显重复的笔记。';
        return pairs
          .slice(0, limit)
          .map((p) => `- ${p.a}  <->  ${p.b}\n  相似度 ${p.score.toFixed(2)}（${p.reason}）`)
          .join('\n');
      }

      case 'kb_orphans': {
        const limit = Number(call.args.limit) || 30;
        const notes = scanNotes(kbId);
        const orphans = notes.filter((n) => n.outlinks.length === 0 && n.inlinks.length === 0 && n.tags.length === 0);
        if (!orphans.length) return '未发现孤立笔记。';
        const shown = orphans.slice(0, limit);
        return `孤立笔记 ${orphans.length} 篇（无出链、无入链、无标签）：\n${shown
          .map((n) => `- ${n.path}（${n.size} 字）`)
          .join('\n')}${orphans.length > limit ? `\n…其余 ${orphans.length - limit} 篇未列出` : ''}`;
      }

      case 'kb_tag_tree': {
        const limit = Number(call.args.limit) || 40;
        const notes = scanNotes(kbId);
        const counter = new Map<string, number>();
        let untagged = 0;
        for (const n of notes) {
          if (!n.tags.length) {
            untagged++;
            continue;
          }
          for (const t of n.tags) counter.set(t, (counter.get(t) || 0) + 1);
        }
        if (!counter.size) return `共 ${notes.length} 篇笔记，全部没有标签。`;
        const sorted = Array.from(counter.entries()).sort((a, b) => b[1] - a[1]);
        const sparse = sorted.filter(([, c]) => c === 1);
        return [
          `标签总数: ${counter.size}`,
          `无标签笔记: ${untagged} 篇`,
          '',
          '使用最多的标签：',
          ...sorted.slice(0, limit).map(([t, c]) => `- ${t}：${c} 篇`),
          '',
          `稀疏标签（仅 1 篇使用）：${sparse.length} 个${sparse.length ? ' —— ' + sparse.slice(0, 15).map(([t]) => t).join('、') : ''}`
        ].join('\n');
      }

      case 'kb_structure_review': {
        const kb = getKB(kbId);
        if (!kb) return '知识库不存在';
        const notes = scanNotes(kbId);
        const allDirs: string[] = [];
        walkDirs(kb.rootPath, '', allDirs);
        const countByDir = new Map<string, number>();
        for (const n of notes) {
          const d = n.dir || '（根目录）';
          countByDir.set(d, (countByDir.get(d) || 0) + 1);
        }
        const emptyDirs = allDirs.filter((d) => !countByDir.has(d));
        const maxDepth = allDirs.reduce((m, d) => Math.max(m, d.split('/').length), 0);
        const deepDirs = allDirs.filter((d) => d.split('/').length >= 4);
        const sorted = Array.from(countByDir.entries()).sort((a, b) => b[1] - a[1]);
        const rootCount = countByDir.get('（根目录）') || 0;
        return [
          `笔记总数: ${notes.length}`,
          `目录数: ${allDirs.length}`,
          `最大层级深度: ${maxDepth}`,
          `空目录: ${emptyDirs.length} 个${emptyDirs.length ? ' —— ' + emptyDirs.slice(0, 10).join('、') : ''}`,
          `根目录下散落笔记: ${rootCount} 篇`,
          `过深目录（≥4 层）: ${deepDirs.length} 个${deepDirs.length ? ' —— ' + deepDirs.slice(0, 8).join('、') : ''}`,
          '',
          '笔记分布（前 15）：',
          ...sorted.slice(0, 15).map(([d, c]) => `- ${d}：${c} 篇`)
        ].join('\n');
      }

      case 'kb_stale': {
        const days = Number(call.args.days) || 180;
        const limit = Number(call.args.limit) || 30;
        const notes = scanNotes(kbId);
        const ts = Date.now() - days * 86400_000;
        const stale = notes.filter((n) => n.mtime > 0 && n.mtime < ts).sort((a, b) => a.mtime - b.mtime);
        if (!stale.length) return `没有超过 ${days} 天未更新的笔记。`;
        return `${stale.length} 篇笔记超过 ${days} 天未更新：\n${stale
          .slice(0, limit)
          .map((n) => `- ${n.path}（最后更新 ${new Date(n.mtime).toLocaleDateString('zh-CN')}）`)
          .join('\n')}${stale.length > limit ? `\n…其余 ${stale.length - limit} 篇未列出` : ''}`;
      }

      default:
        return `未知工具: ${call.name}`;
    }
  } catch (e) {
    return `工具执行失败: ${String(e)}`;
  }
}
