// 双向链接索引（内存）
import { getKB } from './store';

class LinkIndex {
  // kbId -> notePath -> Set<outlink target>
  private outlinks = new Map<string, Map<string, Set<string>>>();

  /** 去掉 .md 后缀并统一首尾空白，用于无感大小写与后缀匹配 */
  private normalize(s: string): string {
    return s.trim().replace(/\.md$/i, '');
  }

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
   * target 支持「path 形式」或「纯名（basename）形式」，统一按 basename（去 .md）匹配，
   * 因为 extractWikiLinks 取出的出链是 basename（如 [[笔记B]] -> "笔记B"）。
   */
  getBacklinks(kbId: string, targetPath: string): string[] {
    const map = this.ensure(kbId);
    const targetBase = this.normalize(targetPath.split('/').pop() || targetPath);
    const result = new Set<string>();
    for (const [notePath, links] of map) {
      for (const l of links) {
        const lBase = this.normalize(l.split('/').pop() || l);
        if (lBase === targetBase || l === targetPath) result.add(notePath);
      }
    }
    return [...result];
  }

  /**
   * 返回某一知识库内所有笔记路径（用于唯一性校验等）。
   */
  getAllNotePaths(kbId: string): string[] {
    return [...this.ensure(kbId).keys()];
  }

  /**
   * 解析链接 target 为真实路径
   * 匹配规则（按顺序）：
   *  1. 完整 notePath 相等 / +.md 相等 / 去 .md 相等 / target 去 .md 与 notePath 去 .md 相等
   *  2. notePath 的 basename（去 .md）等于 target（去 .md）
   *
   * 注意：用户可能在 wiki link 里显式写 .md 后缀（如 [[笔记A.md]]），
   * 此时 target 与文件实际路径都需要先去掉 .md 再比较，否则所有带 .md 后缀的跨目录链接都会失效。
   */
  resolve(kbId: string, target: string): string | undefined {
    const map = this.ensure(kbId);
    const t = target.trim();
    const tNoMd = this.normalize(t);
    // 完整路径匹配
    for (const p of map.keys()) {
      const pNoMd = this.normalize(p);
      if (p === t || p === `${t}.md` || pNoMd === tNoMd || pNoMd === t) return p;
    }
    // 退化匹配：按 basename（去 .md）匹配，便于 [[笔记名]] 跨目录解析
    for (const p of map.keys()) {
      const base = this.normalize(p.split('/').pop() || '');
      if (base === tNoMd || base === t) return p;
    }
    return undefined;
  }
}

export const linkIndex = new LinkIndex();
