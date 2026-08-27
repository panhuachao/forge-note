// 简易 Markdown 渲染器 - 不引入第三方依赖
// 支持：标题、粗体/斜体/删除、代码、代码块、列表、任务、引用、表格、链接、wiki 链接、图片

import { useKBStore } from '../stores/kb-store';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 当前渲染上下文（由 renderMarkdownPreview 设置），供 inline() 解析资源路径使用
let _ctxKbId = '';
let _ctxCurrentPath = '';

/**
 * 将图片/资源引用解析为可预览的绝对路径。
 * - 仓库相对路径 .assets/... → file://<KB根>/.assets/...（统一资源仓库）
 * - 其它相对路径按 currentPath 所在目录向上拼接（兼容嵌套目录的 .md）
 * - 绝对路径 / http(s) 原样返回
 */
function resolveAsset(src: string): string {
  if (/^(https?:|data:|file:|blob:|forgenote-asset:)/.test(src)) return src;
  // 仓库统一资源 .assets/ 使用自定义协议，避免 Electron webSecurity 阻止 file:// 加载
  if (src.startsWith('.assets/') || src.startsWith('/.assets/')) {
    const kbId = _ctxKbId || useKBStore.getState().activeKb?.id;
    if (!kbId) return src;
    const rel = src.replace(/^\/+/, '');
    // 注意：URL host 会被规范成小写，kbId 大小写敏感，故放在 path 中而非 host
    return `forgenote-asset://asset/${kbId}/${rel.split('/').map(encodeURIComponent).join('/')}`;
  }
  // 其它相对路径：按笔记所在目录解析为 file://（若后续也有安全限制可统一迁移到 forgenote-asset）
  const root =
    useKBStore.getState().kbs.find((k) => k.id === _ctxKbId)?.rootPath ||
    useKBStore.getState().activeKb?.rootPath;
  if (!root) return src;
  if (!_ctxCurrentPath) return `file://${root.replace(/\\/g, '/')}/${src}`;
  const baseDir = _ctxCurrentPath.includes('/')
    ? _ctxCurrentPath.slice(0, _ctxCurrentPath.lastIndexOf('/'))
    : '';
  return `file://${root.replace(/\\/g, '/')}/${baseDir}/${src}`.replace(/\/\.\//g, '/');
}

function inline(text: string): string {
  // wiki 链接
  text = text.replace(/\[\[([^\[\]|]+?)(?:\|([^\[\]]+?))?\]\]/g, (_, t: string, a?: string) => {
    const name = t.trim();
    const display = (a || name).trim();
    return `<a class="wiki-link" href="#wiki=${encodeURIComponent(name)}">${escapeHtml(display)}</a>`;
  });
  // 图片：![alt](src)
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt: string, src: string) => {
    const url = resolveAsset(src.trim());
    return `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt || '')}" style="max-width:100%" />`;
  });
  // 普通链接
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  // 行内代码
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
  // 粗体
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // 斜体
  text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  // 删除
  text = text.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return text;
}

export function renderMarkdownPreview(md: string, kbId: string, currentPath: string): string {
  _ctxKbId = kbId;
  _ctxCurrentPath = currentPath;
  const lines = md.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // 代码块
    const fence = /^```(\w*)/.exec(line);
    if (fence) {
      const lang = fence[1] || '';
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      out.push(`<pre><code class="language-${lang}">${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }
    // 标题：以 1~6 个 # 开头；后面需至少一个空格与标题文本才作为标题渲染。
    // 注意：仅输入 "# " 或 "## "（有 # 有空格但还没写标题文本）时，
    // 标题正则不匹配，必须仍消费该行并推进 i，否则会落入下方段落分支的
    // "以 #{1,6}\s 开头则跳过"规则形成死循环（编辑中敲 # 后空格即卡死）。
    if (/^#{1,6}\s/.test(line)) {
      const h = /^(#{1,6})\s+(.+)$/.exec(line);
      if (h) {
        const level = h[1].length;
        const raw = h[2].trim();
        const anchor = 'h-' + i; // 行号锚点，便于大纲跳转
        out.push(
          `<h${level} id="${anchor}" data-line="${i + 1}">${inline(escapeHtml(raw))}</h${level}>`
        );
      } else {
        // 仅有 "# " 无标题文本：按普通文本渲染，避免死循环
        out.push(`<p>${inline(escapeHtml(line))}</p>`);
      }
      i++;
      continue;
    }
    // 引用
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${inline(escapeHtml(buf.join('\n')))}</blockquote>`);
      continue;
    }
    // 表格
    if (/^\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\|[\s\-:|]+\|\s*$/.test(lines[i + 1])) {
      const headers = line.split('|').slice(1, -1).map((c) => c.trim());
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) {
        rows.push(lines[i].split('|').slice(1, -1).map((c) => c.trim()));
        i++;
      }
      out.push(
        '<table><thead><tr>' +
          headers.map((h) => `<th>${inline(escapeHtml(h))}</th>`).join('') +
          '</tr></thead><tbody>' +
          rows.map((r) => '<tr>' + r.map((c) => `<td>${inline(escapeHtml(c))}</td>`).join('') + '</tr>').join('') +
          '</tbody></table>'
      );
      continue;
    }
    // 水平分割线：整行 --- / *** / ___ 渲染为 <hr>
    if (/^(\*{3,}|-{3,}|_{3,})\s*$/.test(line)) {
      out.push('<hr />');
      i++;
      continue;
    }
    // 任务列表
    const task = /^\s*-\s\[( |x|X)\]\s+(.+)$/.exec(line);
    if (task) {
      const checked = task[1].toLowerCase() === 'x';
      out.push(
        `<div class="task-list-item"><input type="checkbox" ${checked ? 'checked' : ''} disabled /> ${inline(escapeHtml(task[2]))}</div>`
      );
      i++;
      continue;
    }
    // 无序列表
    if (/^[\s]*[-*+]\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^[\s]*[-*+]\s+/.test(lines[i])) {
        buf.push(lines[i].replace(/^[\s]*[-*+]\s+/, ''));
        i++;
      }
      out.push('<ul>' + buf.map((b) => `<li>${inline(escapeHtml(b))}</li>`).join('') + '</ul>');
      continue;
    }
    // 有序列表
    if (/^\s*\d+\.\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      out.push('<ol>' + buf.map((b) => `<li>${inline(escapeHtml(b))}</li>`).join('') + '</ol>');
      continue;
    }
    // 空行
    if (line.trim() === '') {
      i++;
      continue;
    }
    // 段落
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,6}\s|```|>\s?|\s*[-*+]\s|\s*\d+\.\s|\|)/.test(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    out.push(`<p>${inline(escapeHtml(buf.join('\n')))}</p>`);
  }
  return out.join('\n');
}
