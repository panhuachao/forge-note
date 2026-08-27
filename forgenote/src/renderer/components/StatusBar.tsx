// 底部状态栏 - 仿 Obsidian 风格
// 左侧：知识库名称 + 管理按钮 + wordmark（点击切换主页）
// 右侧：当前笔记的字数 / 字符数
import { useKBStore } from '../stores/kb-store';
import { useLayoutStore } from '../stores/layout-store';
import { useMemo, useState } from 'react';
import { Icon } from './Icon';
import { KbManagerModal } from './KbManagerModal';

export function StatusBar() {
  const { activeKb, tree } = useKBStore();
  const { tabs, setMainView } = useLayoutStore();
  const [managerOpen, setManagerOpen] = useState(false);

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

  return (
    <>
      <div className="h-7 flex items-center justify-between px-3.5 text-[11px] text-fg-muted border-t border-border-soft bg-toolbar select-none">
        {/* 左侧：知识库信息 + 管理按钮 + wordmark */}
        <div className="flex items-center gap-2.5">
          {activeKb && (
            <>
              <span className="font-medium text-fg-secondary truncate max-w-[160px]" title={activeKb.name}>
                {activeKb.name}
              </span>
              <span className="w-1 h-1 rounded-full bg-fg-faint shrink-0" />
              <span>{noteText} 条笔记</span>
            </>
          )}
          <button
            onClick={() => setManagerOpen(true)}
            className="icon-btn"
            title="管理知识库"
            aria-label="管理知识库"
          >
            <Icon name="cog" className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setMainView('home')}
            className="font-semibold text-fg-secondary hover:text-brand"
            title="返回首页"
          >
            forgenote
          </button>
        </div>
        {/* 中间：产品愿景 */}
        <div className="flex-1 flex items-center justify-center px-4 min-w-0">
          <span
            className="text-fg-faint italic truncate"
            title="在 AI 时代,不做 AI 的奴隶,而让 AI 帮助自己成长。"
          >
            在 AI 时代,不做 AI 的奴隶,而让 AI 帮助自己成长。
          </span>
        </div>
        {/* 右侧：字数统计 + 标签数 */}
        <div className="flex items-center gap-2.5">
          {stats && (
            <>
              <span>{stats.words} 词</span>
              <span className="w-1 h-1 rounded-full bg-fg-faint shrink-0" />
              <span>{stats.total} 字符</span>
            </>
          )}
          {stats && <span className="w-1 h-1 rounded-full bg-fg-faint shrink-0" />}
          <span className="text-fg-faint">{tabs.length} 标签</span>
        </div>
      </div>
      <KbManagerModal open={managerOpen} onClose={() => setManagerOpen(false)} />
    </>
  );
}
