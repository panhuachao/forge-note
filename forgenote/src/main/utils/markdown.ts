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

/**
 * 读取 FrontMatter（标准字段：title/summary/tags + 中文回退：标题/概述/标签）
 * 返回标准化后的数据对象，正文与原始内容。
 */
export function readFrontmatter(raw: string): {
  data: Record<string, unknown>;
  content: string;
  title?: string;
  summary?: string;
  tags: string[];
} {
  const { content, data } = parseFrontMatter(raw);
  const title = (data['title'] ?? data['标题'] ?? data['Title'] ?? data['TITLE']) as unknown;
  const summary = (data['summary'] ?? data['概述'] ?? data['Summary'] ?? data['SUMMARY']) as unknown;
  const tagRaw = data['tags'] ?? data['标签'] ?? data['Tag'] ?? data['TAG'];
  let tags: string[] = [];
  if (Array.isArray(tagRaw)) tags = tagRaw.map(String);
  else if (typeof tagRaw === 'string' && tagRaw.trim()) tags = tagRaw.split(/[\s,，]+/).filter(Boolean);
  return {
    data,
    content,
    title: typeof title === 'string' ? title : undefined,
    summary: typeof summary === 'string' ? summary : undefined,
    tags
  };
}

/**
 * 写入/更新 FrontMatter（标准字段：title/summary/tags + 中文回退：标题/概述/标签）
 * - 仅传入的字段会被更新；未传入字段保持原值。
 * - 标题/概述：优先标准英文字段，其次中文回退字段。
 * - 标签：统一写入标准 tags 字段（数组）。
 * 返回写回后的完整 Markdown 文本。
 */
export function writeFrontmatter(
  raw: string,
  patch: { title?: string; summary?: string; tags?: string[]; extra?: Record<string, unknown> }
): string {
  const { content, data } = parseFrontMatter(raw);
  const next: Record<string, unknown> = { ...data };

  const TITLE_KEYS = ['title', '标题', 'Title', 'TITLE'];
  const SUMMARY_KEYS = ['summary', '概述', 'Summary', 'SUMMARY'];
  const TAG_KEYS = ['tags', '标签', 'Tag', 'TAG'];

  // 清理旧的标题/概述/标签相关字段，避免中英并存
  for (const k of [...TITLE_KEYS, ...SUMMARY_KEYS, ...TAG_KEYS]) delete next[k];

  // 未显式传入的字段保持原值，防止更新 tags 时冲掉 summary/title 等关键信息
  const existing = readFrontmatter(raw);
  const title = patch.title !== undefined ? patch.title : existing.title;
  const summary = patch.summary !== undefined ? patch.summary : existing.summary;
  const tags = patch.tags !== undefined ? patch.tags : existing.tags;

  if (title) next['title'] = title;
  if (summary) next['summary'] = summary;
  if (tags) {
    const norm = Array.from(new Set(tags.map((t) => String(t).trim()).filter(Boolean)));
    if (norm.length) next['tags'] = norm;
  }
  // 扩展字段（如 source 来源），直接原样写入 FrontMatter
  if (patch.extra) {
    for (const [k, v] of Object.entries(patch.extra)) next[k] = v;
  }

  return matter.stringify(content, next);
}

/**
 * 提取一篇笔记的标签：
 * 1) 优先 FrontMatter 的 tags / 标签 / Tag 字段（数组或逗号分隔字符串）
 * 2) 匹配正文中的 `# 标签: v1 v2 ...` 行
 * 3) 收集正文里散落的 `#标签`（如 `#育儿方法`）
 * 返回去重后的标签数组（不含 # 前缀）
 */
export function extractTags(raw: string): string[] {
  const tags = new Set<string>();
  let fmData: Record<string, unknown> = {};
  let content = raw;
  try {
    const parsed = matter(raw);
    fmData = (parsed.data || {}) as Record<string, unknown>;
    content = parsed.content;
  } catch {
    fmData = {};
    content = raw;
  }
  const fmTags = fmData['tags'] ?? fmData['标签'] ?? fmData['Tag'] ?? fmData['TAG'];
  if (Array.isArray(fmTags)) {
    fmTags.forEach((t) => typeof t === 'string' && t.trim() && tags.add(t.trim()));
  } else if (typeof fmTags === 'string' && fmTags.trim()) {
    fmTags
      .split(/[\s,，]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((t) => tags.add(t));
  }
  const inlineTags = raw.match(/#\s*标签\s*[:：]\s*(.+)/);
  if (inlineTags) {
    inlineTags[1]
      .split(/\s+/)
      .map((s) => s.replace(/^#/, '').trim())
      .filter(Boolean)
      .forEach((t) => tags.add(t));
  }
  // 正文散落的 #标签：兼容 Unicode 字母、数字、下划线、连字符
  const HASH_TAG_RE = /(?:^|\s)#([\p{L}\p{N}_\-]+)/gu;
  let m: RegExpExecArray | null;
  HASH_TAG_RE.lastIndex = 0;
  while ((m = HASH_TAG_RE.exec(content)) !== null) {
    const t = m[1].trim();
    if (t) tags.add(t);
  }
  return [...tags];
}
