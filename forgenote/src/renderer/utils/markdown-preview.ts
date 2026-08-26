// 简易 Markdown 渲染器 - 不引入第三方依赖
// 支持：标题、粗体/斜体/删除、代码、代码块、列表、任务、引用、表格、链接、wiki 链接

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inline(text: string): string {
  // wiki 链接
  text = text.replace(/\[\[([^\[\]|]+?)(?:\|([^\[\]]+?))?\]\]/g, (_, t: string, a?: string) => {
    const name = t.trim();
    const display = (a || name).trim();
    return `<a class="wiki-link" href="#wiki=${encodeURIComponent(name)}">${escapeHtml(display)}</a>`;
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
