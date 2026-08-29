// 插件私有存储（doc/插件技术实现方案.md §9.2 storage）
//
// 每个插件一个独立 JSON 文件，互不可见，位于 <userData>/plugin-data/<pluginId>/data.json。
// 写入用 atomicWrite，避免半截文件。
import * as fs from 'node:fs';
import * as path from 'node:path';
import { app } from 'electron';
import { atomicWrite } from '../utils/fs';

function dataDir(): string | null {
  try {
    return path.join(app.getPath('userData'), 'plugin-data');
  } catch {
    return null;
  }
}

function dataFile(pluginId: string): string | null {
  const dir = dataDir();
  return dir ? path.join(dir, pluginId, 'data.json') : null;
}

/** 读取插件数据（整个命名空间） */
export async function readPluginData(pluginId: string): Promise<Record<string, unknown>> {
  const f = dataFile(pluginId);
  if (!f || !fs.existsSync(f)) return {};
  try {
    const raw = await fs.promises.readFile(f, 'utf-8');
    return (JSON.parse(raw) as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

export async function writePluginData(pluginId: string, data: Record<string, unknown>): Promise<void> {
  const f = dataFile(pluginId);
  if (!f) return;
  try {
    await atomicWrite(f, JSON.stringify(data));
  } catch {
    /* 静默：存储失败不应导致插件崩溃 */
  }
}

export async function getPluginValue<T>(pluginId: string, key: string, fallback?: T): Promise<T | undefined> {
  const data = await readPluginData(pluginId);
  const v = data[key];
  return v === undefined ? fallback : (v as T);
}

export async function setPluginValue(pluginId: string, key: string, value: unknown): Promise<void> {
  const data = await readPluginData(pluginId);
  data[key] = value;
  await writePluginData(pluginId, data);
}

export async function removePluginValue(pluginId: string, key: string): Promise<void> {
  const data = await readPluginData(pluginId);
  delete data[key];
  await writePluginData(pluginId, data);
}

/** 卸载插件时清理其数据 */
export async function clearPluginData(pluginId: string): Promise<void> {
  const dir = dataDir();
  if (!dir) return;
  try {
    await fs.promises.rm(path.join(dir, pluginId), { recursive: true, force: true });
  } catch {
    /* 静默 */
  }
}

/** 插件目录与启用状态（KB 级） */
export function pluginsRoot(): string | null {
  try {
    return path.join(app.getPath('userData'), 'plugins');
  } catch {
    return null;
  }
}
