// 底部状态栏 - 仿 Obsidian 风格
// 左侧：知识库切换 + wordmark（点击切换主页）
// 右侧：当前笔记的字数 / 字符数
import { useKBStore } from '../stores/kb-store';
import { useLayoutStore } from '../stores/layout-store';
import { useMemo } from 'react';

export function StatusBar() {
  const { activeKb, tree, kbs, setKBs, setActiveKb, setTree, setApplied, pushToast } = useKBStore();
  const { tabs, setMainView } = useLayoutStore();

  const noteCount = tree?.noteCount || 0;
  const noteText = noteCount >= 10000
    ? `${(noteCount / 10000).toFixed(1)}万`
    : `${noteCount}`;

  const stats = useMemo(() => {
    const data = (window as any).__forgeNoteData;
    if (!data?.currentInfo?.content) return null;
    const c: string = data.currentInfo.content;
    const cn = (c.match(/[\u4e00-\u9fa5]/g) || []).length;
    const en = (c.match(/[a-zA-Z]/g) || []).length;
    return { total: c.length, cn, en, words: cn + en };
  }, [useLayoutStore.getState().activeTabId]);

  async function handleAddKb() {
    const kb = await window.forge.kb.add();
    if (kb) {
      setKBs(await window.forge.kb.list());
      setActiveKb(kb);
      const t = await window.forge.fs.listTree(kb.id);
      setTree(t);
      const a = await window.forge.template.applied(kb.id);
      setApplied(a);
      pushToast({ level: 'success', text: `已添加知识库：${kb.name}` });
    }
  }

  async function handleSwitchKb(id: string) {
    const k = kbs.find((x) => x.id === id);
    if (!k) return;
    await window.forge.kb.setActive(id);
    setActiveKb({ id: k.id, name: k.name, rootPath: k.rootPath, createdAt: 0, templateId: k.templateId });
    const t = await window.forge.fs.listTree(id);
    setTree(t);
    const a = await window.forge.template.applied(id);
    setApplied(a);
  }

  return (
    <div className="h-7 flex items-center justify-between px-3 text-[11px] text-ink-500 border-t border-ink-200 bg-ink-100 select-none">
      {/* 左侧：知识库切换 + wordmark */}
      <div className="flex items-center gap-2">
        {activeKb && (
          <>
            <select
              value={activeKb.id}
              onChange={(e) => handleSwitchKb(e.target.value)}
              className="text-[11px] bg-transparent border border-ink-200 rounded px-1.5 py-0.5 outline-none max-w-[160px] truncate"
              title="切换知识库"
            >
              {kbs.map((k) => (
                <option key={k.id} value={k.id}>{k.name}</option>
              ))}
            </select>
            <button
              onClick={handleAddKb}
              className="icon-btn text-xs"
              title="新建知识库"
            >＋</button>
            <span className="text-ink-300">|</span>
            <span>{noteText} 条笔记</span>
            <span className="text-ink-300">|</span>
          </>
        )}
        <button
          onClick={() => setMainView('home')}
          className="font-semibold text-ink-600 hover:text-brand-600"
          title="返回首页"
        >
          forgenote
        </button>
      </div>
      {/* 右侧：字数统计 + 标签数 */}
      <div className="flex items-center gap-2">
        {stats && (
          <>
            <span>{stats.words} 词</span>
            <span className="text-ink-300">|</span>
            <span>{stats.total} 字符</span>
            <span className="text-ink-300">|</span>
          </>
        )}
        <span className="text-ink-300">{tabs.length} 标签</span>
      </div>
    </div>
  );
}
