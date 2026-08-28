import { useState, useEffect, useRef } from 'react';
import { useKBStore } from '../stores/kb-store';
import { useLayoutStore } from '../stores/layout-store';
import { Icon } from './Icon';

// 文件树右键菜单请求事件。节点通过自定义事件把"打开菜单"的请求广播到全局，
// 由挂载在 App 层的 TreeContextMenuRoot 统一渲染，彻底避免组件树嵌套/Context 作用域问题。
export type TreeCtxDetail = {
  x: number;
  y: number;
  type: 'file' | 'dir';
  path: string;
  name: string;
};

export const TREE_CTX_EVENT = 'forgenote:tree_ctx';

export function TreeContextMenuRoot() {
  const { activeKb, pushToast, setTree } = useKBStore();
  const followed = useLayoutStore((s) => s.followed);
  const toggleFollow = useLayoutStore((s) => s.toggleFollow);
  const [menu, setMenu] = useState<TreeCtxDetail | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    body: string;
    danger?: boolean;
    onOk: () => void | Promise<void>;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // 监听全局右击菜单请求
  useEffect(() => {
    const onReq = (e: Event) => {
      const detail = (e as CustomEvent<TreeCtxDetail>).detail;
      setMenu(detail);
    };
    window.addEventListener(TREE_CTX_EVENT, onReq as EventListener);
    return () => window.removeEventListener(TREE_CTX_EVENT, onReq as EventListener);
  }, []);

  // 菜单显示后，点击空白 / 滚动 / 再次右击关闭（延迟注册避免自身事件误关）
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const id = setTimeout(() => {
      window.addEventListener('click', close);
      window.addEventListener('contextmenu', close);
      window.addEventListener('scroll', close, true);
      window.addEventListener('resize', close);
    }, 0);
    return () => {
      clearTimeout(id);
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [menu]);

  // 仅当菜单与确认框都不存在时才不渲染（保留确认框，避免删除时关闭菜单导致确认框丢失）
  if (!menu && !confirmDialog) return null;

  const handleDelete = () => {
    if (!activeKb) return;
    setMenu(null);
    const isRoot = menu.type === 'dir' && menu.path === '';
    const label = isRoot
      ? `整个知识库「${menu.name}」（包含全部笔记与目录）`
      : menu.type === 'file'
        ? `「${menu.name}」`
        : `目录「${menu.name}」及其全部内容`;
    setConfirmDialog({
      title: isRoot ? '⚠ 删除整个知识库' : '确认删除',
      body: `确定删除${label}？\n此操作不可恢复！`,
      danger: true,
      onOk: async () => {
        setConfirmDialog(null);
        if (isRoot) {
          setConfirmDialog({
            title: '⚠ 二次确认',
            body: `再次确认删除整个知识库「${menu.name}」？\n所有笔记 / 目录 / 配置都将被永久删除！`,
            danger: true,
            onOk: async () => {
              await doDelete();
            }
          });
          return;
        }
        await doDelete();
      }
    });

    async function doDelete() {
      try {
        if (menu.type === 'file') {
          await window.forge.fs.deleteNote(activeKb!.id, menu.path);
        } else {
          await window.forge.fs.deleteDir(activeKb!.id, menu.path);
        }
        const t = await window.forge.fs.listTree(activeKb!.id);
        setTree(t);
        pushToast({ level: 'success', text: isRoot ? '知识库已删除' : '已删除' });
      } catch (err) {
        pushToast({ level: 'error', text: String(err) });
      }
    }
  };

  return (
    <>
      {menu && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[140px] bg-content border border-border-soft rounded-md shadow-lg py-1 text-sm"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          {(() => {
            const isRoot = menu.type === 'dir' && menu.path === '';
            if (isRoot) return null;
            const list = (activeKb && followed[activeKb.id]) || [];
            const isFollowed = list.some((f) => f.path === menu.path && f.type === menu.type);
            return (
              <button
                className="w-full text-left px-3 py-1.5 hover:bg-hover-bg text-fg flex items-center gap-2"
                onClick={() => {
                  if (!activeKb) return;
                  toggleFollow(activeKb.id, { type: menu.type, path: menu.path, name: menu.name });
                  setMenu(null);
                  pushToast({ level: 'success', text: isFollowed ? '已取消关注' : '已加入关注' });
                }}
              >
                <Icon name="bookmark" className={`w-4 h-4 ${isFollowed ? 'text-brand' : ''}`} />
                {isFollowed ? '取消关注' : '关注'}
              </button>
            );
          })()}
          <button
            className="w-full text-left px-3 py-1.5 hover:bg-hover-bg text-red-500 flex items-center gap-2"
            onClick={handleDelete}
          >
            <Icon name="trash" className="w-4 h-4" />
            删除
          </button>
        </div>
      )}
      {confirmDialog && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40"
          onClick={() => setConfirmDialog(null)}
          onContextMenu={(e) => {
            e.preventDefault();
            setConfirmDialog(null);
          }}
        >
          <div
            className="bg-content border border-border-soft rounded-xl shadow-2xl p-5 min-w-[340px] max-w-[440px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-fg font-medium text-[15px] mb-2">{confirmDialog.title}</div>
            <div className="text-fg-secondary text-sm whitespace-pre-line mb-5 leading-relaxed">
              {confirmDialog.body}
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDialog(null)}
                className="h-8 px-4 rounded text-sm text-fg-secondary hover:bg-hover-bg"
              >
                取消
              </button>
              <button
                onClick={() => confirmDialog.onOk()}
                className={`h-8 px-4 rounded text-sm text-white font-medium ${
                  confirmDialog.danger ? 'bg-red-500 hover:bg-red-600' : 'bg-brand hover:bg-brand-hover'
                }`}
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
