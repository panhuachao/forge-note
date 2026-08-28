// 布局状态：主菜单视图、打开的标签、面板宽度、折叠状态、排序
import { create } from 'zustand';
import type { TreeNode } from '@shared/types';

export type MainView = 'note' | 'graph' | 'template' | 'audit' | 'settings' | 'home' | 'chat' | 'search-results' | 'tag-notes' | 'inspiration' | 'diagnose';
export type TreeView = 'tree' | 'tags';
export type SortMode = 'name' | 'mtime' | 'created';
export type FontSizeKey = 'sm' | 'md' | 'lg';
export type LineHeightKey = 'sm' | 'md' | 'lg';
export type ThemeColorKey = 'red' | 'blue' | 'green' | 'purple' | 'amber' | 'teal';

export interface OpenTab {
  id: string; // 唯一 id
  notePath: string;
  title: string;
  active: boolean;
  dirty?: boolean;
}

// 关注项：目录或笔记。按 kbId 隔离，存于 localStorage。
export interface FollowedItem {
  type: 'file' | 'dir';
  path: string; // 目录用 path；笔记也用 path
  name: string; // 用于显示
  addedAt: number;
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
  // 专注模式：同时收起左右栏
  focusMode: boolean;
  // 当前选中的标签（用于标签笔记检索视图）
  selectedTag: string | null;
  // 右侧属性面板是否展开「围绕本篇笔记的 AI 聊天」
  chatWithNote: boolean;
  // 外观样式：字体大小 / 行间距（小/中/大，持久化）
  fontSize: FontSizeKey;
  lineHeight: LineHeightKey;
  // 外观样式：主题色（持久化）
  themeColor: ThemeColorKey;
  // 关注列表（按 kbId 隔离，持久化）
  followed: Record<string, FollowedItem[]>;
  // actions
  setMainView: (v: MainView) => void;
  setTreeView: (v: TreeView) => void;
  setSortMode: (s: SortMode) => void;
  setSelectedTag: (tag: string | null) => void;
  setChatWithNote: (v: boolean) => void;
  setFontSize: (v: FontSizeKey) => void;
  setLineHeight: (v: LineHeightKey) => void;
  setThemeColor: (v: ThemeColorKey) => void;
  toggleLeftRail: () => void;
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  toggleFocusMode: () => void;
  setLeftPanelWidth: (w: number) => void;
  setRightPanelWidth: (w: number) => void;
  openTab: (notePath: string, title?: string) => void;
  closeTab: (id: string) => void;
  closeTabByPath: (notePath: string) => void;
  pruneStaleTabs: (tree: TreeNode | null) => void;
  toggleFollow: (kbId: string, item: Omit<FollowedItem, 'addedAt'>) => void;
  removeFollow: (kbId: string, path: string) => void;
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
  fontSize: FontSizeKey;
  lineHeight: LineHeightKey;
  themeColor: ThemeColorKey;
  followed?: Record<string, FollowedItem[]>;
}

function loadPersisted(): PersistedLayout {
  const def: PersistedLayout = {
    leftPanelWidth: 260, rightPanelWidth: 280, leftPanelCollapsed: false, rightPanelCollapsed: false,
    leftRailCollapsed: false, sortMode: 'name', fontSize: 'md', lineHeight: 'md', themeColor: 'red'
  };
  if (typeof localStorage === 'undefined') return def;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return def;
    const v = JSON.parse(raw);
    return {
      leftPanelWidth: v.leftPanelWidth ?? 260,
      rightPanelWidth: v.rightPanelWidth ?? 280,
      leftPanelCollapsed: !!v.leftPanelCollapsed,
      rightPanelCollapsed: !!v.rightPanelCollapsed,
      leftRailCollapsed: !!v.leftRailCollapsed,
      sortMode: v.sortMode ?? 'name',
      fontSize: (v.fontSize === 'md' || v.fontSize === 'lg' ? v.fontSize : 'sm') as FontSizeKey,
      lineHeight: (v.lineHeight === 'md' || v.lineHeight === 'lg' ? v.lineHeight : 'sm') as LineHeightKey,
      themeColor: (['red', 'blue', 'green', 'purple', 'amber', 'teal'].includes(v.themeColor) ? v.themeColor : 'red') as ThemeColorKey,
      followed: (v.followed && typeof v.followed === 'object') ? v.followed : {}
    };
  } catch {
    return def;
  }
}

