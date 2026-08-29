// 插件宿主（doc/插件技术实现方案.md §6 / §1.2）
//
// 职责：扫描插件目录 → 校验 manifest → 按权限装配 API → require 加载 → onload/onunload
//       → 崩溃隔离 → 卸载时批量撤销贡献项
//
// 安全说明：主进程 sandbox=false，插件以 require() 载入主进程，本质上拥有主进程全部能力。
// 宿主不做技术沙箱（与 Obsidian 一致），但保证：
//   · 单个插件加载/运行失败不影响其它插件与主应用
//   · 未声明权限的 API 调用直接抛错
//   · 卸载时贡献项全部撤销，不留残留
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app } from 'electron';
import type {
  PluginInfo,
  PluginMainModule,
  PluginManifest,
  PluginPermission,
  PluginState
} from '@shared/types/plugin';
import { buildPluginApi, buildPluginContext, unregisterCommandsByOwner } from './plugin-api';
import { unregisterSkillsByOwner } from './skill-engine';
import { unregisterToolsByOwner } from './tool-runtime';
import { eventBus } from '../utils/event-bus';

/** onload 超时（毫秒）：超时视为失败并自动禁用 */
const LOAD_TIMEOUT = 5000;

interface LoadedPlugin {
  manifest: PluginManifest;
  state: PluginState;
  error?: string;
  module?: PluginMainModule;
  unsubscribers: (() => void)[];
  contributions: {
    skills: string[];
    tools: string[];
    actionTypes: string[];
    commands: string[];
    uiSlots: string[];
  };
}

class PluginHost {
  private plugins = new Map<string, LoadedPlugin>();
  /** 已授权权限：pluginId -> Set<permission> */
  private granted = new Map<string, Set<PluginPermission>>();
  /** 当前知识库 id（KB 级启用） */
  private currentKbId: string | null = null;
  private appVersion = '0.0.0';

  /** 插件安装根目录 */
  root(): string | null {
    try {
      return path.join(app.getPath('userData'), 'plugins');
    } catch {
      return null;
    }
  }

  setAppVersion(v: string): void {
    this.appVersion = v;
  }

  /** 安全模式：跳过插件自动加载（启动时按住 Shift 触发） */
  private safeMode = false;

  setSafeMode(on: boolean): void {
    this.safeMode = on;
  }

  isSafeMode(): boolean {
    return this.safeMode;
  }

  /** 切换知识库：重新按 KB 级启用状态加载/卸载 */
  async setActiveKb(kbId: string | null): Promise<void> {
    this.currentKbId = kbId;
    if (!kbId) return;
    // 安全模式：不加载任何插件
    if (this.safeMode) {
      await this.disableAll();
      return;
    }
    const enabled = this.readEnabledList(kbId);
    for (const [id, p] of this.plugins) {
      const shouldRun = enabled.includes(id);
      if (shouldRun && p.state !== 'active') await this.enable(id, true);
      else if (!shouldRun && p.state === 'active') await this.disable(id, true);
    }
  }

