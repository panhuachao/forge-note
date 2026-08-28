import { useLayoutStore } from '../stores/layout-store';
import { useKBStore } from '../stores/kb-store';

/** 把 [[笔记名]] 解析为笔记路径（遍历目录树，方案 §三.2） */
export async function resolveWikiLink(name: string): Promise<string | null> {
  const { activeKb } = useKBStore.getState();
  if (!activeKb) return null;
  // 规范化：去掉可能残留的 .md 后缀（AI 输出常带后缀），统一按"无后缀名"比对。
  const target = name.replace(/\.md$/i, '').trim();
  try {
    const tree = await window.forge.fs.listTree(activeKb.id);
    let hit: string | null = null;
    const walk = (nodes: any[]) => {
      for (const n of nodes) {
        if (hit) return;
        if (n.kind === 'file' && n.name.replace(/\.md$/i, '').trim() === target) {
          hit = n.path;
          return;
        }
        if (n.children) walk(n.children);
      }
    };
    walk(tree?.children ?? []);
    return hit;
  } catch {
    return null;
  }
}

/** 跳转/打开笔记：解析到则打开对应笔记，否则退化为全局搜索 */
export async function openWikiLink(name: string): Promise<void> {
  const { openTab, setMainView } = useLayoutStore.getState();
  const path = await resolveWikiLink(name);
  if (path) {
    openTab(path);
    setMainView('note');
  } else {
    window.dispatchEvent(new CustomEvent('forgenote:search', { detail: { q: name } }));
  }
}
