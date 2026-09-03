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
    return `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt || '')}" data-fullsrc="${escapeHtml(url)}" style="max-width:100%" />`;
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
    // 任务列表（支持 4 种状态）：[ ] 待办 / [x] 已完成 / [~] 进行中 / [-] 取消
    // 同时匹配无序列表形式 `- [ ]` / `* [ ]` / `+ [ ]`，以及有序列表形式 `1. [ ]`
    // 不在正则末尾写 $ 以容忍行尾可能残留的 \r（Windows 风格换行）
    const TASK_LINE = /^\s*(?:[-*+]|\d+\.)\s*\[([ xX~\-])\]\s+(.+)/;
    const task = TASK_LINE.exec(line);
    if (task) {
      // 连续收集相邻任务项，按列表标记类型聚合为 <ul> 或 <ol>
      const marker = /^\s*(?:[-*+]|\d+\.)\s*\[/.exec(line)![0].match(/[-*+]|\d+\./)![0];
      const isOrdered = /\d/.test(marker);
      type Item = { state: string; text: string; line: number };
      const items: Item[] = [];
      while (i < lines.length) {
        const m = TASK_LINE.exec(lines[i]);
        if (!m) break;
        const raw = m[1];
        const state =
          raw === 'x' || raw === 'X' ? 'done' : raw === '~' ? 'doing' : raw === '-' ? 'cancel' : 'todo';
        items.push({ state, text: m[2].replace(/\s+$/, ''), line: i + 1 });
        i++;
      }
      const renderItems = items
        .map(
          (it) => {
            // inline style 作为最基础保险：即使外部 css 缓存未刷新，按钮也能立刻可见
            const colors: Record<string, { bg: string; mark: string; fg: string }> = {
              todo: { bg: 'transparent', mark: 'transparent', fg: 'currentColor' },
              doing: { bg: 'rgba(59,130,246,.18)', mark: 'rgba(59,130,246,1)', fg: 'rgba(59,130,246,1)' },
              done: { bg: 'rgb(var(--c-brand,239 68 68))', mark: '#fff', fg: 'rgb(var(--c-brand,239 68 68))' },
              cancel: { bg: 'var(--c-text-faint,#9ca3af)', mark: '#fff', fg: 'var(--c-text-faint,#9ca3af)' }
            };
            const c = colors[it.state] || colors.todo;
            const inner =
              it.state === 'done'
                ? '<span style="position:absolute;left:5px;top:2px;width:6px;height:10px;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg)"></span>'
                : it.state === 'doing'
                ? '<span style="position:absolute;inset:5px;border-radius:50%;background:rgba(59,130,246,1)"></span>'
                : it.state === 'cancel'
                ? '<span style="position:absolute;left:3px;right:3px;top:50%;height:2px;background:#fff;transform:translateY(-50%)"></span>'
                : '';
            return (
              `<li><div class="task-list-item" data-task="${it.state}" data-line="${it.line}" style="display:flex;align-items:flex-start;gap:8px;margin:2px 0">` +
              `<button type="button" class="task-toggle" data-state="${it.state}" title="点击切换：待办 / 已完成 / 进行中 / 取消" ` +
              `style="position:relative;flex-shrink:0;width:18px;height:18px;margin-top:3px;border-radius:4px;border:2px solid ${c.fg};background:${c.bg};cursor:pointer;padding:0">${inner}</button>` +
              `<span class="task-text" style="flex:1;min-width:0">${inline(escapeHtml(it.text))}</span>` +
              `</div></li>`
            );
          }
        )
        .join('');
      out.push(
        (isOrdered ? '<ol>' : '<ul>') + renderItems + (isOrdered ? '</ol>' : '</ul>')
      );
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
    // 注意：停止正则里不能包含「\|」——以 | 开头但并非合法表格的行（例如
    // 孤立表头行：以 | 结尾、下一行却没有分隔行）不会命中上方 table 分支，
    // 若段落也把它当结束符，该行将无任何分支消费，外层 while 的 i 永不推进，
    // 造成死循环（表现为页面卡死 loading）。故此处只排除明确的块级结构开头，
    // 孤立表格行会作为普通段落文本吞掉并推进。
    const buf: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,6}\s|```|>\s?|\s*[-*+]\s|\s*\d+\.\s)/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    // 兜底：保证外层循环每轮至少消费一行，任何行都不可能让主循环空转（防死循环）
    if (buf.length === 0) {
      buf.push(line);
      i++;
    }
    out.push(`<p>${inline(escapeHtml(buf.join('\n')))}</p>`);
  }
  return out.join('\n');
}
