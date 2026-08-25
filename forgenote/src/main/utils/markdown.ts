// Markdown 解析工具 - 提取 wiki 链接、FrontMatter
import matter from 'gray-matter';

const WIKI_LINK_RE = /\[\[([^\[\]|]+?)(?:\|([^\[\]]+?))?\]\]/g;

/**
 * 提取 Markdown 中的 [[wiki 链接]] 引用
 * 返回所有 target 列表（不含别名）
 */
export function extractWikiLinks(md: string): string[] {
  const result = new Set<string>();
  let m: RegExpExecArray | null;
  WIKI_LINK_RE.lastIndex = 0;
  while ((m = WIKI_LINK_RE.exec(md)) !== null) {
    result.add(m[1].trim());
  }
  return [...result];
}

/**
 * 将 [[目标|别名]] 转为 [别名](forge://note/目标) 以便渲染
 */
export function wikiLinksToHtml(md: string, resolve: (name: string) => string | undefined): string {
  return md.replace(WIKI_LINK_RE, (_, target: string, alias?: string) => {
    const name = target.trim();
    const exists = resolve(name);
    const text = (alias || name).trim();
    if (exists) {
      return `[${text}](forge://note/${encodeURIComponent(name)})`;
    }
    return `**[${text} ❌](forge://broken/${encodeURIComponent(name)})**`;
  });
}

/**
 * 解析 FrontMatter
 */
export function parseFrontMatter(raw: string): { content: string; data: Record<string, unknown> } {
  const parsed = matter(raw);
  return { content: parsed.content, data: parsed.data as Record<string, unknown> };
}

/**
 * 序列化为带 FrontMatter 的 Markdown
 */
export function serializeFrontMatter(content: string, data: Record<string, unknown>): string {
  return matter.stringify(content, data as matter.Input);
}

/**
 * 简单的标题与正文章节切分（用于 RAG 切块）
 */
export interface Chunk {
  heading: string;
  content: string;
  startLine: number;
}
export function chunkMarkdown(md: string): Chunk[] {
  const lines = md.split('\n');
  const chunks: Chunk[] = [];
  let current: Chunk = { heading: '', content: '', startLine: 0 };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = /^(#{1,3})\s+(.+)$/.exec(line);
    if (h) {
      if (current.content.trim() || current.heading) {
        chunks.push(current);
      }
      current = { heading: h[2].trim(), content: '', startLine: i };
    } else {
      current.content += line + '\n';
    }
  }
  if (current.content.trim() || current.heading) chunks.push(current);
  return chunks;
}

/**
 * 取第一行非空内容作为预览
 */
export function previewLine(md: string, max = 80): string {
  const lines = md.split('\n');
  for (const l of lines) {
    const t = l.replace(/^#+\s*/, '').trim();
    if (t) return t.length > max ? t.slice(0, max) + '…' : t;
  }
  return '';
}
