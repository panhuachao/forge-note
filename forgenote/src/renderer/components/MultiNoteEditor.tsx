// 多标签笔记编辑器：管理多个 NotePane，共享 AI 建议状态
// 多标签栏已移至 TopToolbar（顶部工具条）
// AI 操作通过 window.__forgeNoteActions 暴露给 TopToolbar 调用
import { useState, useEffect, useCallback } from 'react';
import { useLayoutStore } from '../stores/layout-store';
import { useKBStore, requireAI } from '../stores/kb-store';
import { NotePane } from './NotePane';
import { ForgeCardModal } from './ForgeCardModal';
import { ConfirmableActionCard } from './ConfirmableActionCard';
import { Icon } from './Icon';
import { hubConfirm, hubRun, hubStructured, hubText } from '../utils/ai-hub';
import type { LinkInfo, DirSuggestion, CardDraft } from '@shared/types';
import type { ConfirmableAction } from '@shared/types/ai';

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
  // 待确认的 AI 写操作（Confirm-then-Act，doc/MCP技术实现方案.md §5.2）
  const [pendingAction, setPendingAction] = useState<ConfirmableAction | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  useEffect(() => {
    setLinkSuggestions([]);
    setPendingAction(null);
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
    if (!requireAI()) return [];
    try {
      const r = await hubStructured<LinkInfo[]>({
        skill: 'suggest-links',
        input: { text: notePath, notePath },
        kbId: activeKb.id
      });
      const list = r ?? [];
      setLinkSuggestions(list);
      return list;
    } catch (e) {
      pushToast({ level: 'error', text: String(e) });
      return [];
    }
  }, [activeKb, pushToast]);

  const handleSuggestDir = useCallback(async (notePath: string) => {
    if (!activeKb) return [];
    if (!requireAI()) return [];
    try {
      const r = await hubStructured<DirSuggestion[]>({
        skill: 'suggest-dir',
        input: { text: notePath, notePath },
        kbId: activeKb.id
      });
      const list = r ?? [];
      setDirSuggestions(list);
      return list;
    } catch (e) {
      pushToast({ level: 'error', text: String(e) });
      return [];
    }
  }, [activeKb, pushToast]);

  const handleSummarize = useCallback(async (notePath: string) => {
    if (!activeKb) return '';
    if (!requireAI()) return '';
    const r = await hubText({ skill: 'summarize', input: { text: notePath, notePath }, kbId: activeKb.id });
    setSummary(r);
    return r;
  }, [activeKb]);

  // AI 生成标签（合并去重已有 + 新标签，最多 8 个）
  const handleGenerateTags = useCallback(async (notePath: string) => {
    if (!activeKb) return [];
    if (!requireAI()) return [];
    const generated = await hubStructured<string[]>({
      skill: 'generate-tags',
      input: { text: notePath, notePath },
      kbId: activeKb.id
    });
    // 重新读取笔记以获取最新 tags + frontmatter
    const fresh = await window.forge.fs.readNote(activeKb.id, notePath);
    setCurrentInfo({
      content: fresh.content,
      outlinks: fresh.outlinks,
      inlinks: fresh.inlinks,
      brokenLinks: fresh.brokenLinks,
      mtime: fresh.mtime,
      ctime: fresh.ctime,
      frontmatter: fresh.frontmatter
    });
    return generated;
  }, [activeKb]);

  // 更新笔记的 frontmatter tags；写盘后重新 readNote 同步 currentInfo
  const handleUpdateTags = useCallback(async (notePath: string, tags: string[]) => {
    if (!activeKb) return;
    await window.forge.fs.updateTags(activeKb.id, notePath, tags);
    const fresh = await window.forge.fs.readNote(activeKb.id, notePath);
    setCurrentInfo({
      content: fresh.content,
      outlinks: fresh.outlinks,
      inlinks: fresh.inlinks,
      brokenLinks: fresh.brokenLinks,
      mtime: fresh.mtime,
      ctime: fresh.ctime,
      frontmatter: fresh.frontmatter
    });
  }, [activeKb]);

  // 把当前 AI 摘要写入 frontmatter（便于固定为笔记摘要）
  const handleApplySummary = useCallback(async (notePath: string, s: string) => {
    if (!activeKb) return;
    await window.forge.fs.updateSummary(activeKb.id, notePath, s);
    const fresh = await window.forge.fs.readNote(activeKb.id, notePath);
    setCurrentInfo({
      content: fresh.content,
      outlinks: fresh.outlinks,
      inlinks: fresh.inlinks,
      brokenLinks: fresh.brokenLinks,
      mtime: fresh.mtime,
      ctime: fresh.ctime,
      frontmatter: fresh.frontmatter
    });
  }, [activeKb]);

  const handleForgeCard = useCallback(async (notePath: string) => {
    if (!activeKb) throw new Error('无知识库');
    if (!requireAI()) throw new Error('请先配置 AI 模型');
    const d = await hubStructured<CardDraft>({
      skill: 'forge-card',
      input: { text: notePath, notePath },
      kbId: activeKb.id
    });
    setForgeDraft(d);
  }, [activeKb]);

  /**
   * 插入双链：先经 AIHub 生成修改预览（pending），渲染确认卡片，用户确认后才写盘。
   * 改造前直接调用 window.forge.ai.insertLinks 落盘，无任何确认环节
   * （P0 安全收敛 · doc/AI智能管家重构方案.md §5.1）。
   */
  const handleInsertLinks = useCallback(
    async (notePath: string, targets: string[]) => {
      if (!activeKb || targets.length === 0) return;
      if (!requireAI()) return;
      try {
        const res = await hubRun({
          skill: 'insert-links',
          input: { text: notePath, notePath, targets },
          kbId: activeKb.id
        });
        if (res.kind === 'structured' && res.pending && res.data) {
          setPendingAction(res.data as ConfirmableAction);
          return;
        }
        // 未产出待确认建议（如链接已全部存在），按提示处理
        pushToast({ level: 'info', text: res.kind === 'text' ? res.text : '无需插入' });
      } catch (e) {
        pushToast({ level: 'error', text: String(e) });
      }
    },
    [activeKb, pushToast]
  );

  /** 用户确认执行待确认操作：走主进程 actionService，执行的是预览过的那一版 */
  const confirmPending = useCallback(async () => {
    const action = pendingAction;
    const notePath = activeTab?.notePath ?? '';
    if (!activeKb || !action) return;
    setActionBusy(true);
    try {
      const res = await hubConfirm(
        { skill: 'insert-links', input: { text: notePath, notePath }, kbId: activeKb.id },
        action
      );
      pushToast({ level: 'success', text: res.kind === 'text' ? res.text : '已应用修改' });
      setPendingAction(null);
      setLinkSuggestions([]);
    } catch (e) {
      pushToast({ level: 'error', text: '执行失败：' + String(e) });
    } finally {
      setActionBusy(false);
    }
  }, [activeKb, activeTab?.notePath, pendingAction, pushToast]);

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
      forge: (path: string) => handleForgeCard(path),
      // 标签 / 摘要写盘
      generateTags: (path: string) => handleGenerateTags(path),
      updateTags: (path: string, tags: string[]) => handleUpdateTags(path, tags),
      applySummary: (path: string, s: string) => handleApplySummary(path, s)
    };
    (window as any).__forgeNoteActions = actions;
    return () => {
      if ((window as any).__forgeNoteActions === actions) delete (window as any).__forgeNoteActions;
    };
  }, [handleSummarize, handleSuggestLinks, handleSuggestDir, handleForgeCard, handleGenerateTags, handleUpdateTags, handleApplySummary]);

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
      {pendingAction && (
        <div className="border-t border-fg-faint/20 bg-canvas p-3">
          <ConfirmableActionCard
            action={pendingAction}
            busy={actionBusy}
            onConfirm={confirmPending}
            onCancel={() => setPendingAction(null)}
          />
        </div>
      )}
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
