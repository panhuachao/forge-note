// 插件 UI 插槽的渲染组件（doc/插件技术实现方案.md §7.4）
//
// 每个插槽只负责：订阅注册表 → 渲染容器 div → 把容器交给插件的 render()。
// 插件用原生 DOM 操作，不接触 React，因此宿主与插件无框架版本耦合。
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { pluginSlots, type SlotKind } from '../plugin/runtime';
import { Icon, type IconName } from './Icon';

/** 订阅某个插槽的变化（配合 useSyncExternalStore） */
function useSlotItems(kind: SlotKind) {
  return useSyncExternalStore(
    (cb) => pluginSlots.subscribe(kind, cb),
    () => pluginSlots.list(kind)
  );
}

/** 单个插件容器：挂载后调用插件 render(container) */
function SlotContainer({ kind, id }: { kind: SlotKind; id: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const items = useSlotItems(kind);
  const item = items.find((i) => i.id === id);

  useEffect(() => {
    const el = ref.current;
    if (!el || !item?.render) return;
    el.innerHTML = '';
    try {
      item.render(el);
    } catch (e) {
      el.innerHTML = `<div style="font-size:11px;color:#DC2626">插件渲染出错：${String(e)}</div>`;
    }
  }, [item, kind, id]);

  return <div ref={ref} className="plugin-slot" data-slot={kind} data-slot-id={id} />;
}

/** 侧栏面板：在右侧属性区渲染所有插件注册的卡片 */
export function PluginSidebarPanels() {
  const items = useSlotItems('sidebar');
  if (!items.length) return null;
  return (
    <>
      {items.map((it) => (
        <div key={it.id} className="mx-3 my-2.5 rounded-xl bg-content border border-border-soft overflow-hidden">
          <div className="px-3.5 py-2 text-xs font-semibold text-fg-secondary flex items-center gap-1.5">
            {it.title}
            <span className="text-[9px] px-1 py-0.5 rounded bg-canvas text-fg-faint">插件</span>
          </div>
          <div className="px-3.5 pb-3">
            <SlotContainer kind="sidebar" id={it.id} />
          </div>
        </div>
      ))}
    </>
  );
}

/** 状态栏项 */
export function PluginStatusBarItems() {
  const items = useSlotItems('statusbar');
  if (!items.length) return null;
  return (
    <>
      {items.map((it) => (
        <SlotContainer key={it.id} kind="statusbar" id={it.id} />
      ))}
    </>
  );
}

/** 主菜单项插槽：渲染插件注册的主菜单按钮 */
export function PluginMenuItems({ mainView }: { mainView: string }) {
  const items = useSlotItems('menu');
  if (!items.length) return null;
  return (
    <div className="flex flex-col items-center gap-2">
      {items.map((it) => (
        <button
          key={it.id}
          onClick={it.onClick}
          title={it.title}
          className={`group relative w-11 h-11 flex items-center justify-center rounded-2xl transition-all ${
            mainView === it.id
              ? 'bg-brand-soft text-brand'
              : 'text-fg-muted hover:bg-hover-bg hover:text-fg'
          }`}
        >
          {it.icon ? (
            <Icon name={(it.icon as IconName) ?? 'sparkles'} className="w-[23px] h-[23px]" />
          ) : (
            <Icon name="sparkles" className="w-[23px] h-[23px]" />
          )}
          <span className="pointer-events-none absolute left-full ml-2 px-2.5 py-1 rounded-xl bg-canvas text-fg border border-border-soft text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-sm">
            {it.title}
            <span className="ml-1 text-[9px] px-1 py-0.5 rounded bg-canvas text-fg-faint">插件</span>
          </span>
        </button>
      ))}
    </div>
  );
}

/** 插件自定义页面：由 App.renderMain 在内置路由均未命中时渲染 */
export function PluginView({ viewId }: { viewId: string }) {
  const items = useSlotItems('view');
  const item = items.find((i) => i.id === viewId);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !item?.render) return;
    el.innerHTML = '';
    try {
      item.render(el);
    } catch (e) {
      el.innerHTML = `<div style="padding:24px;font-size:12px;color:#DC2626">插件页面渲染出错：${String(e)}</div>`;
    }
  }, [item, viewId]);

  if (!item) {
    return <div className="p-8 text-sm text-fg-faint">插件视图「{viewId}」不可用（插件可能已禁用）</div>;
  }
  return <div ref={ref} className="flex-1 overflow-auto" />;
}

/** 设置页中的插件分区：渲染所有插件注册的设置 Tab */
export function PluginSettingTabs() {
  const items = useSlotItems('settings');
  const [active, setActive] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const current = active ?? items[0]?.id;

  useEffect(() => {
    const el = ref.current;
    const item = items.find((i) => i.id === current);
    if (!el || !item?.render) return;
    el.innerHTML = '';
    try {
      item.render(el);
    } catch (e) {
      el.innerHTML = `<div style="font-size:12px;color:#DC2626">插件设置渲染出错：${String(e)}</div>`;
    }
  }, [items, current]);

  if (!items.length) return null;
  return (
    <div className="space-y-3">
      {items.length > 1 && (
        <div className="flex gap-1.5 flex-wrap">
          {items.map((it) => (
            <button
              key={it.id}
              onClick={() => setActive(it.id)}
              className={`px-2.5 py-1 rounded-lg text-xs transition-colors ${
                it.id === current
                  ? 'bg-brand-soft/60 text-brand'
                  : 'bg-hover-bg text-fg-secondary hover:bg-active-bg'
              }`}
            >
              {it.title}
            </button>
          ))}
        </div>
      )}
      <div ref={ref} />
    </div>
  );
}
