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
  const [info, setInfo] = useState<CurrentInfo | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [linkSuggestions, setLinkSuggestions] = useState<LinkInfo[]>([]);
  const [dirSuggestions, setDirSuggestions] = useState<DirSuggestion[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const [activeLine, setActiveLine] = useState<number | null>(null);
  const [panelTab, setPanelTab] = useState<'info' | 'outline'>('info');

  // 监听正文滚动，更新大纲高亮（双向同步）
  useEffect(() => {
    const fn = (e: Event) => setActiveLine((e as CustomEvent<number>).detail);
    window.addEventListener(EVT_ACTIVE_HEADING, fn);
    return () => window.removeEventListener(EVT_ACTIVE_HEADING, fn);
  }, []);

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
    <aside className="w-72 shrink-0 border-l border-border bg-panel flex flex-col overflow-hidden">
      {/* 顶部操作区：中间 基本信息/大纲 切换，右侧 更多 */}
      <div
        className="h-14 flex items-center gap-2 px-3 border-b border-border-soft shrink-0 relative"
        style={TITLEBAR_DRAG_STYLE}
        ref={moreRef}
        onDoubleClick={handleTitleBarDoubleClick}
      >
        {/* 中间：分段切换 */}
        <div className="flex-1 flex items-center justify-center h-8 bg-panel rounded-md p-0.5 border border-border-soft" style={TITLEBAR_NO_DRAG_STYLE}>
          <button
            onClick={() => setPanelTab('info')}
            className={`h-7 px-3 rounded text-[12px] transition-colors ${panelTab === 'info' ? 'bg-content text-fg shadow-sm' : 'text-fg-muted hover:text-fg-secondary'}`}
          >
            基本信息
          </button>
          <button
            onClick={() => setPanelTab('outline')}
            className={`h-7 px-3 rounded text-[12px] transition-colors ${panelTab === 'outline' ? 'bg-content text-fg shadow-sm' : 'text-fg-muted hover:text-fg-secondary'}`}
          >
            大纲
          </button>
        </div>
        {/* 右侧：更多（合并 AI 操作） */}
        <button
          onClick={() => setMoreOpen((v) => !v)}
          className={`btn btn-ghost h-8 px-3 text-xs gap-1.5 shrink-0 ${moreOpen ? 'bg-hover-bg' : ''}`}
          style={TITLEBAR_NO_DRAG_STYLE}
        >
          <Icon name="sparkles" className="w-4 h-4 text-brand" />
          更多
          <Icon name="chevron-down" className="w-3.5 h-3.5 text-fg-faint" />
        </button>
        {moreOpen && (
          <div className="absolute right-3 top-11 z-20 mt-1 w-44 bg-content border border-border rounded-lg shadow-lg py-1">
            <MenuItem icon="sparkles" label="AI 摘要" onClick={() => runAction('summary')} loading={summaryLoading} />
            <MenuItem icon="link" label="AI 链接推荐" onClick={() => runAction('links')} />
            <MenuItem icon="folder-tree" label="AI 归纳推荐" onClick={() => runAction('dir')} />
            <MenuItem icon="cards" label="锻造知识卡片" onClick={() => runAction('forge')} />
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* 基本信息（基本信息 tab） */}
        {panelTab === 'info' && basics && (
          <div className="px-4 py-3 border-b border-border-soft">
            <h3 className="text-xs font-semibold text-fg-muted uppercase tracking-wider mb-2">基本信息</h3>
            <dl className="space-y-2 text-xs">
              <Row label="摘要">
                {summary ? (
                  <span className="text-fg-secondary leading-relaxed line-clamp-3">{summary}</span>
                ) : (
                  <span className="text-fg-faint">点击「更多 → AI 摘要」生成</span>
                )}
              </Row>
              <Row label="创建时间"><span className="text-fg-secondary">{basics.created}</span></Row>
              <Row label="最后更新"><span className="text-fg-secondary">{basics.updated}</span></Row>
              <Row label="标签">
                {basics.tags.length > 0 ? (
                  <span className="flex flex-wrap gap-1">
                    {basics.tags.map((tg) => (
                      <span key={tg} className="px-1.5 py-0.5 rounded bg-brand-soft text-brand text-[11px]">#{tg}</span>
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
          </div>
        )}

        {/* AI 链接推荐 */}
        {linkSuggestions.length > 0 && (
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-xs font-semibold text-fg-muted uppercase mb-2">AI 链接推荐</h3>
            <ul className="space-y-1.5 text-xs">
              {linkSuggestions.map((s, i) => (
                <li key={i} className="flex flex-col">
                  <span className="text-brand">→ {s.target}</span>
                  <span className="text-fg-faint text-[11px]">{s.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* AI 归纳推荐 */}
        {dirSuggestions.length > 0 && (
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-xs font-semibold text-fg-muted uppercase mb-2">AI 归纳推荐</h3>
            <ul className="space-y-1.5 text-xs">
              {dirSuggestions.map((s, i) => (
                <li key={i} className="flex flex-col">
                  <span className="text-brand">📁 {s.dirName}</span>
                  <span className="text-fg-faint text-[11px]">{s.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 大纲（大纲 tab） */}
        {panelTab === 'outline' && info && <NoteOutline content={info.content} activeLine={activeLine} />}

        {/* 双向链接 */}
        {info && (
          <LinkPanel
            kbId=""
            notePath={notePath || ''}
            inlinks={info.inlinks}
            outlinks={info.outlinks}
            broken={info.brokenLinks}
            onOpen={(p) => useLayoutStore.getState().openTab(p)}
          />
        )}
      </div>
    </aside>
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
