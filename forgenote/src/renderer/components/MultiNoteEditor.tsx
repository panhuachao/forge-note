// 多标签笔记编辑器：管理多个 NotePane，共享 AI 建议状态
// 多标签栏已移至 TopToolbar（顶部工具条）
// AI 操作通过 window.__forgeNoteActions 暴露给 TopToolbar 调用
import { useState, useEffect, useCallback } from 'react';
import { useLayoutStore } from '../stores/layout-store';
import { useKBStore } from '../stores/kb-store';
import { NotePane } from './NotePane';
import { ForgeCardModal } from './ForgeCardModal';
import { Icon } from './Icon';
import type { LinkInfo, DirSuggestion, CardDraft } from '@shared/types';

export function MultiNoteEditor() {
  const { activeKb, setTree, pushToast } = useKBStore();
  const { tabs, activeTabId } = useLayoutStore();
  const activeTab = tabs.find((t) => t.id === activeTabId);

  // 共享状态
  const [currentInfo, setCurrentInfo] = useState<{
    content: string;
    outlinks: string[];
    inlinks: string[];
    brokenLinks: string[];
    mtime: number;
    ctime: number;
    frontmatter: Record<string, unknown>;
  } | null>(null);

  const [linkSuggestions, setLinkSuggestions] = useState<LinkInfo[]>([]);
  const [dirSuggestions, setDirSuggestions] = useState<DirSuggestion[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const [forgeDraft, setForgeDraft] = useState<CardDraft | null>(null);

  useEffect(() => {
    setLinkSuggestions([]);
    setDirSuggestions([]);
    setSummary(null);
    setForgeDraft(null);
    if (!activeTab || !activeKb) {
      setCurrentInfo(null);
      return;
    }
    (async () => {
      try {
        const c = await window.forge.fs.readNote(activeKb.id, activeTab.notePath);
        setCurrentInfo({
          content: c.content,
          outlinks: c.outlinks,
          inlinks: c.inlinks,
          brokenLinks: c.brokenLinks,
          mtime: c.mtime,
          ctime: c.ctime,
          frontmatter: c.frontmatter
        });
      } catch {}
    })();
  }, [activeTabId, activeKb?.id]);

  useEffect(() => {
    const fn = (e: Event) => {
      const path = (e as CustomEvent<string>).detail;
      if (path) useLayoutStore.getState().openTab(path);
    };
    window.addEventListener('forgenote:openNote', fn);
    return () => window.removeEventListener('forgenote:openNote', fn);
  }, []);

  const onContentChange = useCallback((info: typeof currentInfo) => {
    setCurrentInfo(info);
  }, []);

  const handleSuggestLinks = useCallback(async (notePath: string) => {
    if (!activeKb) return [];
    try {
      const r = await window.forge.ai.suggestLinks(activeKb.id, notePath);
      setLinkSuggestions(r);
      return r;
    } catch (e) {
      pushToast({ level: 'error', text: String(e) });
      return [];
    }
  }, [activeKb, pushToast]);

  const handleSuggestDir = useCallback(async (notePath: string) => {
    if (!activeKb) return [];
    try {
      const r = await window.forge.ai.suggestDir(activeKb.id, notePath);
      setDirSuggestions(r);
      return r;
    } catch (e) {
      pushToast({ level: 'error', text: String(e) });
      return [];
    }
  }, [activeKb, pushToast]);

  const handleSummarize = useCallback(async (notePath: string) => {
    if (!activeKb) return '';
    const r = await window.forge.ai.summarize(activeKb.id, notePath);
    setSummary(r);
    return r;
  }, [activeKb]);

  const handleForgeCard = useCallback(async (notePath: string) => {
    if (!activeKb) throw new Error('无知识库');
    const d = await window.forge.ai.forgeCard(activeKb.id, notePath);
    setForgeDraft(d);
  }, [activeKb]);

  const handleInsertLinks = useCallback(async (notePath: string, targets: string[]) => {
    if (!activeKb) return;
    await window.forge.ai.insertLinks(activeKb.id, notePath, targets);
    setLinkSuggestions([]);
  }, [activeKb]);

  const handleMoveTo = useCallback(async (notePath: string, dir: string) => {
    if (!activeKb) return notePath;
    const newPath = await window.forge.fs.moveNote(activeKb.id, notePath, dir);
    const t = await window.forge.fs.listTree(activeKb.id);
    setTree(t);
    setDirSuggestions([]);
    return newPath;
  }, [activeKb, setTree]);

  // 暴露给 TopToolbar 调用的 AI 操作
  useEffect(() => {
    const actions = {
      summarize: (path: string) => handleSummarize(path),
      links: (path: string) => handleSuggestLinks(path),
      dir: (path: string) => handleSuggestDir(path),
      forge: (path: string) => handleForgeCard(path)
    };
    (window as any).__forgeNoteActions = actions;
    return () => {
      if ((window as any).__forgeNoteActions === actions) delete (window as any).__forgeNoteActions;
    };
  }, [handleSummarize, handleSuggestLinks, handleSuggestDir, handleForgeCard]);

  if (!activeTab) {
    return (
      <main className="flex-1 flex flex-col items-center justify-center text-fg-faint bg-canvas">
        <div className="mb-4 text-brand"><Icon name="pencil" className="w-12 h-12" /></div>
        <p className="text-sm">从左侧目录选择一篇笔记开始阅读</p>
        <p className="text-xs text-fg-faint mt-2">或点击「新建笔记」按钮开始记录</p>
      </main>
    );
  }

  return (
    <main className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 flex overflow-hidden">
        <NotePane
          notePath={activeTab.notePath}
          onOpenNote={(p) => useLayoutStore.getState().openTab(p)}
          onContentChange={onContentChange}
        />
      </div>
      <NoteDataBridge
        notePath={activeTab.notePath}
        currentInfo={currentInfo}
        linkSuggestions={linkSuggestions}
        dirSuggestions={dirSuggestions}
        summary={summary}
        onApplyLinks={handleInsertLinks}
        onApplyDir={handleMoveTo}
        onCloseSummary={() => setSummary(null)}
      />
      {forgeDraft && (
        <ForgeCardModal
          draft={forgeDraft}
          onClose={() => setForgeDraft(null)}
          onConfirm={async (target) => {
            if (!activeKb || !forgeDraft) return;
            const fileName = `${forgeDraft.title.replace(/[/\\:*?"<>|]/g, '-')}.md`;
            const newPath = await window.forge.fs.createNote(activeKb.id, target, { name: fileName, useTemplate: false });
            const content = `# ${forgeDraft.title}\n\n> 状态：${forgeDraft.status}\n> 来源：${forgeDraft.source}\n\n## 核心观点\n${forgeDraft.coreIdea}\n\n## 详细内容\n${forgeDraft.details}\n\n## 可行动项\n${forgeDraft.actionable.map((a) => `- [ ] ${a}`).join('\n')}\n\n## 验证标准\n${forgeDraft.verification}\n\n## 相关链接\n${forgeDraft.relatedLinks.map((l) => `- [[${l}]]`).join('\n')}\n`;
            await window.forge.fs.writeNote(activeKb.id, newPath.path, content);
            const orig = await window.forge.fs.readNote(activeKb.id, activeTab.notePath);
            const updated = orig.content + `\n\n> 已加工：[[${forgeDraft.title}]]\n`;
            await window.forge.fs.writeNote(activeKb.id, activeTab.notePath, updated);
            pushToast({ level: 'success', text: `已锻造并移入 ${target}` });
            setForgeDraft(null);
            window.dispatchEvent(new CustomEvent('forgenote:openNote', { detail: newPath.path }));
          }}
        />
      )}
    </main>
  );
}

function NoteDataBridge(props: {
  notePath: string;
  currentInfo: {
    content: string;
    outlinks: string[];
    inlinks: string[];
    brokenLinks: string[];
    mtime: number;
    ctime: number;
    frontmatter: Record<string, unknown>;
  } | null;
  linkSuggestions: LinkInfo[];
  dirSuggestions: DirSuggestion[];
  summary: string | null;
  onApplyLinks: (notePath: string, targets: string[]) => Promise<void>;
  onApplyDir: (notePath: string, dir: string) => Promise<string>;
  onCloseSummary: () => void;
}) {
  useEffect(() => {
    (window as any).__forgeNoteData = props;
    window.dispatchEvent(new Event('forgenote:note-data'));
    return () => {
      if ((window as any).__forgeNoteData === props) delete (window as any).__forgeNoteData;
    };
  }, [props]);
  return null;
}
