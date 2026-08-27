// AI 对话历史 store：管理多个 AI 对话
// 一个 conversation = { id, title, kbId, messages[], createdAt, updatedAt }
// messages: { role: 'user' | 'assistant', text, refs?: NoteHit[] }

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  // AI 回答时引用的笔记命中
  refs?: Array<{ path: string; name: string; snippet?: string }>;
  // 本次调用的 token 用量（成本可观测，方案 §三.3）
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number; ms: number };
  ts: number;
}

export interface ChatConversation {
  id: string;
  title: string; // 取首条用户消息前 30 字
  kbId?: string; // 关联知识库
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

interface ChatState {
  conversations: ChatConversation[];
  activeId: string | null;

  // CRUD
  createConversation: (params: {
    firstUserText: string;
    kbId?: string;
  }) => string; // 返回新会话 id
  appendMessage: (convId: string, msg: ChatMessage) => void;
  renameConversation: (convId: string, title: string) => void;
  deleteConversation: (convId: string) => void;
  clearAll: () => void;
  setActive: (id: string | null) => void;
}

const genId = () => 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const deriveTitle = (text: string) => {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > 30 ? clean.slice(0, 30) + '…' : clean;
};

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      conversations: [],
      activeId: null,

      createConversation: ({ firstUserText, kbId }) => {
        const id = genId();
        const now = Date.now();
        const conv: ChatConversation = {
          id,
          title: deriveTitle(firstUserText) || '新对话',
          kbId,
          messages: [{ id: genId(), role: 'user', text: firstUserText, ts: now }],
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({
          conversations: [conv, ...s.conversations],
          activeId: id,
        }));
        return id;
      },

      appendMessage: (convId, msg) => {
        const safeMsg: ChatMessage = 'id' in msg && (msg as ChatMessage).id
          ? (msg as ChatMessage)
          : { ...(msg as ChatMessage), id: genId() };
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === convId
              ? { ...c, messages: [...c.messages, safeMsg], updatedAt: Date.now() }
              : c
          ),
        }));
      },

      renameConversation: (convId, title) => {
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === convId ? { ...c, title } : c
          ),
        }));
      },

      deleteConversation: (convId) => {
        set((s) => ({
          conversations: s.conversations.filter((c) => c.id !== convId),
          activeId: s.activeId === convId ? null : s.activeId,
        }));
      },

      clearAll: () => set({ conversations: [], activeId: null }),

      setActive: (id) => set({ activeId: id }),
    }),
    {
      name: 'forge.chat',
      partialize: (s) => ({ conversations: s.conversations, activeId: s.activeId }),
    }
  )
);
