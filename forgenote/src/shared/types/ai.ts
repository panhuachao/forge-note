// AI 相关类型

export interface AIModelConfig {
  provider: 'ollama' | 'openai' | 'none';
  baseUrl?: string;
  model?: string;
  apiKey?: string;
}

export interface DirSuggestion {
  dirId: string;
  dirName: string;
  dirPath: string;
  reason: string;
  confidence: number;
}

export interface CardDraft {
  title: string;
  status: 'L1' | 'L2' | 'L3';
  source: string;
  createdAt: string;
  coreIdea: string;
  details: string;
  actionable: string[];
  verification: string;
  relatedLinks: string[];
  suggestedTarget: { dirId: string; dirName: string; reason: string };
}

export interface AIConfigPreset {
  name: string;
  content: string;
  active: boolean;
}
