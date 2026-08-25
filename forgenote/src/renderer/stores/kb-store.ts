// 全局状态：知识库 + 当前笔记 + 主题 + Toast
import { create } from 'zustand';
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
  setTree: (tree) => set({ tree }),
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
  closeCreateNote: () => set({ createNoteOpen: false })
}));
