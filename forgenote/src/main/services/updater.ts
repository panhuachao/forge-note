import { app, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import { IPC, UpdateStatus } from '../../shared/ipc-channels';

// GitHub Release 的 owner/repo。
// 请按实际仓库修改（如 owner 是组织名，repo 是仓库名）。
const GITHUB_OWNER = 'panhuachao';
const GITHUB_REPO = 'forge-note';

let mainWin: BrowserWindow | null = null;

function send(status: UpdateStatus) {
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send(IPC.EV_APP_UPDATE, status);
  }
}

// 启动时是否自动检查更新（可由设置开关）
let autoCheckEnabled = true;
export function setAutoCheckEnabled(v: boolean) {
  autoCheckEnabled = v;
}

export function initAutoUpdater(win: BrowserWindow) {
  mainWin = win;

  // 开发模式下不连接更新服务器，避免 GitHub 404 噪音
  if (!app.isPackaged) {
    return;
  }

  autoUpdater.autoDownload = false; // 先提示，用户确认后再下载
  autoUpdater.autoInstallOnAppQuit = true; // 退出时自动安装已下载的更新
  autoUpdater.allowPrerelease = false;

  // GitHub Release 作为更新源
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    // 如需私有仓库，可在此传入 token（建议走环境变量）
    ...(process.env.GH_TOKEN ? { token: process.env.GH_TOKEN } : {})
  });

  autoUpdater.on('checking-for-update', () => {
    send({ type: 'checking' });
  });

  autoUpdater.on('update-available', (info: any) => {
    send({
      type: 'available',
      version: info?.version || '',
      releaseNotes: typeof info?.releaseNotes === 'string' ? info.releaseNotes : ''
    });
  });

  autoUpdater.on('update-not-available', (info: any) => {
    send({ type: 'not-available', version: info?.version || app.getVersion() });
  });

  autoUpdater.on('download-progress', (p: any) => {
    send({
      type: 'progress',
      percent: p?.percent ?? 0,
      transferred: p?.transferred ?? 0,
      total: p?.total ?? 0
    });
  });

  autoUpdater.on('update-downloaded', (info: any) => {
    send({ type: 'downloaded', version: info?.version || '' });
  });

  autoUpdater.on('error', (err: any) => {
    send({ type: 'error', message: err?.message || String(err) });
  });

  // 启动后自动检查（延迟几秒，避免阻塞首屏）
  if (autoCheckEnabled) {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((e) => {
        console.error('[updater] 自动检查更新失败', e);
      });
    }, 4000);
  }
}

export function checkForUpdates() {
  if (!app.isPackaged) {
    send({ type: 'not-available', version: app.getVersion() });
    return;
  }
  autoUpdater
    .checkForUpdates()
    .catch((e) => send({ type: 'error', message: String(e) }));
}

export function downloadAndInstall() {
  if (!app.isPackaged) return;
  // 开始下载；下载完成后会收到 update-downloaded 事件
  autoUpdater
    .downloadUpdate()
    .catch((e) => send({ type: 'error', message: String(e) }));
}

// 用户确认安装：退出并安装已下载的更新
export function quitAndInstall() {
  if (!app.isPackaged) return;
  autoUpdater.quitAndInstall(false, true);
}

// 供渲染层询问是否已有可安装的下载
export function isUpdaterReady() {
  return app.isPackaged;
}
