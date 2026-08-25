// 布局状态：主菜单视图、打开的标签、面板宽度、折叠状态、排序
import { create } from 'zustand';
import type { TreeNode } from '@shared/types';

export type MainView = 'note' | 'graph' | 'template' | 'audit' | 'settings' | 'home' | 'chat' | 'search-results' | 'tag-notes';
export type TreeView = 'tree' | 'tags';
export type SortMode = 'name' | 'mtime' | 'created';

export interface OpenTab {
  id: string; // 唯一 id
  notePath: string;
  title: string;
  active: boolean;
  dirty?: boolean;
}

interface LayoutState {
  // 主菜单列当前选中
  mainView: MainView;
  // 顶部视图选项卡（目录/搜索/标签）
  treeView: TreeView;
  // 打开的笔记标签
  tabs: OpenTab[];
  activeTabId: string | null;
  // 面板宽度（持久化到 localStorage）
  leftRailCollapsed: boolean; // 主菜单列是否完全隐藏
  leftPanelWidth: number; // 目录树宽度
  rightPanelWidth: number; // 右侧属性面板宽度
  // 排序
  sortMode: SortMode;
  // 各面板是否折叠
  leftPanelCollapsed: boolean;
  rightPanelCollapsed: boolean;
  // 当前选中的标签（用于标签笔记检索视图）
  selectedTag: string | null;
  // actions
  setMainView: (v: MainView) => void;
  setTreeView: (v: TreeView) => void;
  setSortMode: (s: SortMode) => void;
  setSelectedTag: (tag: string | null) => void;
  toggleLeftRail: () => void;
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  setLeftPanelWidth: (w: number) => void;
  setRightPanelWidth: (w: number) => void;
  openTab: (notePath: string, title?: string) => void;
  closeTab: (id: string) => void;
  closeTabByPath: (notePath: string) => void;
  pruneStaleTabs: (tree: TreeNode | null) => void;
  setActiveTab: (id: string) => void;
  markTabDirty: (id: string, dirty: boolean) => void;
  closeAllTabs: () => void;
}

const STORAGE_KEY = 'forgenote:layout';

interface PersistedLayout {
  leftPanelWidth: number;
  rightPanelWidth: number;
  leftPanelCollapsed: boolean;
  rightPanelCollapsed: boolean;
  leftRailCollapsed: boolean;
  sortMode: SortMode;
}

function loadPersisted(): PersistedLayout {
  if (typeof localStorage === 'undefined')
    return { leftPanelWidth: 260, rightPanelWidth: 280, leftPanelCollapsed: false, rightPanelCollapsed: false, leftRailCollapsed: false, sortMode: 'name' };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { leftPanelWidth: 260, rightPanelWidth: 280, leftPanelCollapsed: false, rightPanelCollapsed: false, leftRailCollapsed: false, sortMode: 'name' };
    const v = JSON.parse(raw);
    return {
      leftPanelWidth: v.leftPanelWidth ?? 260,
      rightPanelWidth: v.rightPanelWidth ?? 280,
      leftPanelCollapsed: !!v.leftPanelCollapsed,
      rightPanelCollapsed: !!v.rightPanelCollapsed,
      leftRailCollapsed: !!v.leftRailCollapsed,
      sortMode: v.sortMode ?? 'name'
    };
  } catch {
    return { leftPanelWidth: 260, rightPanelWidth: 280, leftPanelCollapsed: false, rightPanelCollapsed: false, leftRailCollapsed: false, sortMode: 'name' };
  }
}

function savePersisted(s: PersistedLayout) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {}
}

