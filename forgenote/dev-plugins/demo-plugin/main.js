// 示例插件 · 主进程入口（CommonJS）
// 验证：命令注册、存储读写、AI 调用、版本记录。
// 注意：运行在主进程，但仅通过宿主装配的 API 访问能力（不裸用 require）。

let callCount = 0;

/** @param {import('@shared/types/plugin').PluginAPI} api */
/** @param {import('@shared/types/plugin').PluginContext} ctx */
module.exports.onload = async (api, ctx) => {
  ctx.log.info('示例插件已加载，pluginId =', api.pluginId);

  // 1) 命令面板：插入时间戳
  api.commands.register('insert-timestamp', {
    title: '示例插件：插入时间戳',
    hotkey: 'Ctrl+Shift+T',
    handler: async () => {
      callCount++;
      await api.storage.set('lastRun', Date.now());
      api.ui.toast({ level: 'success', text: `已记录运行次数：${callCount}` });
      ctx.log.info('命令执行，累计', callCount);
    }
  });

  // 2) AI 调用示例（需 ai:call 权限）
  api.commands.register('ask-ai', {
    title: '示例插件：问 AI 一句话',
    handler: async () => {
      const kb = (await api.kb.list())[0];
      if (!kb) {
        api.ui.toast({ level: 'warn', text: '没有可用的知识库' });
        return;
      }
      const r = await api.ai.run({
        skillId: 'ask',
        kbId: kb.id,
        input: { text: '用一句话告诉我什么是知识管理' }
      });
      api.ui.toast({ level: 'info', text: (r.text || '').slice(0, 60) });
    }
  });

  // 3) 版本记录示例（需 fs:write，此处仅查询）
  api.commands.register('list-versions', {
    title: '示例插件：列出当前笔记版本',
    handler: async (cmdCtx) => {
      const kb = (await api.kb.list())[0];
      if (!kb || !cmdCtx.notePath) {
        api.ui.toast({ level: 'warn', text: '请先打开一篇笔记' });
        return;
      }
      const versions = await api.version.list(kb.id, cmdCtx.notePath);
      api.ui.toast({ level: 'info', text: `共 ${versions.length} 个版本` });
    }
  });

  ctx.log.info('示例插件 onload 完成');
};

module.exports.onunload = async (api, ctx) => {
  ctx.log.info('示例插件已卸载');
};
