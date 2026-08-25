// 双向链接索引（内存）
import { getKB } from './store';

class LinkIndex {
  // kbId -> notePath -> Set<outlink target>
  private outlinks = new Map<string, Map<string, Set<string>>>();

  private ensure(kbId: string): Map<string, Set<string>> {
    if (!this.outlinks.has(kbId)) this.outlinks.set(kbId, new Map());
    return this.outlinks.get(kbId)!;
  }

  updateOutlinks(kbId: string, notePath: string, links: string[]): void {
    const map = this.ensure(kbId);
    map.set(notePath, new Set(links));
  }

  removeNote(kbId: string, notePath: string): void {
    this.ensure(kbId).delete(notePath);
  }

  renameNote(kbId: string, oldPath: string, newPath: string): void {
    const map = this.ensure(kbId);
    const set = map.get(oldPath);
    if (set) {
      map.delete(oldPath);
      map.set(newPath, set);
    }
  }

  getOutlinks(kbId: string, notePath: string): string[] {
    return [...(this.ensure(kbId).get(notePath) || new Set<string>())];
  }

  getAllOutlinks(kbId: string): Map<string, Set<string>> {
    return this.ensure(kbId);
  }

  /**
   * 反向链接：所有 指向 target 的笔记
   */
  getBacklinks(kbId: string, targetPath: string): string[] {
    const map = this.ensure(kbId);
    const targetName = targetPath.replace(/\.md$/i, '');
    const result = new Set<string>();
    for (const [notePath, links] of map) {
      for (const l of links) {
        if (l === targetName || l === targetPath) result.add(notePath);
      }
    }
    return [...result];
  }

  /**
   * 解析链接 target 为真实路径
   */
  resolve(kbId: string, target: string): string | undefined {
    const map = this.ensure(kbId);
    // 1. 直接匹配文件名（不含 .md）
    for (const p of map.keys()) {
      if (p === target || p === `${target}.md` || p.replace(/\.md$/i, '') === target) return p;
    }
    return undefined;
  }
}

export const linkIndex = new LinkIndex();
