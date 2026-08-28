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
  // 工具调用活动（agent / 时间路由过程中 AI 调用的工具，#4）
  toolActivity?: Array<{ name: string; args: Record<string, unknown>; result: string }>;
  ts: number;
}

export interface ChatConversation {
  id: string;
  title: string; // 取首条用户消息前 30 字
  kbId?: string; // 关联知识库
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  /**
   * 关联的主进程 AI 会话 id（doc/AI智能管家重构方案.md §5.3 P1-3）。
   * 此前该映射由 ChatPage 的 convSessionMap（内存 ref）持有，刷新即丢失，
   * 导致重开对话后多轮上下文断裂。改为持久化在会话对象上后：
   * 主进程 session-store 亦已落盘，二者配合可实现跨重启续接。
   */
  sessionId?: string;
}

interface ChatState {
  conversations: ChatConversation[];
  activeId: string | null;
  /** 首页问答跳到 ChatPage 时携带：标记新会话应在挂载后自动触发一次 AI 回复，触发后置空 */
  pendingAutoSendId: string | null;

  // CRUD
  createConversation: (params: {
    firstUserText: string;
    kbId?: string;
    autoSend?: boolean;
  }) => string; // 返回新会话 id
  appendMessage: (convId: string, msg: ChatMessage) => void;
  renameConversation: (convId: string, title: string) => void;
  deleteConversation: (convId: string) => void;
  clearAll: () => void;
  setActive: (id: string | null) => void;
  /** 绑定主进程 AI 会话 id（多轮上下文持久化用） */
  setConversationSession: (convId: string, sessionId: string) => void;
  /** ChatPage 消费待发送标记：返回当前 pendingAutoSendId 并清空 */
  consumeAutoSend: () => string | null;
}

const genId = () => 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const deriveTitle = (text: string) => {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > 30 ? clean.slice(0, 30) + '…' : clean;
};

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      conversations: [],
      activeId: null,
      pendingAutoSendId: null,

      createConversation: ({ firstUserText, kbId, autoSend }) => {
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
          // 首页问答跳转到 ChatPage 后，需要自动触发一次 AI 回复（由 ChatPage 挂载 effect 消费）
          pendingAutoSendId: autoSend ? id : s.pendingAutoSendId,
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

      clearAll: () => set({ conversations: [], activeId: null, pendingAutoSendId: null }),

      setActive: (id) => set({ activeId: id }),

      setConversationSession: (convId, sessionId) =>
        set((s) => ({
          conversations: s.conversations.map((c) => (c.id === convId ? { ...c, sessionId } : c)),
        })),

      /** ChatPage 挂载时调用：取走待发送标记，避免重复触发 */
      consumeAutoSend: () => {
        const id = get().pendingAutoSendId;
        if (id) set({ pendingAutoSendId: null });
        return id;
      },
    }),
    {
      name: 'forge.chat',
      partialize: (s) => ({ conversations: s.conversations, activeId: s.activeId }),
    }
  )
);
