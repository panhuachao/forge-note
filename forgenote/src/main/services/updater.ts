import { app, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import * as fs from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';
import { IPC, UpdateStatus } from '../../shared/ipc-channels';

// GitHub Release 的 owner/repo。
// 请按实际仓库修改（如 owner 是组织名，repo 是仓库名）。
const GITHUB_OWNER = 'panhuachao';
const GITHUB_REPO = 'forge-note';

let mainWin: BrowserWindow | null = null;

// 备份最近一次「已下载」的 updateInfo：用于 quitAndInstall 兜底。
// 直接读 autoUpdater.updateInfo 在 macOS Squirrel 失败、checkForUpdates 重新执行、
// 或 autoInstallOnAppQuit 触发后会被清空，导致「重启并安装」看似无反应。
let lastDownloadedInfo: any = null;

// ---- 缓存包 sha512 比对（同名版本重传场景） ----
function getCacheDir(): string | null {
  try {
    const d = (autoUpdater as any).cacheDir;
    return typeof d === 'string' && d ? d : null;
  } catch {
    return null;
  }
}

function sha512OfFile(filePath: string): string | null {
  try {
    const buf = fs.readFileSync(filePath);
    return createHash('sha512').update(buf).digest('base64');
  } catch {
    return null;
  }
}

/**
 * 按当前平台解析 electron-builder 生成的 latest 元数据文件名与包扩展名。
 * - macOS: latest-mac.yml / latest-mac-arm64.yml, 包为 .zip (Squirrel)
 * - Windows(NSIS): latest.yml, 包为 .exe
 * - Linux: latest-linux.yml, 包为 .AppImage / .zip
 */
function resolvePlatformMeta(arch: string): { ymlName: string; ext: string } {
  if (process.platform === 'darwin') {
    return { ymlName: arch === 'arm64' ? 'latest-mac-arm64.yml' : 'latest-mac.yml', ext: '.zip' };
  }
  if (process.platform === 'win32') {
    return { ymlName: 'latest.yml', ext: '.exe' };
  }
  return { ymlName: 'latest-linux.yml', ext: '.AppImage' };
}

/**
 * 若本地已缓存同名版本的更新包，且 sha512 与服务器最新不一致，
 * 说明同名版本被重传（内容变更），需删除旧缓存包以触发重新下载。
 * 缓存文件名使用服务器 yml 中的真实 url 文件名（basename），跨平台通用。
 * @returns true 表示已删除旧缓存包（需要重新下载）
 */
function removeStaleCacheIfShaMismatch(cacheFileName: string, expectedSha512: string | undefined): boolean {
  if (!expectedSha512) return false; // 无法比对则不删，交给 electron-updater 默认行为
  const dir = getCacheDir();
  if (!dir) return false;
  const file = join(dir, cacheFileName);
  if (!fs.existsSync(file)) return false;
  const local = sha512OfFile(file);
  if (local && local !== expectedSha512) {
    console.log(
      `[updater] 缓存包 sha512 不一致，删除旧包以重新下载: ${file}\n  本地  ${local.slice(0, 16)}…\n  服务器 ${expectedSha512.slice(0, 16)}…`
    );
    try {
      fs.unlinkSync(file);
      return true;
    } catch (e) {
      console.warn('[updater] 删除旧缓存包失败', e);
    }
  }
  return false;
}

/**
 * 从 GitHub Release 的 latest 元数据 yml 中取指定架构安装包的真实信息
 * （url / sha512 / size）。electron-builder 发布时会在 release 放对应平台的
 * latest*.yml，内含每个 asset 的 sha512，用于与本地缓存比对，并构造 updateInfo。
 */
async function fetchServerFileInfo(arch: string): Promise<{ url: string; sha512: string; size: number } | null> {
  const { ymlName, ext } = resolvePlatformMeta(arch);
  const url = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest/download/${ymlName}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const text: string = await res.text();
    // 逐个文件块解析： - url: <...> \n ... sha512: <...> \n ... size: <...>
    const blocks = text.split(/^\s*-\s*url:/m).slice(1);
    for (const b of blocks) {
      const urlLine = b.split('\n')[0].trim();
      if (!urlLine.endsWith(ext) || !urlLine.includes(arch)) continue;
      const sha = b.match(/sha512:\s*([A-Za-z0-9+/=]+)/);
      const size = b.match(/size:\s*(\d+)/);
      if (sha) {
        return {
          url: urlLine,
          sha512: sha[1],
          size: size ? parseInt(size[1], 10) : 0
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

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
  // 不再让 app 退出时自动安装下载好的更新：
  // 1) autoInstallOnAppQuit 在 macOS Squirrel.Mac 失败时会清空内部 updateInfo
  //    并清掉缓存,导致后续「重启并安装」被静默丢弃;
  // 2) 我们已经有显式的「重启并安装」按钮,无需隐式退出时安装。
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;

  // 让 electron-updater 内部日志输出到主进程 console，方便排查「点击无反应」问题
  // （开发模式自动可见；打包后 npm start 也能看到）
  try {
    (autoUpdater as any).logger = console;
  } catch {
    // 忽略
  }

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
    // 同名版本重传：比对本地缓存包 sha512 与服务器，不一致则删旧包重新下载
    const fileInfo = (info?.files || []).find((f: any) => typeof f.url === 'string') || info?.files?.[0];
    if (info?.version && fileInfo?.sha512) {
      const cacheFileName = (fileInfo.url || '').split('/').pop() || '';
      if (cacheFileName) removeStaleCacheIfShaMismatch(cacheFileName, fileInfo.sha512);
    }
    send({
      type: 'available',
      version: info?.version || '',
      releaseNotes: typeof info?.releaseNotes === 'string' ? info.releaseNotes : ''
    });
  });

  autoUpdater.on('update-not-available', (info: any) => {
    // 版本号相同但服务器可能已重新发布（同名版本重传场景）。
    // 此时 electron-updater 内部 updateInfo 为空，无法下载/安装。
    // 主动检测服务器发布时间，若较本地构建更新则提示可重装（不直接覆盖 updateInfo，
    // 避免破坏正在进行的「已下载」状态）。
    detectContentUpdate(app.getVersion())
      .then((forced) => {
        if (forced) return; // 已作为 available 通知渲染层
        send({ type: 'not-available', version: info?.version || app.getVersion() });
      })
      .catch(() => {
        send({ type: 'not-available', version: info?.version || app.getVersion() });
      });
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
    // 备份 updateInfo；quitAndInstall 在 Squirrel 失败后可能被清空时,这里仍能复用
    lastDownloadedInfo = info || lastDownloadedInfo;
    console.log('[updater] update-downloaded:', info?.version, 'files:', info?.files?.length);
    send({ type: 'downloaded', version: info?.version || '' });
  });

  autoUpdater.on('error', (err: any) => {
    // 同时打印到主进程 console，方便在终端查看完整堆栈
    console.error('[updater] error:', err);
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
  // 没有待安装的 updateInfo 时，quitAndInstall 会被 electron-updater 静默忽略。
  // 这里主动检查并向用户反馈，避免「点了无反应」时无法定位。
  let info = (autoUpdater as any).updateInfo as { version?: string; files?: any[] } | null;
  if (!info || !info.files || info.files.length === 0) {
    // 兜底：使用 update-downloaded 时备份的 updateInfo
    if (lastDownloadedInfo && lastDownloadedInfo.files?.length) {
      console.warn('[updater] updateInfo lost, restoring from lastDownloadedInfo');
      (autoUpdater as any).updateInfo = lastDownloadedInfo;
      info = lastDownloadedInfo;
    } else {
      const msg = '未找到可安装的更新包（updateInfo 为空）。请先点击「检查更新」并完成下载。';
      console.warn('[updater] quitAndInstall called but updateInfo is empty');
      send({ type: 'error', message: msg });
      return;
    }
  }
  console.log('[updater] quitAndInstall ->', info!.version);
  // 第二参 true 表示退出时强制安装下载好的更新
  autoUpdater.quitAndInstall(false, true);
}

// 供渲染层询问是否已有可安装的下载
export function isUpdaterReady() {
  return app.isPackaged;
}

/**
 * 检测「版本号相同但内容已更新」的场景：GitHub Release 被同 tag 重传时，
 * electron-updater 会判 update-not-available 且 updateInfo 为空，导致无法重装。
 * 这里直接拉取 latest release，比较发布时间是否晚于本地 app 构建时间；
 * 若是，则手动构造 updateInfo 并通知渲染层「有更新」，从而可下载与安装。
 * @returns true 表示已作为 available 通知；false 表示确实无内容更新。
 */
async function detectContentUpdate(currentVersion: string): Promise<boolean> {
  try {
    const api = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
    const res = await fetch(api, {
      headers: {
        Accept: 'application/vnd.github+json',
        ...(process.env.GH_TOKEN ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {})
      }
    });
    if (!res.ok) return false;
    const data: any = await res.json();
    const published = new Date(data.published_at).getTime();
    let localMtime = 0;
    try {
      localMtime = fs.statSync(process.execPath).mtimeMs;
    } catch {
      localMtime = 0;
    }
    if (!(published > localMtime)) return false;

    // 从对应平台的 latest*.yml 取真实安装包信息（url / sha512 / size）。
    // GitHub API 的 assets 不含 sha512，且 Windows NSIS 资产是 .exe 而非 .zip，
    // 必须走 yml 元数据才能正确构造 updateInfo 并比对缓存。
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    const fileInfo = await fetchServerFileInfo(arch);
    if (!fileInfo) return false;

    const version = String(data.tag_name || '').replace(/^v/, '') || currentVersion;

    // 同名版本重传：比对本地缓存 sha512，不一致则删旧包（用 yml 中的真实文件名），
    // 确保重新下载。缓存文件名即 yml 里 url 的 basename（mac 为 .zip，win 为 .exe）。
    const cacheFileName = fileInfo.url.split('/').pop() || `${version}-${arch}${fileInfo.url.endsWith('.exe') ? '.exe' : '.zip'}`;
    removeStaleCacheIfShaMismatch(cacheFileName, fileInfo.sha512);

    const files = [
      {
        url: fileInfo.url,
        size: fileInfo.size,
        sha512: fileInfo.sha512
      }
    ];

    const info: any = {
      version,
      files,
      path: fileInfo.url,
      sha512: fileInfo.sha512,
      releaseDate: data.published_at,
      releaseNotes: data.body || '',
      releaseName: data.name || ''
    };
    // 不直接覆盖 autoUpdater.updateInfo（避免破坏已下载状态）。
    // 仅当当前没有任何可安装包时,把构造的 info 作为兜底备份,以便 quitAndInstall 使用。
    if (!lastDownloadedInfo) {
      (autoUpdater as any).strictVerify = false;
      lastDownloadedInfo = info;
      (autoUpdater as any).updateInfo = info;
    }

    send({
      type: 'available',
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : ''
    });
    return true;
  } catch {
    return false;
  }
}