  /** 扫描插件目录，读取全部 manifest（不加载） */
  scan(): PluginInfo[] {
    const root = this.root();
    if (!root) return [];
    if (!fs.existsSync(root)) {
      try {
        fs.mkdirSync(root, { recursive: true });
      } catch {
        return [];
      }
    }
    const out: PluginInfo[] = [];
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      return [];
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const dir = path.join(root, e.name);
      const manifest = this.readManifest(dir);
      if (!manifest) continue;
      // 新扫描到的插件登记进来（state 初始为 disabled）
      let rec = this.plugins.get(manifest.id);
      if (!rec) {
        rec = {
          manifest,
          state: 'disabled',
          unsubscribers: [],
          contributions: { skills: [], tools: [], actionTypes: [], commands: [], uiSlots: [] }
        };
        this.plugins.set(manifest.id, rec);
      } else {
        rec.manifest = manifest;
      }
      out.push(this.toInfo(manifest.id, rec));
    }
    return out;
  }

  private readManifest(dir: string): PluginManifest | null {
    const f = path.join(dir, 'manifest.json');
    if (!fs.existsSync(f)) return null;
    try {
      const raw = JSON.parse(fs.readFileSync(f, 'utf-8')) as Partial<PluginManifest>;
      if (!raw.id || !raw.name || !raw.main) return null;
      return {
        id: String(raw.id),
        name: String(raw.name),
        version: String(raw.version ?? '0.0.0'),
        description: raw.description ? String(raw.description) : undefined,
        author: raw.author ? String(raw.author) : undefined,
        minAppVersion: raw.minAppVersion ? String(raw.minAppVersion) : undefined,
        apiVersion: Number(raw.apiVersion ?? 1),
        main: String(raw.main),
        ui: raw.ui ? String(raw.ui) : undefined,
        permissions: Array.isArray(raw.permissions) ? (raw.permissions as PluginPermission[]) : []
      };
    } catch {
      return null;
    }
  }

  /** 列出全部插件信息 */
  list(): PluginInfo[] {
    const root = this.root();
    if (root && fs.existsSync(root)) this.scan();
    const enabled = this.currentKbId ? this.readEnabledList(this.currentKbId) : [];
    return [...this.plugins.entries()].map(([id, p]) => ({
      ...this.toInfo(id, p),
      enabledInKb: enabled.includes(id)
    }));
  }

  private toInfo(id: string, p: LoadedPlugin): PluginInfo {
    const granted = this.granted.get(id);
    return {
      id,
      name: p.manifest.name,
      version: p.manifest.version,
      description: p.manifest.description,
      author: p.manifest.author,
      manifest: p.manifest,
      state: granted ? p.state : 'pending-permission',
      error: p.error,
      enabledInKb: false,
      grantedPermissions: granted ? [...granted] : []
    };
  }

  /* ==================== 启用 / 禁用 ==================== */

  async enable(id: string, skipPersist = false): Promise<{ ok: boolean; message: string }> {
    const p = this.plugins.get(id);
    if (!p) return { ok: false, message: '插件不存在' };

    // 版本校验
    if (p.manifest.minAppVersion && this.compareVersion(this.appVersion, p.manifest.minAppVersion) < 0) {
      p.state = 'error';
      p.error = `需要应用版本 ≥ ${p.manifest.minAppVersion}`;
      return { ok: false, message: p.error };
    }

    // 权限校验
    const granted = this.granted.get(id);
    if (!granted) {
      p.state = 'pending-permission';
      return { ok: false, message: 'PENDING_PERMISSION' };
    }

    if (p.state === 'active') return { ok: true, message: '已启用' };

    const dir = path.join(this.root() || '', id);
    try {
      const mod = await this.loadModule(dir, p.manifest);
      const api = buildPluginApi({
        manifest: p.manifest,
        granted,
        contributions: p.contributions,
        unsubscribers: p.unsubscribers
      });
      const ctx = buildPluginContext(p.manifest, dir, p.unsubscribers);

      await this.withTimeout(mod.onload(api, ctx), LOAD_TIMEOUT, 'onload 超时');

      p.module = mod;
      p.state = 'active';
      p.error = undefined;
      if (!skipPersist && this.currentKbId) this.addToEnabledList(this.currentKbId, id);
      console.log(`[plugin] 已启用 ${id}@${p.manifest.version}`);
      return { ok: true, message: '已启用' };
    } catch (e) {
      p.state = 'error';
      p.error = String(e);
      // 加载失败也要清理可能的残留
      this.revoke(p, id);
      console.error(`[plugin] 启用失败 ${id}:`, e);
      return { ok: false, message: String(e) };
    }
  }

  async disable(id: string, skipPersist = false): Promise<{ ok: boolean; message: string }> {
    const p = this.plugins.get(id);
    if (!p) return { ok: false, message: '插件不存在' };
    if (p.state !== 'active') return { ok: true, message: '未在运行' };
    try {
      const api = buildPluginApi({
        manifest: p.manifest,
        granted: this.granted.get(id) ?? new Set(),
        contributions: p.contributions,
        unsubscribers: p.unsubscribers
      });
      const ctx = buildPluginContext(p.manifest, path.join(this.root() || '', id), p.unsubscribers);
      if (p.module?.onunload) await this.withTimeout(p.module.onunload(api, ctx), LOAD_TIMEOUT, 'onunload 超时');
    } catch (e) {
      console.warn(`[plugin] ${id} onunload 出错:`, e);
    } finally {
      this.revoke(p, id);
      p.state = 'disabled';
      p.module = undefined;
      if (!skipPersist && this.currentKbId) this.removeFromEnabledList(this.currentKbId, id);
    }
    return { ok: true, message: '已禁用' };
  }

  /** 授予权限（用户在设置页确认后调用） */
  grantPermissions(id: string, permissions: PluginPermission[]): void {
    this.granted.set(id, new Set(permissions));
    this.persistGrants();
  }

  /** 撤销授权 */
  revokePermissions(id: string): void {
    this.granted.delete(id);
    this.persistGrants();
  }

  /** 卸载插件（禁用 + 删除目录 + 清理数据） */
  async uninstall(id: string): Promise<{ ok: boolean; message: string }> {
    await this.disable(id);
    this.granted.delete(id);
    this.plugins.delete(id);
    const dir = path.join(this.root() || '', id);
    try {
      await fs.promises.rm(dir, { recursive: true, force: true });
    } catch (e) {
      return { ok: false, message: `删除目录失败：${String(e)}` };
    }
    const { clearPluginData } = await import('./plugin-storage');
    await clearPluginData(id);
    this.persistGrants();
    return { ok: true, message: '已卸载' };
  }

  /** 从内置/仓库预置目录安装插件到 userData/plugins/<id>（社区索引「安装」入口） */
  async installBuiltin(id: string, sourceDir?: string): Promise<{ ok: boolean; message: string }> {
    const dest = path.join(this.root() || '', id);
    if (fs.existsSync(dest)) {
      return { ok: false, message: `插件 ${id} 已安装` };
    }
    // 候选源目录：显式传入 > 打包资源 > 开发期仓库 samples
    const candidates: string[] = [];
    if (sourceDir) candidates.push(sourceDir);
    try {
      candidates.push(path.join(process.resourcesPath || '', 'builtin-plugins', id));
    } catch {}
    try {
      candidates.push(path.join(app.getAppPath(), 'samples', 'plugins', id));
    } catch {}

    const src = candidates.find((c) => c && fs.existsSync(c) && fs.statSync(c).isDirectory());
    if (!src) {
      return { ok: false, message: `找不到预置插件目录：${id}` };
    }
    try {
      await fs.promises.cp(src, dest, { recursive: true });
    } catch (e) {
      return { ok: false, message: `复制插件失败：${String(e)}` };
    }
    await this.scan();
    return { ok: true, message: `已安装「${id}」` };
  }

  /** 写入已下载的插件文件（来自远程仓库），路径相对于插件根目录 */
  async installFiles(id: string, files: { path: string; content: string }[]): Promise<{ ok: boolean; message: string }> {
    const dest = path.join(this.root() || '', id);
    if (fs.existsSync(dest)) {
      return { ok: false, message: `插件 ${id} 已安装` };
    }
    try {
      await fs.promises.mkdir(dest, { recursive: true });
      for (const f of files) {
        const target = path.join(dest, f.path);
        await fs.promises.mkdir(path.dirname(target), { recursive: true });
        await fs.promises.writeFile(target, f.content, 'utf8');
      }
    } catch (e) {
      return { ok: false, message: `写入插件文件失败：${String(e)}` };
    }
    await this.scan();
    return { ok: true, message: `已安装「${id}」` };
  }

  /* ==================== 内部 ==================== */

  private async loadModule(dir: string, manifest: PluginManifest): Promise<PluginMainModule> {
    const entry = path.join(dir, manifest.main);
    if (!fs.existsSync(entry)) throw new Error(`入口文件不存在：${manifest.main}`);
    // 清缓存，支持开发期热重载
    delete require.cache[require.resolve(entry)];
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(entry) as PluginMainModule;
    if (typeof mod?.onload !== 'function') {
      throw new Error('插件入口必须导出 onload 函数');
    }
    return mod;
  }

  /** 撤销插件的全部贡献项与事件订阅 */
  private revoke(p: LoadedPlugin, id: string): void {
    for (const off of p.unsubscribers) {
      try {
        off();
      } catch {
        /* 忽略 */
      }
    }
    p.unsubscribers = [];
    unregisterSkillsByOwner(id);
    unregisterToolsByOwner(id);
    unregisterCommandsByOwner(id);
    p.contributions = { skills: [], tools: [], actionTypes: [], commands: [], uiSlots: [] };
  }

  private async withTimeout<T>(p: Promise<T> | T, ms: number, label: string): Promise<T> {
    if (!(p instanceof Promise)) return p;
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(label)), ms);
    });
    try {
      return await Promise.race([p, timeout]);
    } finally {
      clearTimeout(timer!);
    }
  }

  /** 语义化版本比较：a >= b 返回 0 或 1 */
  private compareVersion(a: string, b: string): number {
    const pa = String(a).split('.').map(Number);
    const pb = String(b).split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      const x = pa[i] || 0;
      const y = pb[i] || 0;
      if (x > y) return 1;
      if (x < y) return -1;
    }
    return 0;
  }

  /* ==================== 持久化 ==================== */

  private grantsFile(): string | null {
    try {
      return path.join(app.getPath('userData'), 'plugin-grants.json');
    } catch {
      return null;
    }
  }

  private persistGrants(): void {
    const f = this.grantsFile();
    if (!f) return;
    try {
      const obj: Record<string, string[]> = {};
      for (const [k, v] of this.granted) obj[k] = [...v];
      fs.writeFileSync(f, JSON.stringify(obj));
    } catch {
      /* 静默 */
    }
  }

  /** 应用启动时恢复已授权记录 */
  restoreGrants(): void {
    const f = this.grantsFile();
    if (!f || !fs.existsSync(f)) return;
    try {
      const obj = JSON.parse(fs.readFileSync(f, 'utf-8')) as Record<string, string[]>;
      for (const [k, v] of Object.entries(obj)) this.granted.set(k, new Set(v as PluginPermission[]));
    } catch {
      /* 静默 */
    }
  }

  private readEnabledList(kbId: string): string[] {
    // KB 级启用清单放在应用侧（避免污染知识库目录），key 为 kbId
    const f = this.enabledListFile();
    if (!f || !fs.existsSync(f)) return [];
    try {
      const obj = JSON.parse(fs.readFileSync(f, 'utf-8')) as Record<string, string[]>;
      return obj[kbId] ?? [];
    } catch {
      return [];
    }
  }

  private addToEnabledList(kbId: string, id: string): void {
    const f = this.enabledListFile();
    if (!f) return;
    let obj: Record<string, string[]> = {};
    try {
      if (fs.existsSync(f)) obj = JSON.parse(fs.readFileSync(f, 'utf-8')) as Record<string, string[]>;
    } catch {
      obj = {};
    }
    const list = obj[kbId] ?? [];
    if (!list.includes(id)) list.push(id);
    obj[kbId] = list;
    try {
      fs.writeFileSync(f, JSON.stringify(obj));
    } catch {
      /* 静默 */
    }
  }

  private removeFromEnabledList(kbId: string, id: string): void {
    const f = this.enabledListFile();
    if (!f || !fs.existsSync(f)) return;
    try {
      const obj = JSON.parse(fs.readFileSync(f, 'utf-8')) as Record<string, string[]>;
      obj[kbId] = (obj[kbId] ?? []).filter((x) => x !== id);
      fs.writeFileSync(f, JSON.stringify(obj));
    } catch {
      /* 静默 */
    }
  }

  private enabledListFile(): string | null {
    try {
      return path.join(app.getPath('userData'), 'plugin-enabled.json');
    } catch {
      return null;
    }
  }

  /** 全部插件禁用（安全模式） */
  async disableAll(): Promise<void> {
    for (const id of [...this.plugins.keys()]) await this.disable(id, true);
  }

  /**
   * 取得插件目录下某资源（如自带的第三方库 vendor/x.js）的绝对 file:// URL，
   * 供渲染层插件在隔离上下文用 <script src> 动态加载自身携带的资源。
   * 严格限定在插件自身目录内，防止目录穿越。
   */
  getResourceUrl(pluginId: string, relativePath: string): string {
    const root = this.root();
    if (!root) return '';
    const pluginDir = path.resolve(root, pluginId);
    const abs = path.resolve(pluginDir, relativePath);
    if (abs !== pluginDir && !abs.startsWith(pluginDir + path.sep)) {
      console.warn(`[plugin] ${pluginId} 请求越界的资源：${relativePath}`);
      return '';
    }
    return pathToFileURL(abs).toString();
  }

  /**
   * 读取插件 UI 源码（供渲染层 new Function 执行）。
   * 严格校验：路径必须解析后落在插件自身目录内，防止目录穿越读取任意文件。
   */
  readUiFile(pluginId: string, uiFile: string): string | null {
    const root = this.root();
    if (!root) return null;
    const pluginDir = path.resolve(root, pluginId);
    const abs = path.resolve(uiFile);
    if (!abs.startsWith(pluginDir + path.sep) && abs !== pluginDir) {
      console.warn(`[plugin] ${pluginId} 请求越界的 UI 文件：${uiFile}`);
      return null;
    }
    try {
      return fs.readFileSync(abs, 'utf-8');
    } catch {
      return null;
    }
  }

  /** 取已启用插件的 UI 入口文件名（供渲染层加载） */
  listUiEntries(): { id: string; uiFile: string }[] {
    const root = this.root();
    if (!root) return [];
    const out: { id: string; uiFile: string }[] = [];
    for (const [id, p] of this.plugins) {
      if (p.state !== 'active' || !p.manifest.ui) continue;
      out.push({ id, uiFile: path.join(root, id, p.manifest.ui) });
    }
    return out;
  }
}

export const pluginHost = new PluginHost();

/** 插件 toast / 确认请求转发到渲染层 */
export function forwardPluginEvents(send: (channel: string, payload: unknown) => void): void {
  eventBus.on('plugin:toast', (p) => send('plugin:toast', p));
  eventBus.on('plugin:confirmAction', (p) => send('plugin:confirmAction', p));
}
