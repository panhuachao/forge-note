import { useState, useMemo } from 'react';
import { EVT_JUMP_HEADING } from './NotePane';

interface Props {
  content: string;
  activeLine?: number | null;
  onJump?: (line: number) => void;
}

interface Heading {
  level: number;
  text: string;
  line: number;
}

/**
 * 大纲面板
 * - 紧凑字体 / 1.55 行距
 * - 同级辅助线（每个层级的左侧细竖线）
 * - 可折叠：点击父标题前的 chevron 折叠其所有子级
 * - 整行 hover 出现浅色底，点击跳转到对应行
 */
export function NoteOutline({ content, activeLine, onJump }: Props) {
  const headings: Heading[] = useMemo(() => {
    const list: Heading[] = [];
    content.split('\n').forEach((l, i) => {
      const m = /^(#{1,6})\s+(.+)$/.exec(l);
      if (m) list.push({ level: m[1].length, text: m[2], line: i + 1 });
    });
    return list;
  }, [content]);

  // 判断每个 heading 是否"有后代"（用于显示折叠按钮）
  const hasChildren = useMemo(() => {
    const set = new Set<number>();
    for (let i = 0; i < headings.length; i++) {
      for (let j = i + 1; j < headings.length; j++) {
        if (headings[j].level > headings[i].level) {
          set.add(headings[i].line);
          break;
        } else {
          break;
        }
      }
    }
    return set;
  }, [headings]);

  // 折叠状态：line -> collapsed
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  // 可见列表：过滤掉在某个折叠祖先后代中的项
  const visible: Heading[] = useMemo(() => {
    if (collapsed.size === 0) return headings;
    const out: Heading[] = [];
    const stack: { level: number; line: number }[] = [];
    for (const h of headings) {
      // 弹出比当前更深的祖先
      while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
      // 栈中是否有折叠的祖先
      const blocked = stack.some((a) => collapsed.has(a.line));
      if (!blocked) out.push(h);
      stack.push({ level: h.level, line: h.line });
    }
    return out;
  }, [headings, collapsed]);

  if (headings.length === 0)
    return (
      <div className="px-3 py-6 text-center text-fg-faint text-xs">
        本篇还没有标题，添加 <code className="px-1 rounded bg-hover-bg"># 标题</code> 后自动生成大纲
      </div>
    );

  const toggle = (line: number) => {
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(line)) next.delete(line);
      else next.add(line);
      return next;
    });
  };

  return (
    <div className="px-1.5 py-1">
      <ul className="relative text-[12.5px] leading-[1.6] text-fg-secondary">
        {visible.map((h) => {
          const indent = (h.level - 1) * 12;
          const isCollapsible = hasChildren.has(h.line);
          const isCollapsed = collapsed.has(h.line);
          const active = activeLine === h.line;
          return (
            <li key={`${h.line}-${h.text}`} className="group relative">
              {/* 同级辅助线：在该 heading 左侧的细竖线 */}
              {h.level > 1 && (
                <span
                  className="absolute top-0 bottom-0 border-l border-border-soft pointer-events-none"
                  style={{ left: indent - 5 }}
                  aria-hidden
                />
              )}
              <div
                className={`flex items-center gap-1 cursor-pointer rounded-md pr-2 py-1 transition-colors relative ${
                  active
                    ? 'bg-brand-soft/60 text-brand font-medium shadow-[inset_2px_0_0_var(--brand)]'
                    : 'hover:bg-hover-bg'
                }`}
                style={{ paddingLeft: indent }}
                onClick={() => {
                  if (onJump) onJump(h.line);
                  else window.dispatchEvent(new CustomEvent(EVT_JUMP_HEADING, { detail: h.line }));
                }}
                title={h.text}
              >
                {/* 折叠按钮 / 占位符（保持对齐） */}
                {isCollapsible ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(h.line);
                    }}
                    className="w-3.5 h-3.5 flex items-center justify-center text-fg-faint hover:text-fg-secondary shrink-0 -ml-1"
                    title={isCollapsed ? '展开' : '折叠'}
                    aria-label={isCollapsed ? '展开' : '折叠'}
                  >
                    <svg
                      viewBox="0 0 12 12"
                      className={`w-3 h-3 transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
                    >
                      <path d="M4 2 L8 6 L4 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                ) : (
                  <span className="w-2.5 h-3.5 shrink-0" />
                )}
                <span
                  className={`truncate group-hover:text-fg ${
                    h.level === 1 ? 'font-semibold text-fg' : ''
                  }`}
                >
                  {h.text}
                </span>
                {active && (
                  <span className="ml-auto text-[10px] text-brand opacity-0 group-hover:opacity-100">跳转</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
