// 文件系统原子读写工具
import { promises as fs } from 'fs';
import { dirname, join, sep } from 'path';
import { createHash } from 'crypto';

/**
 * 原子写入：先写 .tmp，再 rename，避免读到半文件
 */
export async function atomicWrite(filePath: string, data: string | Buffer): Promise<void> {
  const dir = dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, filePath);
}

/**
 * 安全 join：禁止越界到根目录之外
 */
export function safeJoin(root: string, ...parts: string[]): string {
  const normalized = join(root, ...parts).replace(/\\/g, '/');
  const rootN = root.replace(/\\/g, '/').replace(/\/+$/, '') + '/';
  if (!normalized.startsWith(rootN) && normalized !== root.replace(/\/+$/, '')) {
    throw new Error(`路径越界: ${normalized}`);
  }
  return normalized;
}

/**
 * 相对路径
 */
export function relative(root: string, abs: string): string {
  return abs.replace(root.replace(/\\/g, '/').replace(/\/+$/, '') + '/', '');
}

/**
 * 文件 hash（用于去重/幂等）
 */
export async function fileHash(filePath: string): Promise<string> {
  const buf = await fs.readFile(filePath);
  return createHash('sha1').update(buf).digest('hex');
}

/**
 * 判断是否 Markdown 文件
 */
export function isMarkdown(name: string): boolean {
  return /\.md$/i.test(name) || /\.markdown$/i.test(name);
}

/**
 * 判断是否隐藏文件/目录
 */
export function isHidden(name: string): boolean {
  return name.startsWith('.');
}

/**
 * 确保目录存在
 */
export async function ensureDir(p: string): Promise<void> {
  await fs.mkdir(p, { recursive: true });
}

/**
 * 递归复制目录
 */
export async function copyDir(src: string, dest: string, filter?: (name: string) => boolean): Promise<void> {
  await ensureDir(dest);
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    if (filter && !filter(e.name)) continue;
    const s = join(src, e.name);
    const d = join(dest, e.name);
    if (e.isDirectory()) {
      await copyDir(s, d, filter);
    } else {
      await fs.copyFile(s, d);
    }
  }
}
