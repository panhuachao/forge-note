import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Icon } from './Icon';
import {
  handleTitleBarDoubleClick,
  TITLEBAR_DRAG_STYLE,
  TITLEBAR_NO_DRAG_STYLE
} from '../lib/window-control';
import { NoteOutline } from './NoteOutline';
import { LinkPanel } from './LinkPanel';
import { EVT_ACTIVE_HEADING } from './NotePane';
import { useLayoutStore } from '../stores/layout-store';
import { useKBStore } from '../stores/kb-store';
import { NoteAIChat } from './NoteAIChat';

interface LinkInfo {
  target: string;
  targetPath?: string;
  kind: 'flow' | 'semantic';
  reason: string;
  score: number;
}
interface DirSuggestion {
  dirId: string;
  dirName: string;
  reason: string;
}
interface CurrentInfo {
  content: string;
  outlinks: string[];
  inlinks: string[];
  brokenLinks: string[];
  mtime: number;
  ctime: number;
  frontmatter: Record<string, unknown>;
}

export function RightPanel() {
  const { activeKb } = useKBStore();
  const { rightPanelWidth, setRightPanelWidth } = useLayoutStore();
  const [resizing, setResizing] = useState(false);
  const [info, setInfo] = useState<CurrentInfo | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [linkSuggestions, setLinkSuggestions] = useState<LinkInfo[]>([]);
  const [dirSuggestions, setDirSuggestions] = useState<DirSuggestion[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const [activeLine, setActiveLine] = useState<number | null>(null);
  const [panelTab, setPanelTab] = useState<'info' | 'outline' | 'chat'>('info');

  // 监听正文滚动，更新大纲高亮（双向同步）
  useEffect(() => {
    const fn = (e: Event) => setActiveLine((e as CustomEvent<number>).detail);
    window.addEventListener(EVT_ACTIVE_HEADING, fn);
    return () => window.removeEventListener(EVT_ACTIVE_HEADING, fn);
  }, []);

  // 拖拽调整右侧面板宽度
  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: MouseEvent) => {
      // 面板在右侧，宽度 = 窗口右边缘 - 鼠标 x
      setRightPanelWidth(Math.max(220, Math.min(480, window.innerWidth - e.clientX)));
    };
    const onUp = () => setResizing(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [resizing, setRightPanelWidth]);

  useEffect(() => {
    const read = () => {
      const bridge = (window as any).__forgeNoteData;
      const data = bridge as
        | {
            notePath: string;
            currentInfo: CurrentInfo | null;
            linkSuggestions: LinkInfo[];
            dirSuggestions: DirSuggestion[];
            summary: string | null;
            onApplyLinks: (notePath: string, targets: string[]) => Promise<void>;
            onApplyDir: (notePath: string, dir: string) => Promise<string>;
            onCloseSummary: () => void;
          }
        | undefined;
      if (!data) return;
      setInfo(data.currentInfo);
      setLinkSuggestions(data.linkSuggestions || []);
      setDirSuggestions(data.dirSuggestions || []);
      setSummary(data.summary);
    };
    read();
    window.addEventListener('forgenote:note-data', read);
    return () => window.removeEventListener('forgenote:note-data', read);
  }, []);

  // 点击外部关闭更多菜单
  useEffect(() => {
    if (!moreOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [moreOpen]);

  const notePath = (window as any).__forgeNoteData?.notePath as string | undefined;

  const runAction = useCallback(async (kind: 'summary' | 'links' | 'dir' | 'forge') => {
    setMoreOpen(false);
    const actions = (window as any).__forgeNoteActions as
      | { summarize: (p: string) => Promise<string>; links: (p: string) => Promise<LinkInfo[]>; dir: (p: string) => Promise<DirSuggestion[]>; forge: (p: string) => Promise<void> }
      | undefined;
    if (!actions || !notePath) return;
    try {
      if (kind === 'summary') {
        setSummaryLoading(true);
        const r = await actions.summarize(notePath);
        setSummary(r);
        setSummaryLoading(false);
      } else if (kind === 'links') {
        await actions.links(notePath);
      } else if (kind === 'dir') {
        await actions.dir(notePath);
      } else if (kind === 'forge') {
        await actions.forge(notePath);
      }
    } catch (e) {
      setSummaryLoading(false);
    }
  }, [notePath]);

  // 基本信息提取
  const basics = useMemo(() => {
    if (!info) return null;
    const fmt = (ts: number) => {
      if (!ts) return '—';
      const d = new Date(ts);
      const p = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    };
    // 标签：优先 frontmatter，其次内容中的 #标签: 行
    let tags: string[] = [];
    const fm = info.frontmatter || {};
    const fmTags = (fm['tags'] ?? fm['标签'] ?? fm['Tag'] ?? fm['TAG']) as unknown;
    if (Array.isArray(fmTags)) tags = fmTags.map(String);
    else if (typeof fmTags === 'string' && fmTags.trim()) tags = fmTags.split(/[\s,，]+/).filter(Boolean);
    if (tags.length === 0) {
      const m = info.content.match(/#\s*标签\s*[:：]\s*(.+)/);
      if (m) tags = m[1].split(/\s+/).map((s) => s.replace(/^#/, '')).filter(Boolean);
    }
    return {
      created: fmt(info.ctime),
      updated: fmt(info.mtime),
      tags,
      inCount: info.inlinks.length,
      outCount: info.outlinks.length,
      brokenCount: info.brokenLinks.length
    };
  }, [info]);

  return (
    <aside
      style={{ width: rightPanelWidth }}
      className="shrink-0 relative border-l border-border-soft bg-panel flex flex-col overflow-hidden"
    >
      {/* 顶部操作区：中间 基本信息/大纲 切换，右侧 更多 */}
      <div
        className="h-12 flex items-center gap-2 px-3 border-b border-border-soft shrink-0 relative"
        style={TITLEBAR_DRAG_STYLE}
        ref={moreRef}
        onDoubleClick={handleTitleBarDoubleClick}
      >
        {/* 左侧：基本信息 / 大纲 图标（无切换边框，靠左排序） */}
        <div className="flex-1 flex items-center gap-1" style={TITLEBAR_NO_DRAG_STYLE}>
          <button
            onClick={() => setPanelTab('info')}
            title="基本信息"
            aria-label="基本信息"
            className={`h-8 w-8 inline-flex items-center justify-center rounded-xl transition-colors ${panelTab === 'info' ? 'bg-brand-soft text-brand' : 'text-fg-muted hover:text-fg-secondary hover:bg-hover-bg'}`}
          >
            <Icon name="bars-3-center-left" className="w-4 h-4" />
          </button>
          <button
            onClick={() => setPanelTab('outline')}
            title="大纲"
            aria-label="大纲"
            className={`h-8 w-8 inline-flex items-center justify-center rounded-xl transition-colors ${panelTab === 'outline' ? 'bg-brand-soft text-brand' : 'text-fg-muted hover:text-fg-secondary hover:bg-hover-bg'}`}
          >
            <Icon name="list-bullet" className="w-4 h-4" />
          </button>
          {/* 第三位置：围绕本篇笔记的 AI 聊天 */}
          <button
            onClick={() => setPanelTab('chat')}
            title="AI 笔记对话"
            aria-label="AI 笔记对话"
            className={`h-8 w-8 inline-flex items-center justify-center rounded transition-colors ${
              panelTab === 'chat' ? 'bg-brand-soft text-brand' : 'text-fg-muted hover:text-fg-secondary hover:bg-hover-bg'
            }`}
          >
            <Icon name="chat-bubble" className="w-4 h-4" />
          </button>
        </div>
        {/* 右侧：更多（合并 AI 操作，仅 sparkles 图标） */}
        <button
          onClick={() => setMoreOpen((v) => !v)}
          title="更多"
          aria-label="更多"
          className={`h-8 w-8 inline-flex items-center justify-center rounded text-brand transition-colors ${moreOpen ? 'bg-hover-bg' : 'hover:bg-hover-bg'}`}
          style={TITLEBAR_NO_DRAG_STYLE}
        >
          <Icon name="sparkles" className="w-4 h-4 text-brand" />
        </button>
        {moreOpen && (
          <div className="absolute right-3 top-11 z-20 mt-1 w-44 bg-content border border-border rounded-xl shadow-lg py-1">
            <MenuItem icon="sparkles" label="AI 摘要" onClick={() => runAction('summary')} loading={summaryLoading} />
            <MenuItem icon="link" label="AI 链接推荐" onClick={() => runAction('links')} />
            <MenuItem icon="folder-tree" label="AI 归纳推荐" onClick={() => runAction('dir')} />
            <MenuItem icon="cards" label="锻造知识卡片" onClick={() => runAction('forge')} />
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        {panelTab === 'chat' ? (
          notePath && activeKb ? (
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              <div className="h-9 shrink-0 flex items-center gap-1.5 px-3 bg-panel/60 text-xs text-fg-muted">
                <Icon name="chat-bubble" className="w-3.5 h-3.5 text-brand" />
                <span className="truncate">对话上下文：{notePath.split('/').pop()}</span>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">
                <NoteAIChat
                  kbId={activeKb.id}
                  notePath={notePath}
                  onAppend={(text) => {
                    window.dispatchEvent(
                      new CustomEvent('forgenote:append-note', { detail: { text } })
                    );
                  }}
                />
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-fg-faint text-xs">
              请先打开一篇笔记
            </div>
          )
        ) : panelTab === 'outline' ? (
          info ? (
            <div className="flex-1 overflow-y-auto py-2">
              <PanelCard title="大纲" defaultOpen>
                <NoteOutline content={info.content} activeLine={activeLine} />
              </PanelCard>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-fg-faint text-xs">
              暂无大纲
            </div>
          )
        ) : (
          <div className="flex-1 overflow-y-auto">
            {/* 基本信息（默认 tab） */}
        {basics && (
          <PanelCard title="基本信息">
            <dl className="space-y-2.5 text-xs">
              <Row label="摘要">
                {summary ? (
                  <span className="text-fg-secondary leading-relaxed line-clamp-3">{summary}</span>
                ) : (
                  <span className="text-fg-faint">点击「更多 → AI 摘要」生成</span>
                )}
              </Row>
              <Row label="创建时间"><span className="text-fg-secondary">{basics.created}</span></Row>
              <Row label="最后更新"><span className="text-fg-secondary">{basics.updated}</span></Row>
              <Row label="路径">
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="font-mono text-[11px] text-fg-secondary truncate" title={notePath}>
                    {notePath || '—'}
                  </span>
                  <button
                    onClick={() => notePath && navigator.clipboard?.writeText(notePath)}
                    className="icon-btn shrink-0"
                    title="复制路径"
                    aria-label="复制路径"
                  >
                    <Icon name="copy" className="w-3 h-3" />
                  </button>
                </span>
              </Row>
              <Row label="标签">
                {basics.tags.length > 0 ? (
                  <span className="flex flex-wrap gap-1">
                    {basics.tags.map((tg) => (
                      <span key={tg} className="px-1.5 py-0.5 rounded-full bg-brand-soft text-brand text-[11px]">#{tg}</span>
                    ))}
                  </span>
                ) : (
                  <span className="text-fg-faint">无</span>
                )}
              </Row>
              <Row label="双链">
                <span className="text-fg-secondary">
                  入链 {basics.inCount} · 出链 {basics.outCount}
                  {basics.brokenCount > 0 && <span className="text-red-500"> · 失效 {basics.brokenCount}</span>}
                </span>
              </Row>
            </dl>
          </PanelCard>
        )}

        {/* AI 链接推荐 */}
        {linkSuggestions.length > 0 && (
          <PanelCard title="AI 链接推荐">
            <ul className="space-y-1.5 text-xs">
              {linkSuggestions.map((s, i) => (
                <li key={i} className="flex flex-col">
                  <span className="text-brand">→ {s.target}</span>
                  <span className="text-fg-faint text-[11px]">{s.reason}</span>
                </li>
              ))}
            </ul>
          </PanelCard>
        )}

        {/* AI 归纳推荐 */}
        {dirSuggestions.length > 0 && (
          <PanelCard title="AI 归纳推荐">
            <ul className="space-y-1.5 text-xs">
              {dirSuggestions.map((s, i) => (
                <li key={i} className="flex flex-col">
                  <span className="text-brand">📁 {s.dirName}</span>
                  <span className="text-fg-faint text-[11px]">{s.reason}</span>
                </li>
              ))}
            </ul>
          </PanelCard>
        )}

        {/* 双向链接 */}
        {info && (
          <PanelCard title="双向链接">
            <LinkPanel
              kbId=""
              notePath={notePath || ''}
              inlinks={info.inlinks}
              outlinks={info.outlinks}
              broken={info.brokenLinks}
              embedded
              onOpen={(p) => useLayoutStore.getState().openTab(p)}
            />
          </PanelCard>
        )}
      </div>
        )}
      </div>
      <ResizeHandle onStart={() => setResizing(true)} />
    </aside>
  );
}

function ResizeHandle({ onStart }: { onStart: () => void }) {
  return (
    <div
      onMouseDown={onStart}
      className="absolute top-0 left-0 w-1 h-full cursor-col-resize hover:bg-brand/30 z-10"
      title="拖动调整宽度"
    />
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-14 shrink-0 text-fg-muted">{label}</dt>
      <dd className="flex-1 min-w-0">{children}</dd>
    </div>
  );
}

/** 可折叠卡片：圆角白底 + 阴影 + 点击标题展开/收起 */
function PanelCard({
  title,
  defaultOpen = true,
  children
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mx-3 my-2.5 rounded-xl bg-content border border-border-soft shadow-[0_1px_2px_rgba(17,24,39,0.04),0_4px_12px_rgba(17,24,39,0.05)] overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3.5 py-2.5 text-xs font-semibold text-fg-secondary hover:text-fg transition-colors"
      >
        <Icon
          name={open ? 'chevron-down' : 'chevron-right'}
          className="w-3.5 h-3.5 text-fg-faint"
        />
        <span className="uppercase tracking-wider">{title}</span>
      </button>
      {open && <div className="px-3.5 pb-3.5 pt-0.5">{children}</div>}
    </div>
  );
}

function MenuItem({ icon, label, onClick, loading }: { icon: string; label: string; onClick: () => void; loading?: boolean }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-fg-secondary hover:bg-hover-bg hover:text-fg transition-colors"
    >
      <Icon name={icon} className="w-4 h-4 text-brand" />
      <span>{label}</span>
      {loading && <Icon name="bolt" className="w-3.5 h-3.5 ml-auto animate-spin text-fg-faint" />}
    </button>
  );
}