function savePersisted(s: PersistedLayout) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {}
}

// 保存当前完整持久化布局（避免部分字段覆盖导致其它字段丢失）
function persistAll(get: () => LayoutState) {
  const s = get();
  savePersisted({
    leftPanelWidth: s.leftPanelWidth,
    rightPanelWidth: s.rightPanelWidth,
    leftPanelCollapsed: s.leftPanelCollapsed,
    rightPanelCollapsed: s.rightPanelCollapsed,
    leftRailCollapsed: s.leftRailCollapsed,
    sortMode: s.sortMode,
    fontSize: s.fontSize,
    lineHeight: s.lineHeight,
    themeColor: s.themeColor,
    followed: s.followed
  });
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
    focusMode: false,
    selectedTag: null,
    chatWithNote: false,
    fontSize: persisted.fontSize,
    lineHeight: persisted.lineHeight,
    themeColor: persisted.themeColor,
    followed: persisted.followed ?? {},
    setMainView: (v) => set({ mainView: v }),
    setSelectedTag: (tag) => set({ selectedTag: tag }),
    setChatWithNote: (v) => set({ chatWithNote: v }),
    setFontSize: (v) => {
      set({ fontSize: v });
      persistAll(get);
    },
    setLineHeight: (v) => {
      set({ lineHeight: v });
      persistAll(get);
    },
    setThemeColor: (v) => {
      set({ themeColor: v });
      persistAll(get);
    },
    setTreeView: (v) => set({ treeView: v }),
    setSortMode: (s) => {
      set({ sortMode: s });
      persistAll(get);
    },
    toggleLeftRail: () => {
      const v = !get().leftRailCollapsed;
      set({ leftRailCollapsed: v });
      persistAll(get);
    },
    toggleLeftPanel: () => {
      const v = !get().leftPanelCollapsed;
      set({ leftPanelCollapsed: v });
      persistAll(get);
    },
    toggleRightPanel: () => {
      const v = !get().rightPanelCollapsed;
      set({ rightPanelCollapsed: v });
      persistAll(get);
    },
    toggleFocusMode: () => {
      const next = !get().focusMode;
      // 专注模式：同时收起左右栏；退出：同时展开左右栏
      set({ focusMode: next, leftPanelCollapsed: next, rightPanelCollapsed: next });
      persistAll(get);
    },
    setLeftPanelWidth: (w) => {
      const clamped = Math.max(180, Math.min(500, w));
      set({ leftPanelWidth: clamped });
      persistAll(get);
    },
    setRightPanelWidth: (w) => {
      const clamped = Math.max(200, Math.min(500, w));
      set({ rightPanelWidth: clamped });
      persistAll(get);
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
    closeAllTabs: () => set({ tabs: [], activeTabId: null }),
    toggleFollow: (kbId, item) => {
      const cur = get().followed[kbId] ?? [];
      const exists = cur.findIndex((x) => x.path === item.path && x.type === item.type);
      let nextList: FollowedItem[];
      if (exists >= 0) {
        nextList = cur.filter((_, i) => i !== exists);
      } else {
        nextList = [...cur, { ...item, addedAt: Date.now() }];
      }
      const followed = { ...get().followed, [kbId]: nextList };
      set({ followed });
      persistAll(get);
    },
    removeFollow: (kbId, path) => {
      const cur = get().followed[kbId] ?? [];
      const nextList = cur.filter((x) => x.path !== path);
      const followed = { ...get().followed, [kbId]: nextList };
      set({ followed });
      persistAll(get);
    }
  };
});
