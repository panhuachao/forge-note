// 文件系统与笔记类型

export type NodeKind = 'kb_root' | 'dir' | 'file' | 'special';

export interface TreeNode {
  id: string;
  name: string;
  path: string;
  kind: NodeKind;
  children?: TreeNode[];
  templateDirId?: string;
  templateIcon?: string;
  templateColor?: string;
  special?: 'readme' | 'ai_config' | 'note_template' | 'meta';
  noteCount?: number;
  mtime?: number;
}

export interface NoteInfo {
  path: string;
  name: string;
  dirPath: string;
  templateDirId?: string;
  mtime: number;
  size: number;
}

export interface NoteContent {
  path: string;
  content: string;
  frontmatter: Record<string, unknown>;
  mtime: number;
  outlinks: string[];
  inlinks: string[];
  brokenLinks: string[];
}

export interface LinkInfo {
  target: string;
  targetPath?: string;
  kind: 'flow' | 'semantic';
  reason: string;
  score: number;
}
