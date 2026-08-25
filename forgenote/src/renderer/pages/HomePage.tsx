import { useState, useEffect } from 'react';
import { useKBStore } from '../stores/kb-store';
import { useLayoutStore } from '../stores/layout-store';
import { AIChat } from '../components/AIChat';

export function HomePage() {
  const { activeKb, kbs, setActiveKb, setTree, setApplied, pushToast, aiConfig } = useKBStore();
  const { setMainView } = useLayoutStore();
  const [mode, setMode] = useState<'ask' | 'search'>('ask');

  // 有知识库但无 active：自动激活第一个
  useEffect(() => {
    if (!activeKb && kbs.length > 0) {
      const first = kbs[0];
      (async () => {
        await window.forge.kb.setActive(first.id);
        setActiveKb({
          id: first.id,
          name: first.name,
          rootPath: first.rootPath,
          createdAt: 0,
          templateId: first.templateId
        });
        const t = await window.forge.fs.listTree(first.id);
        setTree(t);
        const a = await window.forge.template.applied(first.id);
        setApplied(a);
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleAddKb() {
    const kb = await window.forge.kb.add();
    if (kb) {
      useKBStore.setState({ kbs: await window.forge.kb.list() });
      setActiveKb(kb);
      const t = await window.forge.fs.listTree(kb.id);
      setTree(t);
      const applied = await window.forge.template.applied(kb.id);
      setApplied(applied);
      pushToast({ level: 'success', text: `已添加知识库：${kb.name}` });
    }
  }

  // 无知识库：显示空状态
  if (kbs.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-ink-50">
        <h1 className="text-3xl font-bold text-brand-600 mb-4">锦囊笔记</h1>
        <p className="text-ink-500 mb-8 text-center max-w-md">
          一款文件优先、本地主权、开源免费的个人知识管理工具。
          <br />
          点击下方按钮，选择本地文件夹即可开始。
        </p>
        <button onClick={handleAddKb} className="btn btn-primary">
          选择文件夹，开启我的知识库
        </button>
      </div>
    );
  }

  // 有知识库但无 active：自动激活中
  if (!activeKb) {
    return <div className="flex-1 flex items-center justify-center text-ink-400">加载中…</div>;
  }

  return (
    <div className="flex-1 flex flex-col bg-ink-50">
      <div className="flex-1 flex flex-col items-center justify-center px-8">
        <h1 className="text-2xl font-bold text-brand-600 mb-2 text-center">
          我是你的锦囊笔记，
          <br />
          你来问，我来答
        </h1>
        <div className="w-full max-w-2xl mt-12">
          <div className="border-2 border-brand-600 rounded-lg bg-white overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 text-sm">
              <button
                onClick={() => setMainView('graph')}
                className="text-brand-600 hover:underline"
              >
                选择目录
              </button>
              <div className="flex items-center gap-3 text-ink-500">
                <span>模式：</span>
                <button
                  className={mode === 'ask' ? 'text-brand-600 font-medium' : 'hover:text-ink-800'}
                  onClick={() => setMode('ask')}
                >
                  问答
                </button>
                <span>/</span>
                <button
                  className={mode === 'search' ? 'text-brand-600 font-medium' : 'hover:text-ink-800'}
                  onClick={() => setMode('search')}
                >
                  检索
                </button>
              </div>
            </div>
            <div className="border-t border-ink-200">
              <AIChat mode={mode} />
            </div>
          </div>
          {aiConfig.provider === 'none' && (
            <div className="mt-4 text-center text-xs text-ink-400">
              未配置 AI 模型 · <button className="text-brand-600 hover:underline" onClick={() => setMainView('settings')}>前往设置</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
