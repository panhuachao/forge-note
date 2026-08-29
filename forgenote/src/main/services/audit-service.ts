// 审计日志服务 - 包装 store，提供撤销能力
import { promises as fs } from 'fs';
import { join, dirname, basename } from 'path';
import { nanoid } from 'nanoid';
import { getKB, addAudit, listAudit, markAuditUndone } from './store';
import { safeJoin } from '../utils/fs';

class AuditService {
  list(kbId: string) {
    return listAudit(kbId);
  }

  /**
   * 撤销：移动文件 - 把文件移回原位置
   * 撤销：插入链接 - 从目标文件删除 [[xxx]]
   * 撤销：锻造 - 删除新卡片文件
   */
  async undo(kbId: string, auditId: string): Promise<void> {
    const list = listAudit(kbId);
    const entry = list.find((e) => e.id === auditId);
    if (!entry || entry.undone) return;
    const kb = getKB(kbId);
    if (!kb) return;

    if (entry.action === 'move') {
      const { fromPath, toPath } = entry.payload as { fromPath: string; toPath: string };
      if (typeof fromPath === 'string' && typeof toPath === 'string') {
        const toAbs = safeJoin(kb.rootPath, toPath);
        const fromAbs = safeJoin(kb.rootPath, fromPath);
        try {
          await fs.mkdir(dirname(fromAbs), { recursive: true });
          await fs.rename(toAbs, fromAbs);
        } catch (e) {
          console.error('撤销移动失败', e);
        }
      }
    } else if (entry.action === 'insertLink') {
      const { notePath, target } = entry.payload as { notePath: string; target: string };
      if (notePath && target) {
        const abs = safeJoin(kb.rootPath, notePath);
        const content = await fs.readFile(abs, 'utf-8').catch(() => '');
        // 删除 [[target]] 与 [[target|alias]] 两种形式
        const re = new RegExp(`\\[\\[${target}(\\|[^\\]]+)?\\]\\]`, 'g');
        const updated = content.replace(re, '').replace(/[ \t]+(\n|$)/g, '$1');
        await fs.writeFile(abs, updated, 'utf-8');
      }
    } else if (entry.action === 'forge') {
      const { newCardPath } = entry.payload as { newCardPath: string };
      if (newCardPath) {
        const abs = safeJoin(kb.rootPath, newCardPath);
        await fs.unlink(abs).catch(() => {});
      }
    }
    markAuditUndone(auditId);
  }

  record(
    kbId: string,
    action: 'move' | 'insertLink' | 'forge' | 'applyTemplate' | 'removeTemplate' | 'aiPatch' | 'confirmableAction',
    payload: Record<string, unknown>,
    source?: string
  ) {
    addAudit({ id: nanoid(), ts: Date.now(), action, payload, source }, kbId);
  }
}

export const auditService = new AuditService();
