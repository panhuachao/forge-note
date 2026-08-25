// 知识库相关类型

export interface KnowledgeBase {
  id: string;
  name: string;
  rootPath: string;
  templateId?: string;
  createdAt: number;
}

export interface KBSummary {
  id: string;
  name: string;
  rootPath: string;
  noteCount: number;
  templateId?: string;
}
