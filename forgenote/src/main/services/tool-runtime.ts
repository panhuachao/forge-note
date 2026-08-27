// MCP 工具运行时（本地知识库工具）见 doc/AI调用重构技术方案.md §6.2
// 以 MCP 工具形态暴露知识库能力，供模型在推理中主动调用（检索/读/写/诊断）。
import { fsService } from './fs-service';
import { searchService } from './search-service';
import { linkIndex } from './link-index';
import { aiService } from './ai-service';
import { auditService } from './audit-service';
import { getKB } from './store';
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
  }
];

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

/** 执行一个工具调用，返回面向模型的文本结果 */
export async function executeTool(call: ToolCall, ctx: ToolCtx): Promise<string> {
  const kbId = ctx.kbId;
  try {
    switch (call.name) {
      case 'kb_search': {
        const hits = await searchService.query(kbId, String(call.args.query || ''), { limit: Number(call.args.limit) || 8 });
        if (!hits.length) return '未检索到相关笔记。';
        return hits
          .map((h) => `### [[${h.noteName}]]\n路径: ${h.notePath}\n片段: ${h.snippet}`)
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
      default:
        return `未知工具: ${call.name}`;
    }
  } catch (e) {
    return `工具执行失败: ${String(e)}`;
  }
}
