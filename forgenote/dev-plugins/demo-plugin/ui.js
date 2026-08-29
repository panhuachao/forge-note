// 示例插件 · 渲染层入口（隔离上下文，无 Node 能力）
// 验证：侧栏面板、菜单项、自定义视图、设置 Tab。
// 通过 window.forge.* 与宿主交互；require 被禁用（见 runtime.ts 中的桩）。

/** @param {import('@shared/types/plugin').PluginUIAPI} api */
module.exports.onload = (api) => {
  // 1) 侧栏面板
  api.ui.registerSidebarPanel({
    id: 'demo-sidebar',
    title: '示例面板',
    render: (container) => {
      container.innerHTML = `
        <div style="font-size:12px;color:#64748b">
          这是一个由插件渲染的侧栏卡片。插件拿到的是 DOM 容器，
          不接触宿主的 React，因此不受宿主框架升级影响。
        </div>
        <button id="demo-btn" style="margin-top:8px;padding:4px 8px;border:1px solid #e2e8f0;border-radius:6px;cursor:pointer;font-size:12px">
          点我弹提示
        </button>
      `;
      const btn = container.querySelector('#demo-btn');
      btn?.addEventListener('click', () => {
        api.ui.toast({ level: 'success', text: '来自插件的提示 ✅' });
      });
    }
  });

  // 2) 主菜单项
  api.ui.registerMenuItem({
    id: 'demo-menu',
    label: '示例插件',
    icon: 'sparkles',
    onClick: () => api.ui.toast({ level: 'info', text: '菜单项被点击' })
  });

  // 3) 自定义视图（在 MainView 路由中注册）
  api.ui.registerView({
    id: 'plugin:demo-view',
    title: '插件视图',
    render: (container) => {
      container.innerHTML = `
        <div style="padding:24px">
          <h2 style="font-size:18px;font-weight:600;margin-bottom:8px">插件自定义页面</h2>
          <p style="font-size:13px;color:#64748b">
            通过 MainView 路由机制挂载。插件 id 为 <code>plugin:demo-view</code>。
          </p>
        </div>
      `;
    }
  });

  // 4) 设置 Tab
  api.ui.registerSettingTab({
    id: 'demo-settings',
    title: '示例设置',
    render: (container) => {
      container.innerHTML = `
        <div style="font-size:13px;color:#475569">
          这里是插件自己的设置面板（占位）。真实插件可在此渲染配置表单。
        </div>
      `;
    }
  });

  api.ui.toast({ level: 'info', text: '示例插件 UI 已加载' });
};

module.exports.onunload = () => {
  // 清理由宿主自动完成（unregisterByOwner）
};
