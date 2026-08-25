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

// 目录级笔记模板信息
export interface NoteTemplateInfo {
  dirId: string;
  dirName: string;
  dirPath: string; // 真实目录相对路径
  content: string;
  builtinContent?: string; // 内置默认模板内容（用于"重置"）
  hasCustom: boolean; // 用户是否自定义过
  variables: string[]; // 支持的变量列表
}
