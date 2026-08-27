// Electron 主进程入口
import { app, BrowserWindow, shell, Menu, ipcMain } from 'electron';
import { join } from 'path';
import { initStore, listKBs, getConfig } from './services/store';
import { registerIpcHandlers } from './ipc';
import { startWatching, stopAll, bootstrapIndex } from './services/watcher';
import { kbService } from './services/kb-service';
import { initAutoUpdater } from './services/updater';

let mainWindow: BrowserWindow | null = null;

const isDev = !app.isPackaged;

// 开发模式下为 win/linux 显式指定图标（mac 由 dock 决定，无需）
function resolveIcon(): string | undefined {
  if (process.platform === 'darwin') return undefined;
  if (process.platform === 'win32') return join(__dirname, '../../resources/icons/icon.ico');
  return join(__dirname, '../../resources/icons/icon.png');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: '锦囊笔记 ForgeNote',
    icon: resolveIcon(),
    backgroundColor: '#fafaf9',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 14 },
    show: false, // 先隐藏，等 ready-to-show 再显示，避免白屏闪烁
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false, // 需要 chokidar / fs 在 main，不影响渲染层
      nodeIntegration: false
    }
  });

  // 渲染进程准备好后显示窗口，避免加载未完成时露出白屏
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });
  // 兜底：渲染加载完成后也显示（应对 ready-to-show 因渲染层错误而永远不触发的极端情况）
  mainWindow.webContents.once('did-finish-load', () => {
    mainWindow?.show();
  });
  // 终极兜底：3 秒内无论如何强制显示，避免窗口永久不可见
  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      console.warn('[window] 兜底强制显示窗口（ready-to-show 超过 3 秒未触发）');
      mainWindow.show();
    }
  }, 3000);

  // 加载失败时记录到主进程控制台，并展示错误页（打包应用也能在 /Applications 启动日志中查看）
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[window] did-fail-load', code, desc, url);
    const html = `data:text/html;charset=utf-8,${encodeURIComponent(
      `<div style="font-family:-apple-system,'PingFang SC',sans-serif;padding:32px;color:#b91c1c"><h2>窗口加载失败</h2><pre style="white-space:pre-wrap">code=${code}\n${desc}\nurl=${url}</pre></div>`
    )}`;
    mainWindow?.loadURL(html);
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[window] render-process-gone', details);
    const html = `data:text/html;charset=utf-8,${encodeURIComponent(
      `<div style="font-family:-apple-system,'PingFang SC',sans-serif;padding:32px;color:#b91c1c"><h2>渲染进程崩溃</h2><pre style="white-space:pre-wrap">${JSON.stringify(details)}</pre></div>`
    )}`;
    mainWindow?.loadURL(html);
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  // 外链默认走系统浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ]
      : []),
    {
      label: '文件',
      submenu: [
        {
          label: '新建笔记',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow?.webContents.send('menu:newNote')
        },
        {
          label: '添加知识库',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow?.webContents.send('menu:addKb')
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于锦囊笔记',
          click: () => mainWindow?.webContents.send('menu:about')
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  // 先创建窗口，避免 initStore 等后续步骤抛错导致窗口永远不显示
  registerIpcHandlers(() => mainWindow);
  buildMenu();
  createWindow();

  // store 初始化失败不应阻断窗口显示，但必须显式暴露根因（而非静默），
  // 否则后续所有依赖数据库的 IPC 都会刷屏 "Store not initialized" 且无从排查。
  try {
    initStore();
  } catch (err) {
    console.error('[main] initStore 失败：', err);
    const msg = String(err && (err as Error).message ? (err as Error).message : err);
    const hint =
      /NODE_MODULE_VERSION|better-sqlite3|Module.*was compiled|Cannot find module/.test(msg)
        ? '很可能是 better-sqlite3 原生模块与当前 Electron/Node 版本不兼容。请在本项目根目录执行 `npm rebuild better-sqlite3` 后重启；若仍失败，删除 node_modules 与 package-lock.json 后重新 `npm install`。'
        : '请查看上方堆栈定位原因。';
    const html = `data:text/html;charset=utf-8,${encodeURIComponent(
      `<div style="font-family:-apple-system,'PingFang SC',sans-serif;padding:32px;color:#b91c1c"><h2>配置数据库初始化失败</h2><pre style="white-space:pre-wrap">${msg}</pre><p style="color:#334155">${hint}</p></div>`
    )}`;
    mainWindow?.loadURL(html);
  }

  // 自动更新：启动后自动检查（仅在打包环境生效）
  if (mainWindow) initAutoUpdater(mainWindow);

  // 启动时为已挂载知识库启动监听 & 构建索引
  const kbs = listKBs();
  for (const kb of kbs) {
    await bootstrapIndex(kb.id);
    await startWatching(kb.id);
  }

  // 监听 activeKb 变化
  ipcMain.handle('debug:activeKb', () => getConfig('activeKb'));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  await stopAll();
});

// 安全：禁止新窗口导航
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (event, url) => {
    if (process.env.ELECTRON_RENDERER_URL && url.startsWith(process.env.ELECTRON_RENDERER_URL)) return;
    event.preventDefault();
    shell.openExternal(url);
  });
});
