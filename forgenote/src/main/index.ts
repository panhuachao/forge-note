// Electron 主进程入口
import { app, BrowserWindow, shell, Menu, ipcMain, dialog } from 'electron';
import { join } from 'path';
import { initStore, listKBs, getConfig } from './services/store';
import { registerIpcHandlers } from './ipc';
import { startWatching, stopAll, bootstrapIndex } from './services/watcher';
import { kbService } from './services/kb-service';

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
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false, // 需要 chokidar / fs 在 main，不影响渲染层
      nodeIntegration: false
    }
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
          click: () =>
            dialog.showMessageBox(mainWindow!, {
              type: 'info',
              title: '关于',
              message: '锦囊笔记 ForgeNote V1.1',
              detail: '本地开源 AI 知识库笔记\n知识库模板增强版\nhttps://github.com/forgenote'
            })
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  initStore();
  registerIpcHandlers(() => mainWindow);
  buildMenu();
  createWindow();

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
