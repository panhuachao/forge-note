import { useNavigate } from 'react-router-dom';
import { useKBStore } from '../stores/kb-store';
import { FileTree } from './FileTree';
import { SearchPanel } from './SearchPanel';

export function Sidebar() {
  const nav = useNavigate();
  const { tree, activeKb, kbs, setActiveKb, setTree, setApplied, pushToast, openCreateNote } = useKBStore();

  async function handleAddKb() {
    const kb = await window.forge.kb.add();
    if (kb) {
      const list = await window.forge.kb.list();
      setActiveKb(kb);
      useKBStore.setState({ kbs: list });
      const t = await window.forge.fs.listTree(kb.id);
      setTree(t);
      const applied = await window.forge.template.applied(kb.id);
      setApplied(applied);
      pushToast({ level: 'success', text: `已添加知识库：${kb.name}` });
    }
  }

  async function handleSwitchKb(id: string) {
    await window.forge.kb.setActive(id);
    const kb = kbs.find((k) => k.id === id);
    if (kb) {
      setActiveKb({ id: kb.id, name: kb.name, rootPath: kb.rootPath, createdAt: 0, templateId: kb.templateId });
      const t = await window.forge.fs.listTree(id);
      setTree(t);
      const applied = await window.forge.template.applied(id);
      setApplied(applied);
    }
  }

  return (
    <aside className="w-64 border-r border-ink-200 bg-white flex flex-col">
      {/* 知识库切换 */}
      <div className="px-3 py-2 border-b border-ink-200">
        <div className="flex items-center justify-between">
          <select
            value={activeKb?.id || ''}
            onChange={(e) => handleSwitchKb(e.target.value)}
            className="text-sm bg-transparent border-none outline-none font-medium flex-1 truncate"
          >
            {kbs.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-0.5">
            <button onClick={() => openCreateNote()} className="icon-btn text-base" title="新建笔记">
              ✎
            </button>
            <button onClick={handleAddKb} className="icon-btn text-base" title="添加知识库">
              +
            </button>
          </div>
        </div>
        {activeKb?.templateId && (
          <div className="mt-1 text-xs text-ink-500 flex items-center gap-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-brand-600"></span>
            已应用模板：{activeKb.templateId}
          </div>
        )}
      </div>

      {/* 搜索 */}
      <SearchPanel />

      {/* 目录树 */}
      <div className="flex-1 overflow-y-auto py-1">
        {tree ? (
          <FileTree
            node={tree}
            onOpenNote={(p) => nav(`/note/${encodeURIComponent(p)}`)}
          />
        ) : (
          <div className="px-4 py-6 text-center text-ink-400 text-sm">
            {activeKb ? '加载中…' : '请先添加知识库'}
          </div>
        )}
      </div>

      {/* 底部操作栏 */}
      {activeKb && (
        <div className="px-2 py-1.5 border-t border-ink-200 flex items-center gap-1 text-xs">
          <button
            onClick={() => nav('/template')}
            className="flex-1 px-2 py-1 rounded hover:bg-ink-100 text-ink-600 text-left"
          >
            知识库模板
          </button>
          <button
            onClick={() => nav('/graph')}
            className="px-2 py-1 rounded hover:bg-ink-100 text-ink-600"
            title="知识图谱"
          >
            🌐
          </button>
        </div>
      )}
    </aside>
  );
}
