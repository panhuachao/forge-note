import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Icon } from './Icon';
import {
  handleTitleBarDoubleClick,
  TITLEBAR_DRAG_STYLE,
  TITLEBAR_NO_DRAG_STYLE
} from '../lib/window-control';
import { NoteOutline } from './NoteOutline';
import { LinkPanel } from './LinkPanel';
import { VersionHistoryModal } from './VersionHistoryModal';
import { PluginSidebarPanels } from './PluginSlots';
import type { VersionSummary } from '@shared/types/version';
import { EVT_ACTIVE_HEADING } from './NotePane';
import { useLayoutStore } from '../stores/layout-store';
import { useKBStore, requireAI } from '../stores/kb-store';
import { NoteAIChat } from './NoteAIChat';
import { hubStructured } from '../utils/ai-hub';

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
  const { activeKb, pushToast } = useKBStore();
  const { rightPanelWidth, setRightPanelWidth } = useLayoutStore();
  const [resizing, setResizing] = useState(false);
  const [info, setInfo] = useState<CurrentInfo | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [linkSuggestions, setLinkSuggestions] = useState<LinkInfo[]>([]);
  const [dirSuggestions, setDirSuggestions] = useState<DirSuggestion[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [recordSec, setRecordSec] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordTimerRef = useRef<number | null>(null);
  // 标签编辑（本地镜像 + 写盘回写）
  const [localTags, setLocalTags] = useState<string[]>([]);
  const [tagSuggest, setTagSuggest] = useState<string[]>([]);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [tagBusy, setTagBusy] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const [activeLine, setActiveLine] = useState<number | null>(null);
  const [panelTab, setPanelTab] = useState<'info' | 'outline' | 'chat'>('info');
  const notePath = (window as any).__forgeNoteData?.notePath as string | undefined;

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
      // 摘要统一从 FrontMatter 获取（文件为真源），不依赖瞬态 AI 摘要状态
      const fm = data.currentInfo?.frontmatter || {};
      const fmSummary = (fm['summary'] ?? fm['摘要'] ?? fm['Summary']) as unknown;
      setSummary(typeof fmSummary === 'string' && fmSummary.trim() ? fmSummary.trim() : '');
    };
    read();
    read();
    window.addEventListener('forgenote:note-data', read);
    return () => window.removeEventListener('forgenote:note-data', read);
  }, []);

  // 同步当前笔记的标签到 localTags
  useEffect(() => {
    if (!info) {
      setLocalTags([]);
      return;
    }
    const fm = info.frontmatter || {};
    const fmTags = (fm['tags'] ?? fm['标签'] ?? fm['Tag'] ?? fm['TAG']) as unknown;
    let tags: string[] = [];
    if (Array.isArray(fmTags)) tags = fmTags.map(String);
    else if (typeof fmTags === 'string' && fmTags.trim()) tags = fmTags.split(/[\s,，]+/).filter(Boolean);
    setLocalTags(tags);
    // 从 frontmatter.summary 恢复摘要显示（重新打开笔记时同步）
    const fmSummary = (fm['summary'] ?? fm['摘要'] ?? fm['Summary']) as unknown;
    setSummary(typeof fmSummary === 'string' && fmSummary.trim() ? fmSummary.trim() : '');
  }, [info]);

  // 加载知识库已有标签作为下拉建议
  useEffect(() => {
    let cancelled = false;
    if (!activeKb) return;
    (async () => {
      try {
        const list = await window.forge.fs.allTags(activeKb.id);
        if (!cancelled) setTagSuggest(list.map((x) => x.tag));
      } catch {
        if (!cancelled) setTagSuggest([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeKb?.id]);

  // 写盘并刷新 currentInfo
  const persistTags = useCallback(
    async (next: string[]) => {
      if (!activeKb || !notePath) return;
      setLocalTags(next);
      try {
        const actions = (window as any).__forgeNoteActions as
          | { updateTags: (p: string, tags: string[]) => Promise<void> }
          | undefined;
        if (actions?.updateTags) {
          await actions.updateTags(notePath, next);
        } else {
          await window.forge.fs.updateTags(activeKb.id, notePath, next);
        }
      } catch (e) {
        console.error('updateTags failed', e);
      }
    },
    [activeKb, notePath]
  );

  const removeTag = (t: string) => persistTags(localTags.filter((x) => x !== t));

  const addTag = (t: string) => {
    const v = t.trim().replace(/^#/, '');
    if (!v) return;
    if (localTags.includes(v)) return;
    persistTags([...localTags, v]);
  };

  const handleAiTags = useCallback(async () => {
    if (!activeKb || !notePath) return;
    if (!requireAI()) return;
    const actions = (window as any).__forgeNoteActions as
      | { generateTags: (p: string) => Promise<string[]> }
      | undefined;
    setTagBusy(true);
    try {
      let generated: string[] = [];
      if (actions?.generateTags) {
        generated = await actions.generateTags(notePath);
      } else {
        generated = await hubStructured<string[]>({
          skill: 'generate-tags',
          input: { text: notePath, notePath },
          kbId: activeKb.id
        });
      }
      // 合并去重（已有 + 新生成，最多 8 个）
      const merged = Array.from(new Set([...localTags, ...generated])).slice(0, 8);
      await persistTags(merged);
    } catch (e) {
      console.error('generateTags failed', e);
    } finally {
      setTagBusy(false);
    }
  }, [activeKb, notePath, localTags, persistTags]);

  // 语音录入：录音 → 保存音频 → 转写 → 生成文本笔记 → 插入链接
  const startRecording = useCallback(async () => {
    if (!activeKb || !notePath) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        const buf = new Uint8Array(await blob.arrayBuffer());
        const ext = (rec.mimeType.split('/')[1] || 'webm').replace(/[^a-z0-9]/gi, '') || 'webm';
        setTranscribing(true);
        try {
          const audioRel = await window.forge.media.saveAudio(activeKb.id, buf, ext);
          const abs = (activeKb.rootPath + '/' + audioRel).replace(/\\/g, '/');
          const text = await window.forge.media.transcribe('file://' + abs);
          const transcriptRel = await window.forge.media.generateTranscriptNote(activeKb.id, audioRel, text);
          window.dispatchEvent(
            new CustomEvent('forgenote:insert-text', { detail: `\n- 🔊 语音转写： [${transcriptRel}]( ${transcriptRel})\n` })
          );
        } catch (e) {
          console.error('语音转写失败', e);
        } finally {
          setTranscribing(false);
        }
      };
      mediaRecorderRef.current = rec;
      rec.start();
      setRecording(true);
      setRecordSec(0);
      recordTimerRef.current = window.setInterval(() => setRecordSec((s) => s + 1), 1000);
    } catch (e) {
      console.error('无法访问麦克风', e);
    }
  }, [activeKb, notePath]);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
    if (recordTimerRef.current) {
      window.clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
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

  // 点击外部关闭标签下拉
  useEffect(() => {
    if (!tagPickerOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('[data-tag-picker]')) setTagPickerOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [tagPickerOpen]);

  const runAction = useCallback(async (kind: 'summary' | 'links' | 'dir' | 'forge') => {
    setMoreOpen(false);
    const actions = (window as any).__forgeNoteActions as
      | {
          summarize: (p: string) => Promise<string>;
          links: (p: string) => Promise<LinkInfo[]>;
          dir: (p: string) => Promise<DirSuggestion[]>;
          forge: (p: string) => Promise<void>;
        }
      | undefined;
    if (!actions || !notePath || !activeKb) return;
    try {
      if (kind === 'summary') {
        setSummaryLoading(true);
        const r = await actions.summarize(notePath);
        setSummary(r);
        // 生成后直接写入 frontmatter 的 summary 字段（自动保存）
        try {
          await window.forge.fs.updateSummary(activeKb.id, notePath, r);
          // 写盘后重新读取，确保当前笔记信息（含 frontmatter.summary）同步
          const fresh = await window.forge.fs.readNote(activeKb.id, notePath);
          (window as any).__forgeNoteData = {
            ...(window as any).__forgeNoteData,
            currentInfo: {
              content: fresh.content,
              outlinks: fresh.outlinks,
              inlinks: fresh.inlinks,
              brokenLinks: fresh.brokenLinks,
              mtime: fresh.mtime,
              ctime: fresh.ctime,
              frontmatter: fresh.frontmatter
            }
          };
          window.dispatchEvent(new CustomEvent('forgenote:note-data', { detail: (window as any).__forgeNoteData }));
        } catch (e) {
          console.error('保存摘要失败', e);
        }
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
  }, [notePath, activeKb?.id]);

  // 基本信息提取
  const basics = useMemo(() => {
    if (!info) return null;
    const fmt = (ts: number) => {
      if (!ts) return '—';
      const d = new Date(ts);
      const p = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    };
    // 标签：仅取自 FrontMatter 的 tags / 标签 / Tag / TAG 字段
    let tags: string[] = [];
    const fm = info.frontmatter || {};
    const fmTags = (fm['tags'] ?? fm['标签'] ?? fm['Tag'] ?? fm['TAG']) as unknown;
    if (Array.isArray(fmTags)) tags = fmTags.map(String);
    else if (typeof fmTags === 'string' && fmTags.trim()) tags = fmTags.split(/[\s,，]+/).filter(Boolean);
    return {
      created: fmt(info.ctime),
      updated: fmt(info.mtime),
      tags,
      inCount: info.inlinks.length,
      outCount: info.outlinks.length,
      brokenCount: info.brokenLinks.length
    };
  }, [info]);

  // 版本历史概览（doc/笔记版本实现方案.md §8.1）
  const [versionSummary, setVersionSummary] = useState<VersionSummary>({ count: 0, lastAt: null });
  const [versionOpen, setVersionOpen] = useState(false);
  // 防止同一个笔记生命周期内重复触发「无历史版本 → 自动创建初始版本」
  const autoInitRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!activeKb || !notePath) {
      setVersionSummary({ count: 0, lastAt: null });
      return;
    }
    let cancelled = false;
    const kbId = activeKb.id;
    void window.forge.version
      .summary(kbId, notePath)
      .then((s) => {
        if (cancelled) return;
        setVersionSummary(s);
        // 无历史版本时自动把当前内容保存为初始版本，避免用户打开弹窗看到空列表
        if (s.count === 0 && !autoInitRef.current.has(notePath)) {
          autoInitRef.current.add(notePath);
          void window.forge.version
            .create(kbId, notePath, '自动初始版本')
            .then(() => window.forge.version.summary(kbId, notePath))
            .then((fresh) => {
              if (!cancelled) setVersionSummary(fresh);
            })
            .catch(() => {
              /* 静默：版本是增值能力 */
            });
        }
      })
      .catch(() => {
        /* 静默：版本是增值能力 */
      });
    return () => {
      cancelled = true;
    };
  }, [activeKb?.id, notePath, info?.mtime]);

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
                <div className="flex items-start gap-2 min-w-0">
                  <div className="flex-1 min-w-0">
                    {summary ? (
                      <span className="text-fg-secondary leading-relaxed line-clamp-3 block">{summary}</span>
                    ) : (
                      <span className="text-fg-faint">可点击「AI生成摘要」生成</span>
                    )}
                  </div>
                  <button
                    onClick={() => runAction('summary')}
                    disabled={summaryLoading}
                    className="icon-btn shrink-0"
                    title="AI 生成摘要"
                    aria-label="AI 生成摘要"
                  >
                    <Icon name="sparkles" className={`w-3.5 h-3.5 ${summaryLoading ? 'animate-pulse' : ''}`} />
                  </button>
                </div>
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
                <div className="flex flex-col gap-1.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-1">
                    {localTags.length > 0 ? (
                      localTags.map((tg) => (
                        <span
                          key={tg}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-brand-soft text-brand text-[11px]"
                        >
                          #{tg}
                          <button
                            onClick={() => removeTag(tg)}
                            className="text-brand/70 hover:text-brand"
                            title={`删除标签 ${tg}`}
                            aria-label={`删除标签 ${tg}`}
                          >
                            ×
                          </button>
                        </span>
                      ))
                    ) : (
                      <span className="text-fg-faint text-[11px]">无</span>
                    )}
                    <div className="relative">
                      <button
                        onClick={async () => {
                          setTagPickerOpen((v) => !v);
                          setTagInput('');
                        }}
                        className="inline-flex items-center justify-center w-5 h-5 rounded-full border border-border-soft text-fg-secondary hover:bg-hover-bg text-[11px]"
                        title="添加标签"
                        aria-label="添加标签"
                      >+</button>
                      {tagPickerOpen && (
                        <div
                          data-tag-picker
                          className="absolute z-20 left-0 top-6 w-56 bg-content border border-border rounded-lg shadow-lg p-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            autoFocus
                            value={tagInput}
                            onChange={(e) => setTagInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                                if (tagInput.trim()) addTag(tagInput);
                                setTagInput('');
                                setTagPickerOpen(false);
                              } else if (e.key === 'Escape') {
                                setTagPickerOpen(false);
                              }
                            }}
                            placeholder="自定义标签，回车确认"
                            className="w-full px-2 py-1 text-[11px] bg-canvas border border-border-soft rounded outline-none focus:border-brand"
                          />
                          <div className="mt-2 max-h-40 overflow-y-auto">
                            <div className="text-[10px] text-fg-faint px-1 mb-1">已有标签</div>
                            {tagSuggest
                              .filter((s) => !localTags.includes(s))
                              .filter((s) => !tagInput || s.toLowerCase().includes(tagInput.toLowerCase()))
                              .slice(0, 30)
                              .map((s) => (
                                <button
                                  key={s}
                                  onClick={() => {
                                    addTag(s);
                                    setTagPickerOpen(false);
                                  }}
                                  className="w-full text-left px-2 py-1 text-[11px] hover:bg-hover-bg rounded text-fg-secondary"
                                >
                                  #{s}
                                </button>
                              ))}
                            {tagSuggest.filter((s) => !localTags.includes(s)).length === 0 && (
                              <div className="text-[10px] text-fg-faint px-1 py-1">无更多建议</div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={handleAiTags}
                      disabled={tagBusy}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border border-border-soft text-fg-secondary hover:bg-hover-bg text-[11px] disabled:opacity-50"
                      title="AI 生成标签"
                      aria-label="AI 生成标签"
                    >
                      <Icon name="sparkles" className={`w-3 h-3 ${tagBusy ? 'animate-pulse' : ''}`} />
                      <span>AI 生成</span>
                    </button>
                  </div>
                </div>
              </Row>
              <Row label="双链">
                <span className="text-fg-secondary">
                  入链 {basics.inCount} · 出链 {basics.outCount}
                  {basics.brokenCount > 0 && <span className="text-red-500"> · 失效 {basics.brokenCount}</span>}
                </span>
              </Row>
              {/* 版本历史入口（doc/笔记版本实现方案.md §8.1） */}
              <Row label="版本">
                {versionSummary.count === 0 ? (
                  <span className="text-fg-faint">暂无历史版本</span>
                ) : (
                  <span className="text-fg-secondary">
                    共 {versionSummary.count} 个版本
                    {versionSummary.lastAt && <span className="text-fg-faint"> · {relTime(versionSummary.lastAt)}</span>}
                  </span>
                )}
                <button
                  onClick={() => setVersionOpen(true)}
                  className="ml-1.5 text-brand hover:underline shrink-0"
                >
                  查看
                </button>
              </Row>
            </dl>
          </PanelCard>
        )}

        {/* 插件侧栏面板（doc/插件技术实现方案.md §7.4） */}
        <PluginSidebarPanels />

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

        {/* 语音录入：录音 → 自动转写 → 生成文本笔记（仅在打开笔记时显示） */}
        {activeKb && notePath && (
        <PanelCard title="语音录入">
          <div className="flex items-center gap-3">
            {!recording ? (
              <button
                onClick={startRecording}
                disabled={transcribing}
                className="group relative flex-shrink-0 w-12 h-12 rounded-full bg-fg-secondary/10 text-fg-secondary hover:bg-brand hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center"
                title={transcribing ? '转写中…' : '开始录音'}
              >
                {transcribing ? (
                  <Icon name="bolt" className="w-5 h-5 animate-spin" />
                ) : (
                  <Icon name="microphone" className="w-5 h-5 group-hover:scale-110 transition-transform" />
                )}
              </button>
            ) : (
              <button
                onClick={stopRecording}
                className="group relative flex-shrink-0 w-12 h-12 rounded-full bg-red-500 text-white shadow-lg shadow-red-500/30 flex items-center justify-center transition-all duration-200 hover:bg-red-600"
                title="停止录音"
              >
                <span className="absolute inset-0 rounded-full bg-red-400/40 animate-ping" />
                <Icon name="x-mark" className="w-5 h-5 relative z-10" />
              </button>
            )}
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-medium text-fg">
                {recording
                  ? `正在录音 ${String(Math.floor(recordSec / 60)).padStart(2, '0')}:${String(recordSec % 60).padStart(2, '0')}`
                  : transcribing
                  ? '转写中…'
                  : '点击开始语音录入'}
              </span>
              <span className="text-[11px] text-fg-faint mt-0.5 leading-tight">
                {recording
                  ? '点击红色按钮结束录音'
                  : transcribing
                  ? '正在识别语音并生成转写笔记'
                  : '录音结束后自动保存至 .assets/audio 并生成转写笔记'}
              </span>
            </div>
          </div>
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
      {/* 版本历史弹窗 */}
      {versionOpen && activeKb && notePath && (
        <VersionHistoryModal
          kbId={activeKb.id}
          notePath={notePath}
          pushToast={pushToast}
          onClose={() => setVersionOpen(false)}
          onRestored={() => {
            setVersionOpen(false);
            // 通知编辑器重新读盘（恢复后 fsChange 也会触发，这里双保险）
            window.dispatchEvent(new CustomEvent('forgenote:note-changed', { detail: notePath }));
          }}
        />
      )}
      <ResizeHandle onStart={() => setResizing(true)} />
    </aside>
  );
}

/** 相对时间：用于版本历史概览 */
function relTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  if (diff < 7 * 86400_000) return `${Math.floor(diff / 86400_000)} 天前`;
  return new Date(ts).toLocaleDateString('zh-CN');
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
