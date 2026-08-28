// 模板相关类型

export interface TemplateDir {
  id: string;
  name: string;
  icon: string;
  color: string;
  readme: string;
  noteTemplate: string;
  flow: string[];
  sink?: boolean;
}

export interface TemplateMeta {
  templateId: string;
  name: string;
  version: string;
  author: string;
  description: string;
  dirs: TemplateDir[];
  aiConfig: string;
}

export interface AppliedTemplate {
  kbId: string;
  meta: TemplateMeta;
  rootPath: string;
  aiConfigContent: string;
  dirReadmes: Record<string, string>;
  dirNoteTemplates: Record<string, string>;
  appliedAt: number;
}
