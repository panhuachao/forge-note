// 笔记版本历史类型定义（doc/笔记版本实现方案.md §5.1）
// 主进程与渲染进程共用。
//
// 注意：shared 层不可反向依赖 main 层（会导致渲染进程打包时引入主进程代码），
// 因此 DiffLine 在此处定义，由 src/main/utils/diff.ts 引入，而非相反。

/** 结构化 diff 行，供版本历史 UI 按行着色 */
export interface DiffLine {
  type: 'add' | 'del' | 'ctx' | 'gap';
  text: string;
  oldLineNo?: number;
  newLineNo?: number;
}

/** 版本来源 */
export type VersionSource =
  /** 自动快照：编辑产生变化并越过静默期后创建 */
  | 'auto'
  /** 用户手动保存（可附备注） */
  | 'manual'
  /** AI 修改前自动创建 */
  | 'ai'
  /** 恢复操作前自动创建（保证恢复可撤销） */
  | 'pre-restore'
  /** 移动 / 重命名前自动创建 */
  | 'pre-move';

/** 单个版本元数据 */
export interface NoteVersion {
  /** 版本 id，格式 v_<时间戳36进制>_<随机> */
  id: string;
  /** 所属笔记 id（首次路径的哈希，终身不变） */
  noteId: string;
  /** 创建时间（自记录；不能用 birthtime，atomicWrite 的 rename 会改 inode） */
  at: number;
  /** 版本来源 */
  source: VersionSource;
  /** 用户备注（仅 manual 来源有） */
  note?: string;
  /** 内容 sha1，用于去重与完整性校验 */
  hash: string;
  /** 内容字节数（UTF-8） */
  size: number;
  /** 相对上一版本的增删行数；首个版本为 null */
  delta: { added: number; removed: number } | null;
}

/** 单笔记版本索引（meta.json） */
export interface NoteVersionMeta {
  noteId: string;
  /** 当前笔记路径（move / rename 时更新） */
  notePath: string;
  /** 笔记标题快照：笔记被删除后仍可显示可读名称 */
  title: string;
  /** 按时间倒序（最新在前） */
  versions: NoteVersion[];
  updatedAt: number;
}

/** 全局索引（index.json） */
export interface VersionIndex {
  version: 1;
  /** noteId → 简要信息：避免每次列目录都遍历全部 meta.json */
  notes: Record<string, { notePath: string; title: string; count: number; lastAt: number }>;
}

/** 版本列表项（渲染层使用） */
export interface VersionListItem extends NoteVersion {
  /** 快照文件是否仍存在（防止用户手工删文件导致 UI 报错） */
  available: boolean;
}

/** 某笔记的版本概览（RightPanel 展示用） */
export interface VersionSummary {
  count: number;
  lastAt: number | null;
}
