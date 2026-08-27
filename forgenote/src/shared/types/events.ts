// 搜索与事件

export interface SearchResult {
  notePath: string;
  noteName: string;
  snippet: string;
  templateDirId?: string;
  matchType: 'title' | 'content' | 'tag' | 'link';
  score: number;
  heading?: string;   // 所属标题（RAG 分块面包屑）
  startLine?: number; // 片段起始行（引用锚点）
}

export type FSChangeEvent =
  | { type: 'add'; path: string; isDir: boolean }
  | { type: 'unlink'; path: string; isDir: boolean }
  | { type: 'change'; path: string }
  | { type: 'addDir'; path: string }
  | { type: 'unlinkDir'; path: string };

export interface ToastMessage {
  id: string;
  level: 'info' | 'success' | 'warn' | 'error';
  text: string;
  duration?: number;
}

export interface AuditEntry {
  id: string;
  ts: number;
  action: 'move' | 'insertLink' | 'forge' | 'applyTemplate' | 'removeTemplate';
  payload: Record<string, unknown>;
  undone?: boolean;
}