export const useLayoutStore = create<LayoutState>((set, get) => {
  const persisted = loadPersisted();
  return {
    mainView: 'note',
    treeView: 'tree',
    tabs: [],
    activeTabId: null,
    leftRailCollapsed: persisted.leftRailCollapsed,
    leftPanelWidth: persisted.leftPanelWidth,
    rightPanelWidth: persisted.rightPanelWidth,
    sortMode: persisted.sortMode,
    leftPanelCollapsed: persisted.leftPanelCollapsed,
    rightPanelCollapsed: persisted.rightPanelCollapsed,
    selectedTag: null,
    setMainView: (v) => set({ mainView: v }),
    setSelectedTag: (tag) => set({ selectedTag: tag }),
    setTreeView: (v) => set({ treeView: v }),
    setSortMode: (s) => {
      set({ sortMode: s });
      const cur = get();
      savePersisted({
        leftPanelWidth: cur.leftPanelWidth,
        rightPanelWidth: cur.rightPanelWidth,
        leftPanelCollapsed: cur.leftPanelCollapsed,
        rightPanelCollapsed: cur.rightPanelCollapsed,
        leftRailCollapsed: cur.leftRailCollapsed,
        sortMode: s
      });
    },
    toggleLeftRail: () => {
      const v = !get().leftRailCollapsed;
      set({ leftRailCollapsed: v });
      const cur = get();
      savePersisted({
        leftPanelWidth: cur.leftPanelWidth,
        rightPanelWidth: cur.rightPanelWidth,
        leftPanelCollapsed: cur.leftPanelCollapsed,
        rightPanelCollapsed: cur.rightPanelCollapsed,
        leftRailCollapsed: v,
        sortMode: cur.sortMode
      });
    },
    toggleLeftPanel: () => {
      const v = !get().leftPanelCollapsed;
      set({ leftPanelCollapsed: v });
      const cur = get();
      savePersisted({
        leftPanelWidth: cur.leftPanelWidth,
        rightPanelWidth: cur.rightPanelWidth,
        leftPanelCollapsed: v,
        rightPanelCollapsed: cur.rightPanelCollapsed,
        leftRailCollapsed: cur.leftRailCollapsed,
        sortMode: cur.sortMode
      });
    },
    toggleRightPanel: () => {
      const v = !get().rightPanelCollapsed;
      set({ rightPanelCollapsed: v });
      const cur = get();
      savePersisted({
        leftPanelWidth: cur.leftPanelWidth,
        rightPanelWidth: cur.rightPanelWidth,
        leftPanelCollapsed: cur.leftPanelCollapsed,
        rightPanelCollapsed: v,
        leftRailCollapsed: cur.leftRailCollapsed,
        sortMode: cur.sortMode
      });
    },
    setLeftPanelWidth: (w) => {
      const clamped = Math.max(180, Math.min(500, w));
      set({ leftPanelWidth: clamped });
      const cur = get();
      savePersisted({
        leftPanelWidth: clamped,
        rightPanelWidth: cur.rightPanelWidth,
        leftPanelCollapsed: cur.leftPanelCollapsed,
        rightPanelCollapsed: cur.rightPanelCollapsed,
        leftRailCollapsed: cur.leftRailCollapsed,
        sortMode: cur.sortMode
      });
    },
    setRightPanelWidth: (w) => {
      const clamped = Math.max(200, Math.min(500, w));
      set({ rightPanelWidth: clamped });
      const cur = get();
      savePersisted({
        leftPanelWidth: cur.leftPanelWidth,
        rightPanelWidth: clamped,
        leftPanelCollapsed: cur.leftPanelCollapsed,
        rightPanelCollapsed: cur.rightPanelCollapsed,
        leftRailCollapsed: cur.leftRailCollapsed,
        sortMode: cur.sortMode
      });
    },
    openTab: (notePath, title) => {
      const tabs = get().tabs;
      const exist = tabs.find((t) => t.notePath === notePath);
      if (exist) {
        set({
          tabs: tabs.map((t) => ({ ...t, active: t.id === exist.id })),
          activeTabId: exist.id
        });
      } else {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const newTab: OpenTab = {
          id,
          notePath,
          title: title || notePath.split('/').pop()?.replace(/\.md$/i, '') || '未命名',
          active: true
        };
        set({
          tabs: [...tabs.map((t) => ({ ...t, active: false })), newTab],
          activeTabId: id
        });
      }
    },
    closeTab: (id) => {
      const tabs = get().tabs.filter((t) => t.id !== id);
      let activeTabId = get().activeTabId;
      if (activeTabId === id) {
        activeTabId = tabs.length ? tabs[tabs.length - 1].id : null;
      }
      set({ tabs, activeTabId });
    },
    closeTabByPath: (notePath) => {
      const tabs = get().tabs;
      const target = tabs.find((t) => t.notePath === notePath);
      if (!target) return;
      const remaining = tabs.filter((t) => t.id !== target.id);
      let activeTabId = get().activeTabId;
      if (activeTabId === target.id) {
        activeTabId = remaining.length ? remaining[remaining.length - 1].id : null;
      }
      set({ tabs: remaining, activeTabId });
    },
    pruneStaleTabs: (tree) => {
      if (!tree) return;
      const live = new Set<string>();
      const walk = (n: TreeNode) => {
        if (n.kind === 'file') live.add(n.path);
        n.children?.forEach(walk);
      };
      walk(tree);
      const tabs = get().tabs;
      const stale = tabs.filter((t) => !live.has(t.notePath));
      if (stale.length === 0) return; // 无失效标签，无需处理
      const staleIds = new Set(stale.map((t) => t.id));
      const remaining = tabs.filter((t) => !staleIds.has(t.id));
      let activeTabId = get().activeTabId;
      if (activeTabId && staleIds.has(activeTabId)) {
        activeTabId = remaining.length ? remaining[remaining.length - 1].id : null;
      }
      set({ tabs: remaining, activeTabId });
    },
    setActiveTab: (id) => {
      set({
        tabs: get().tabs.map((t) => ({ ...t, active: t.id === id })),
        activeTabId: id
      });
    },
    markTabDirty: (id, dirty) => {
      set({
        tabs: get().tabs.map((t) => (t.id === id ? { ...t, dirty } : t))
      });
    },
    closeAllTabs: () => set({ tabs: [], activeTabId: null })
  };
});
