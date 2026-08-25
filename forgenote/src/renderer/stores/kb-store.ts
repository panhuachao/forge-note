// 全局状态：知识库 + 当前笔记 + 主题 + Toast
import { create } from 'zustand';
import { useLayoutStore } from './layout-store';
import type { KBSummary, KnowledgeBase, ToastMessage, TreeNode, NoteContent, AppliedTemplate, AIModelConfig } from '@shared/types';

interface KBState {
  kbs: KBSummary[];
  activeKb: KnowledgeBase | null;
  applied: AppliedTemplate | null;
  tree: TreeNode | null;
  currentNote: { content: NoteContent; dirty: boolean } | null;
  theme: 'light' | 'dark';
  toasts: ToastMessage[];
  aiConfig: AIModelConfig;
  // actions
  setKBs: (kbs: KBSummary[]) => void;
  setActiveKb: (kb: KnowledgeBase | null) => void;
  setApplied: (t: AppliedTemplate | null) => void;
  setTree: (t: TreeNode | null) => void;
  setCurrentNote: (n: { content: NoteContent; dirty: boolean } | null) => void;
  markDirty: () => void;
  markClean: (content: string) => void;
  setTheme: (t: 'light' | 'dark') => void;
  pushToast: (t: Omit<ToastMessage, 'id'>) => void;
  removeToast: (id: string) => void;
  setAIConfig: (c: AIModelConfig) => void;
  // 新建笔记弹窗
  createNoteOpen: boolean;
  createNoteDir: string;
  openCreateNote: (dirPath?: string) => void;
  closeCreateNote: () => void;
  // 快速笔记弹窗
  quickNoteOpen: boolean;
  openQuickNote: () => void;
  closeQuickNote: () => void;
  createQuickNote: (content: string, dirId?: string) => Promise<void>;
}

export const useKBStore = create<KBState>((set) => ({
  kbs: [],
  activeKb: null,
  applied: null,
  tree: null,
  currentNote: null,
  theme: 'light',
  toasts: [],
  aiConfig: { provider: 'none' },
  setKBs: (kbs) => set({ kbs }),
  setActiveKb: (activeKb) => set({ activeKb }),
  setApplied: (applied) => set({ applied }),
  setTree: (tree) => {
    set({ tree });
    // 删除 / 移动笔记后刷新树，关闭指向已不存在笔记的多标签
    useLayoutStore.getState().pruneStaleTabs(tree);
  },
  setCurrentNote: (currentNote) => set({ currentNote }),
  markDirty: () => set((s) => (s.currentNote ? { currentNote: { ...s.currentNote, dirty: true } } : s)),
  markClean: (content) =>
    set((s) =>
      s.currentNote ? { currentNote: { content: { ...s.currentNote.content, content }, dirty: false } } : s
    ),
  setTheme: (theme) => {
    set({ theme });
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark', theme === 'dark');
    }
  },
  pushToast: (t) => {
    const id = Math.random().toString(36).slice(2);
    set((s) => ({ toasts: [...s.toasts, { id, ...t }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
    }, t.duration ?? 3000);
  },
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
  setAIConfig: (aiConfig) => set({ aiConfig }),
  // 新建笔记弹窗
  createNoteOpen: false,
  createNoteDir: '',
  openCreateNote: (dirPath?: string) => set({ createNoteOpen: true, createNoteDir: dirPath || '' }),
  closeCreateNote: () => set({ createNoteOpen: false }),
  // 快速笔记弹窗
  quickNoteOpen: false,
  openQuickNote: () => set({ quickNoteOpen: true }),
  closeQuickNote: () => set({ quickNoteOpen: false }),
  createQuickNote: async (content: string, dirId?: string) => {
    const kb = useKBStore.getState().activeKb;
    if (!kb) {
      useKBStore.getState().pushToast({ level: 'warn', text: '请先打开一个知识库' });
      return;
    }
    if (!content.trim()) {
      useKBStore.getState().pushToast({ level: 'warn', text: '请输入内容' });
      return;
    }
    try {
      // 1) 调大模型一键产出：标题 / 摘要 / 归属目录 / 标签 / 链接
      const plan = await window.forge.ai.quickNote(kb.id, content, dirId ? { dirId } : undefined);

      // 2) 在推荐目录下创建笔记
      const note = await window.forge.fs.createNote(kb.id, plan.dirName, {
        name: plan.title || '快速笔记',
        useTemplate: false
      });

      // 3) 组装笔记内容：摘要 + 原文 + 整篇正文提取 + 双向链接 + 标签 + 原始外部链接
      const links = plan.links ?? [];
      const sourceUrls = plan.sourceUrls ?? [];
      const sourceTexts = plan.sourceTexts ?? [];
      const tags = plan.tags ?? [];
      const linksBlock = links.length
        ? `\n## 相关链接\n${links.map((l) => `- [[${l}]]`).join('\n')}\n`
        : '';
      const sourceBlock = sourceUrls.length
        ? `\n## 原始链接\n${sourceUrls.map((u) => `- ${u}`).join('\n')}\n`
        : '';
      const textsBlock = sourceTexts.length
        ? `\n## 正文提取\n` +
          sourceTexts
            .map((s) => `### ${s.url}\n\n${s.text}`)
            .join('\n\n')
        : '';
      const tagsBlock = tags.length ? `\n#标签: ${tags.map((t) => `#${t}`).join(' ')}\n` : '';
      const body = `# ${plan.title}\n\n> ${plan.summary || ''}\n\n${content.trim()}${textsBlock}${linksBlock}${sourceBlock}${tagsBlock}`;
      await window.forge.fs.writeNote(kb.id, note.path, body);

      // 4) 刷新树 + 打开笔记
      const tree = await window.forge.fs.listTree(kb.id);
      set({ tree });
      useKBStore.getState().closeQuickNote();
      window.dispatchEvent(new CustomEvent('forgenote:openNote', { detail: note.path }));
      useLayoutStore.getState().setMainView('note');
      useKBStore.getState().pushToast({
        level: 'success',
        text: `已归入「${plan.dirName}」：${plan.title}`
      });
    } catch (e) {
      useKBStore.getState().pushToast({ level: 'error', text: '快速笔记失败：' + String(e) });
    }
  }
}));
