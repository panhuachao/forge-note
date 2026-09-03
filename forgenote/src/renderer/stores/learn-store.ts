// 主题学习渲染层状态：会话列表、当前会话、列表刷新
import { create } from 'zustand';
import type { LearningSession, LearnSessionSummary } from '@shared/types/learn';

interface LearnState {
  sessions: LearnSessionSummary[];
  active: LearningSession | null;
  loadingList: boolean;
  listError: string;
  loadList: () => Promise<void>;
  openSession: (id: string) => Promise<void>;
  setActive: (s: LearningSession | null) => void;
  clearActive: () => void;
  removeSession: (id: string) => Promise<void>;
}

export const useLearnStore = create<LearnState>((set, get) => ({
  sessions: [],
  active: null,
  loadingList: false,
  listError: '',
  loadList: async () => {
    set({ loadingList: true, listError: '' });
    try {
      const s = await window.forge.learn.list();
      set({ sessions: s });
    } catch (e) {
      set({ listError: String(e) });
    } finally {
      set({ loadingList: false });
    }
  },
  openSession: async (id: string) => {
    const s = await window.forge.learn.get(id);
    set({ active: s });
  },
  setActive: (s) => set({ active: s }),
  clearActive: () => set({ active: null }),
  removeSession: async (id: string) => {
    await window.forge.learn.remove(id);
    if (get().active?.id === id) set({ active: null });
    await get().loadList();
  }
}));
