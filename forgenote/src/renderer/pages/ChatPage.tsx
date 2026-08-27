// AI 对话聊天页面
// 左侧：对话历史列表（标题 + 时间 + 删除）
// 右侧：当前对话的消息流 + 输入框

import { useEffect, useMemo, useRef, useState } from 'react';
import { useChatStore } from '../stores/chat-store';
import { useKBStore } from '../stores/kb-store';
import { useLayoutStore } from '../stores/layout-store';
import {
  AI_SERVICE_MODELS,
  ModelOption,
  AIModelConfig,
  inferServiceProvider,
  normalizeAIModelConfig
} from '@shared/types/ai';
import { Icon } from '../components/Icon';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { renderMarkdownPreview } from '../utils/markdown-preview';
import {
  handleTitleBarDoubleClick,
  TITLEBAR_DRAG_STYLE,
  TITLEBAR_NO_DRAG_STYLE
} from '../lib/window-control';

export default function ChatPage() {
  const conversations = useChatStore((s) => s.conversations);
  const activeId = useChatStore((s) => s.activeId);
  const setActive = useChatStore((s) => s.setActive);
  const createConversation = useChatStore((s) => s.createConversation);
  const appendMessage = useChatStore((s) => s.appendMessage);
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const renameConversation = useChatStore((s) => s.renameConversation);

  const activeKb = useKBStore((s) => s.activeKb);
  const kbs = useKBStore((s) => s.kbs);
  const setActiveKb = useKBStore((s) => s.setActiveKb);
  const aiConfig = useKBStore((s) => s.aiConfig);
  const setAIConfig = useKBStore((s) => s.setAIConfig);

  const setMainView = useLayoutStore((s) => s.setMainView);
  const openTab = useLayoutStore((s) => s.openTab);

  const activeConv = useMemo(
    () => conversations.find((c) => c.id === activeId) || null,
    [conversations, activeId]
  );

  // 当前服务商可选模型（默认使用设置中的默认模型）
  const serviceProvider = inferServiceProvider(aiConfig);
  const currentModels: ModelOption[] =
    serviceProvider !== 'none' ? AI_SERVICE_MODELS[serviceProvider] : [];

  const switchModel = async (id: string) => {
    const next: AIModelConfig = { ...aiConfig, model: id };
    setAIConfig(next);
    try {
      await window.forge.ai.setConfig(next);
    } catch (e) {
      console.error(e);
    }
  };

  /** 把 [[笔记名]] 解析为笔记路径（遍历目录树，方案 §三.2） */
  const resolveWikiLink = async (name: string): Promise<string | null> => {
    if (!activeKb) return null;
    try {
      const tree = await window.forge.fs.listTree(activeKb.id);
      let hit: string | null = null;
      const walk = (nodes: any[]) => {
        for (const n of nodes) {
          if (hit) return;
          if (n.type === 'file' && n.name.replace(/\.md$/i, '') === name) {
            hit = n.path;
            return;
          }
          if (n.children) walk(n.children);
        }
      };
      walk(tree?.children ?? []);
      return hit;
    } catch {
      return null;
    }
  };

  /** 点击引用卡片 / 回答内 [[笔记名]] 链接，跳转到对应笔记 */
  const openWikiLink = async (name: string) => {
    const path = await resolveWikiLink(name);
    if (path) {
      openTab(path);
      setMainView('note');
    } else {
      // 未找到则退化为全局搜索
      window.dispatchEvent(new CustomEvent('forgenote:search', { detail: { q: name } }));
    }
  };

  /** 拦截 markdown 内的 wiki-link 点击 */
  const onWikiLinkClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const a = target.closest('a.wiki-link') as HTMLAnchorElement | null;
    if (a) {
      e.preventDefault();
      const name = decodeURIComponent((a.getAttribute('href') || '').replace(/^#wiki=/, ''));
      if (name) openWikiLink(name);
    }
  };

  // 输入
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  // 流式输出缓冲：正在生成中的 assistant 文本，逐 token 累积（方案 §三.1）；toolActivity 为工具调用气泡（#4）
  const [streaming, setStreaming] = useState<{
    text: string;
    toolActivity?: { name: string; args: Record<string, unknown>; result: string }[];
  } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 240) + 'px';
  }, [input]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activeConv?.messages.length, loading]);

  // 进入页面时从主进程同步最新 AI 配置到渲染层（确保模型下拉/发送使用真实配置）
  useEffect(() => {
    (async () => {
      try {
        const remote = await window.forge.ai.getConfig();
        if (remote && remote.provider !== 'none') {
          // 补全 serviceProvider / model / baseUrl 默认值
          const normalized = normalizeAIModelConfig(remote);
          setAIConfig(normalized);
          // 同步回主进程，确保后续调用无需每次兜底
          if (!remote.serviceProvider || !remote.model || !remote.baseUrl) {
            await window.forge.ai.setConfig(normalized);
          }
        }
      } catch (e) {
        console.error('[ChatPage] getConfig failed', e);
      }
    })();
  }, []);

  // 重命名（inline）
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  // 会话级 AI session 映射（每轮对话独立多轮上下文，见 doc/AI调用重构技术方案.md §4.2）
  const convSessionMap = useRef<Record<string, string>>({});
  // 智能体模式：开启后 AI 可主动调用知识库 MCP 工具
  const [agentMode, setAgentMode] = useState(false);
  // 自动路由模式：开启后由模型从已注册能力中挑选最合适的 skill（#1）
  const [routeMode, setRouteMode] = useState(false);
  // 待删除的对话 id（null 时不显示确认弹窗）
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const startNewConversation = () => {
    setActive(null);
    setInput('');
  };

  // 新对话引导区的快捷提问（点击即可直接发送）
  const [quickPrompts, setQuickPrompts] = useState<string[]>([]);
  useEffect(() => {
    window.forge.ai.getPrompts().then((p) => setQuickPrompts(p.chatQuickPrompts));
  }, []);

  const useQuickPrompt = (text: string) => {
    setInput(text);
    // 等待受控输入框更新后再发送，确保发送的是该快捷提问
    requestAnimationFrame(() => {
      (async () => {
        await sendWithText(text);
      })();
    });
  };

  const sendWithText = async (text: string) => {
    const t = text.trim();
    if (!t || !activeKb) return;

    let convId = activeId;
    if (!convId) {
      convId = createConversation({ firstUserText: t, kbId: activeKb.id });
    } else {
      appendMessage(convId, { role: 'user', text: t, ts: Date.now() });
    }
    setInput('');
    setLoading(true);

    try {
      const remote = await window.forge.ai.getConfig();
      const localEnabled = aiConfig.provider !== 'none' && !!aiConfig.model;
      if ((!remote || remote.provider === 'none' || !remote.model) && localEnabled) {
        await window.forge.ai.setConfig(aiConfig);
      }
      // 统一 AIHub：携带该对话的 sessionId，实现多轮上下文（建议→确认→执行）
      // 智能体模式下走 agent skill，AI 可主动调用知识库 MCP 工具（检索/读/写/诊断）
      // auto 模式由模型从已注册能力中自路由（#1）
      const skill = agentMode ? 'agent' : routeMode ? 'auto' : 'ask';
      const existingSession = convSessionMap.current[convId!];
      // 若本对话尚未建立 AI session（如刚打开已持久化的旧对话），用已存的消息历史作为种子，
      // 让多轮上下文在刷新/重开后依然连续（方案 §4.2）。
      const seedHistory: { role: 'user' | 'assistant'; text: string }[] = existingSession
        ? []
        : conversations
            .find((c) => c.id === convId)
            ?.messages.filter((m) => m.role !== 'user' || m.text !== t)
            .map((m) => ({ role: m.role, text: m.text })) ?? [];
      const streamId = `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      // 流式渲染：本地累积 token，最后再落盘完整消息（方案 §三.1）
      // 同时累积工具调用活动（agent / 时间路由），渲染为「工具调用气泡」（#4）
      let acc = '';
      const toolActs: { name: string; args: Record<string, unknown>; result: string }[] = [];
      const off = window.forge.ai.onAIStream((chunk) => {
        if (chunk.streamId !== streamId) return;
        acc += chunk.delta;
        setStreaming((s) => ({ ...s, text: acc }));
      });
      const offAct = window.forge.ai.onToolActivity?.((chunk: { streamId: string; activity: any }) => {
        if (chunk.streamId !== streamId) return;
        toolActs.push(chunk.activity);
        setStreaming((s) => ({ ...s, text: acc, toolActivity: [...toolActs] }));
      });
      const res = (await window.forge.ai.hubRunStream({
        skill,
        input: { question: t, text: t },
        kbId: activeKb.id,
        sessionId: existingSession,
        history: seedHistory,
        streamId
      } as any)) as any;
      off();
      offAct?.();
      if (res?.sessionId) convSessionMap.current[convId!] = res.sessionId;
      const ans =
        res?.kind === 'text'
          ? res.text
          : res?.kind === 'structured'
            ? JSON.stringify(res.data)
            : acc || '（AI 未返回内容）';
      setStreaming(null);
      appendMessage(convId!, {
        role: 'assistant',
        text: ans || acc || '（AI 未返回内容）',
        ts: Date.now(),
        refs: res?.refs,
        usage: res?.usage,
        toolActivity: toolActs.length ? toolActs : undefined
      });
    } catch (err) {
      appendMessage(convId!, {
        role: 'assistant',
        text: `错误：${String(err)}\n\n请检查设置中的 AI 模型配置（provider/baseUrl/apiKey/model）。`,
        ts: Date.now(),
      });
    } finally {
      setLoading(false);
    }
  };

  const send = () => sendWithText(input);

  return (
    <div className="flex-1 flex bg-content overflow-hidden">
      {/* 左侧：对话历史 */}
      <div className="w-64 border-r border-border bg-panel flex flex-col">
        <div
          className="h-14 pl-[72px] pr-3 flex items-center justify-between border-b border-border bg-toolbar"
          style={TITLEBAR_DRAG_STYLE}
          onDoubleClick={handleTitleBarDoubleClick}
        >
          <span className="flex items-center gap-1.5 text-sm font-semibold text-fg">
            <Icon name="chat-bubble" className="w-4 h-4 text-brand" />
            对话历史
          </span>
          <button
            onClick={startNewConversation}
            title="新建对话"
            className="w-7 h-7 flex items-center justify-center text-fg-muted hover:bg-hover-bg rounded"
            style={TITLEBAR_NO_DRAG_STYLE}
          >
            <Icon name="plus" className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {conversations.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center px-4 text-center">
              <div className="w-10 h-10 rounded-xl bg-hover-bg flex items-center justify-center mb-3">
                <Icon name="chat-bubble" className="w-5 h-5 text-fg-muted" />
              </div>
              <p className="text-xs text-fg-secondary mb-1">还没有对话</p>
              <p className="text-[11px] text-fg-faint mb-4">点击右上角 + 开始提问</p>
              <button
                onClick={startNewConversation}
                className="btn btn-primary text-xs px-3 py-1.5"
                style={TITLEBAR_NO_DRAG_STYLE}
              >
                新建对话
              </button>
            </div>
          ) : (
            <ul className="space-y-1">
              {conversations.map((c) => (
                <li
                  key={c.id}
                  onClick={() => setActive(c.id)}
                  className={`group relative rounded-xl px-3 py-2.5 cursor-pointer transition-colors ${
                    activeId === c.id
                      ? 'bg-brand-soft/40'
                      : 'hover:bg-hover-bg'
                  }`}
                >
                  {/* 选中态左侧品牌色竖条 */}
                  {activeId === c.id && (
                    <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-brand" />
                  )}
                  <div className="flex items-center justify-between gap-2">
                    {editingId === c.id ? (
                      <input
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onBlur={() => {
                          if (editingTitle.trim()) {
                            renameConversation(c.id, editingTitle.trim());
                          }
                          setEditingId(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        autoFocus
                        className="flex-1 px-1.5 py-0.5 text-xs border border-border-strong rounded-lg outline-none bg-content"
                      />
                    ) : (
                      <span
                        className="flex-1 text-xs text-fg truncate font-medium"
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          setEditingId(c.id);
                          setEditingTitle(c.title);
                        }}
                        title={c.title}
                      >
                        {c.title}
                      </span>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmingDeleteId(c.id);
                      }}
                      className="w-6 h-6 flex items-center justify-center rounded-lg text-fg-faint hover:text-red-500 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all"
                      title="删除"
                    >
                      <Icon name="trash" className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[10px] text-fg-faint">
                      {new Date(c.updatedAt).toLocaleString('zh-CN', {
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    {activeId === c.id && (
                      <span className="text-[10px] text-brand">当前</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* 右侧：聊天区 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 顶部栏：返回 + 标题（与统一标题栏样式一致：h-14 pl-[72px] bg-toolbar border-b） */}
        <div
          className="h-14 pl-[72px] pr-3 flex items-center gap-2 border-b border-border bg-toolbar"
          style={TITLEBAR_DRAG_STYLE}
          onDoubleClick={handleTitleBarDoubleClick}
        >
          <button
            onClick={() => setMainView('home')}
            className="w-7 h-7 flex items-center justify-center text-fg-muted hover:bg-hover-bg rounded"
            title="返回首页"
            style={TITLEBAR_NO_DRAG_STYLE}
          >
            <Icon name="arrow-left" className="w-4 h-4" />
          </button>
          <span className="text-sm font-medium text-fg truncate">
            {activeConv ? activeConv.title : '新对话'}
          </span>
        </div>

        {/* 消息流 */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4">
          {!activeConv ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-6">
              <div className="w-14 h-14 rounded-2xl bg-brand-soft flex items-center justify-center mb-4 shadow-sm">
                <Icon name="chat-bubble" className="w-7 h-7 text-brand" />
              </div>
              <p className="text-base font-semibold text-fg mb-1">开始一次新对话</p>
              <p className="text-xs text-fg-muted mb-5 max-w-xs leading-relaxed">
                在下方输入框输入问题，AI 将基于当前知识库为你作答
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2 max-w-sm mb-5">
                {quickPrompts.map((p) => (
                  <button
                    key={p}
                    onClick={() => useQuickPrompt(p)}
                    disabled={loading}
                    className="px-3 py-1.5 text-[11px] text-fg-secondary bg-hover-bg hover:bg-brand-soft hover:text-brand rounded-full border border-border-soft transition-colors disabled:opacity-50"
                  >
                    {p}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 text-[11px] text-fg-faint">
                <span className="px-2 py-1 rounded-md bg-hover-bg">Enter 发送</span>
                <span className="px-2 py-1 rounded-md bg-hover-bg">Shift+Enter 换行</span>
              </div>
            </div>
          ) : (
            <div className="max-w-2xl mx-auto space-y-3">
              {activeConv.messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}
                >
                  <div
                    className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${
                      m.role === 'user'
                        ? 'bg-brand text-brand-fg whitespace-pre-wrap'
                        : 'bg-content border border-border-soft text-fg'
                    }`}
                  >
                    {m.role === 'user' ? (
                      m.text
                    ) : (
                      <div
                        className="markdown-preview chat-md leading-relaxed"
                        onClick={onWikiLinkClick}
                        dangerouslySetInnerHTML={{
                          __html: renderMarkdownPreview(m.text, activeKb?.id || '', '')
                        }}
                      />
                    )}
                  </div>
                  {m.role === 'assistant' && (
                    <>
                      {/* 工具调用气泡（#4）：agent / 时间路由过程中调用的工具，点击可见参数与结果 */}
                      {m.toolActivity && m.toolActivity.length > 0 && (
                        <div className="mt-1.5 flex flex-col gap-1 w-full max-w-[80%]">
                          <span className="text-[10px] text-fg-faint px-1">工具调用</span>
                          {m.toolActivity.map((a, ai) => (
                            <details
                              key={ai}
                              className="px-2.5 py-1 rounded-lg bg-hover-bg border border-border-soft"
                            >
                              <summary className="flex items-center gap-1.5 cursor-pointer text-[11px] text-fg-secondary">
                                <Icon name="cpu" className="w-3 h-3 text-brand" />
                                <span className="font-mono text-brand">{a.name}</span>
                                <span className="text-fg-faint">{String(a.result || '').slice(0, 40)}</span>
                              </summary>
                              <pre className="mt-1 text-[10px] text-fg-secondary whitespace-pre-wrap break-all">
                                {JSON.stringify(a.args, null, 2)}
                              </pre>
                            </details>
                          ))}
                        </div>
                      )}
                      {/* 引用溯源卡片（方案 §三.2）：点击跳转到对应笔记 */}
                      {m.refs && m.refs.length > 0 && (
                        <div className="mt-1.5 flex flex-col gap-1 w-full max-w-[80%]">
                          <span className="text-[10px] text-fg-faint px-1">引用来源</span>
                          {m.refs.map((r, ri) => (
                            <button
                              key={ri}
                              onClick={() => openWikiLink(r.name)}
                              className="text-left px-2.5 py-1.5 rounded-lg bg-panel border border-border-soft hover:border-brand hover:bg-hover-bg transition-colors"
                              title={r.path}
                            >
                              <div className="flex items-center gap-1 text-xs text-brand font-medium">
                                <Icon name="link" className="w-3 h-3" />
                                {r.name}
                              </div>
                              {r.snippet && (
                                <div className="text-[11px] text-fg-secondary mt-0.5 line-clamp-2">{r.snippet}</div>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="mt-1.5 flex items-center gap-2">
                        <button
                          onClick={() =>
                            window.dispatchEvent(
                              new CustomEvent('forgenote:open-quicknote', { detail: { content: m.text } })
                            )
                          }
                          className="flex items-center gap-1 px-2 py-1 text-[11px] text-fg-muted hover:text-brand hover:bg-hover-bg rounded-lg transition-colors"
                          title="将这段回答整理为笔记"
                        >
                          <Icon name="document-plus" className="w-3.5 h-3.5" />
                          添加笔记
                        </button>
                        {m.usage && m.usage.totalTokens > 0 && (
                          <span
                            className="px-2 py-1 text-[10px] text-fg-faint bg-hover-bg rounded-lg"
                            title={`${m.usage.promptTokens} prompt + ${m.usage.completionTokens} 生成 · ${m.usage.ms}ms`}
                          >
                            ~{m.usage.totalTokens} tokens
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </div>
              ))}
              {loading && (
                <div className="flex flex-col items-start">
                  {streaming?.toolActivity && streaming.toolActivity.length > 0 && (
                    <div className="mb-1 flex flex-col gap-1 w-full max-w-[80%]">
                      {streaming.toolActivity.map((a, ai) => (
                        <div
                          key={ai}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-hover-bg border border-border-soft text-[11px] text-fg-secondary"
                        >
                          <Icon name="cpu" className="w-3 h-3 text-brand" />
                          <span className="font-mono text-brand">{a.name}</span>
                          <span className="text-fg-faint">{String(a.result || '').slice(0, 40)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="bg-content border border-border-soft rounded-xl px-3 py-2 text-sm text-fg markdown-preview chat-md leading-relaxed">
                    {streaming ? (
                      <>
                        {streaming.text}
                        <span className="inline-block w-1.5 h-4 align-middle bg-brand animate-pulse ml-0.5" />
                      </>
                    ) : (
                      <span className="text-fg-muted">思考中…</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 底部输入区（与 HomePage 类似） */}
        <div className="border-t border-border-soft bg-toolbar px-6 py-3">
          <div className="max-w-2xl mx-auto">
            <div className="rounded-2xl border border-border-soft bg-content shadow-sm">
              <div className="px-4 pt-3 pb-2">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  rows={2}
                  placeholder="继续提问…  Enter 发送，Shift+Enter 换行"
                  className="w-full bg-transparent outline-none text-sm text-fg placeholder:text-fg-faint resize-none min-h-[60px] max-h-[240px] leading-6"
                  disabled={loading}
                />
                <div className="flex items-center justify-between pt-1">
                  <button
                    title="附件"
                    className="w-7 h-7 flex items-center justify-center text-fg-muted hover:bg-hover-bg rounded-xl"
                  >
                    <Icon name="plus" className="w-4 h-4" />
                  </button>
                  <div className="flex items-center gap-2">
                    {currentModels.length > 0 ? (
                      <div className="relative group">
                        <button className="flex items-center gap-1 px-2 py-0.5 rounded-xl text-[11px] text-fg-secondary hover:bg-hover-bg">
                          <Icon name="bolt" className="w-3 h-3" />
                          <span>{aiConfig.model || currentModels[0].label}</span>
                          <Icon name="chevron-down" className="w-3 h-3" />
                        </button>
                        <div className="absolute right-0 bottom-full mb-1 bg-content border border-border-soft rounded-xl shadow-lg z-30 hidden group-hover:block min-w-[180px] overflow-hidden">
                          {currentModels.map((m) => {
                            const active = (aiConfig.model || currentModels[0].id) === m.id;
                            return (
                              <button
                                key={m.id}
                                onClick={() => switchModel(m.id)}
                                className={`block w-full text-left px-3 py-1.5 text-xs hover:bg-hover-bg ${
                                  active ? 'text-brand bg-brand-soft/40' : 'text-fg-secondary'
                                }`}
                              >
                                {m.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setMainView('settings')}
                        className="text-[11px] text-brand hover:underline"
                      >
                        配置模型
                      </button>
                    )}
                    <button
                      title="语音"
                      className="w-7 h-7 flex items-center justify-center text-fg-muted hover:bg-hover-bg rounded-xl"
                    >
                      <Icon name="microphone" className="w-4 h-4" />
                    </button>
                    <button
                      onClick={send}
                      disabled={loading || !input.trim()}
                      title="发送"
                      className="w-8 h-8 flex items-center justify-center bg-brand hover:bg-brand-hover disabled:bg-fg-faint text-brand-fg rounded-full"
                    >
                      <Icon name="arrow-up" className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
              <div className="border-t border-border-soft px-4 py-2 flex items-center gap-2 text-[11px]">
                <span className="relative group">
                  <button
                    onClick={() => {
                      setAgentMode((prev) => {
                        const next = !prev;
                        if (next) setRouteMode(false);
                        return next;
                      });
                    }}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded-xl ${
                      agentMode ? 'bg-brand-soft/60 text-brand' : 'bg-hover-bg text-fg-secondary hover:bg-active-bg'
                    }`}
                  >
                    <Icon name="cpu" className="w-3 h-3" />
                    <span>智能体{agentMode ? '·开' : ''}</span>
                  </button>
                  <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-56 px-2.5 py-1.5 rounded-lg bg-canvas text-fg border border-border-soft text-[11px] leading-snug whitespace-normal text-left opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-sm">
                    智能体模式：AI 可主动调用知识库工具（检索 / 读 / 写 / 诊断），自主完成多步任务，适合需要操作笔记的场景。
                  </span>
                </span>
                <span className="relative group">
                  <button
                    onClick={() => {
                      setRouteMode((prev) => {
                        const next = !prev;
                        if (next) setAgentMode(false);
                        return next;
                      });
                    }}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded-xl ${
                      routeMode ? 'bg-brand-soft/60 text-brand' : 'bg-hover-bg text-fg-secondary hover:bg-active-bg'
                    }`}
                  >
                    <Icon name="sparkles" className="w-3 h-3" />
                    <span>自动{routeMode ? '·开' : ''}</span>
                  </button>
                  <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-56 px-2.5 py-1.5 rounded-lg bg-canvas text-fg border border-border-soft text-[11px] leading-snug whitespace-normal text-left opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-sm">
                    自动路由：由模型根据问题，从已注册的技能（总结 / 检索 / 智能体等）中自动挑选最合适的一项，无需手动切换。
                  </span>
                </span>
                <div className="relative group">
                  <button className="flex items-center gap-1 px-2 py-0.5 rounded-xl bg-hover-bg text-fg-secondary hover:bg-active-bg">
                    <Icon name="folder" className="w-3 h-3" />
                    <span>{activeKb?.name || '未选择'}</span>
                    <Icon name="chevron-down" className="w-3 h-3" />
                  </button>
                  <div className="absolute left-0 bottom-full mb-1 bg-content border border-border-soft rounded-xl shadow-lg z-30 hidden group-hover:block min-w-[180px] overflow-hidden">
                    {kbs.map((kb) => (
                      <button
                        key={kb.id}
                        onClick={async () => {
                          await window.forge.kb.setActive(kb.id);
                          const active = await window.forge.kb.getActive();
                          if (active) setActiveKb(active);
                        }}
                        className={`block w-full text-left px-3 py-1.5 text-xs hover:bg-hover-bg ${
                          activeKb?.id === kb.id ? 'text-brand bg-brand-soft/40' : 'text-fg-secondary'
                        }`}
                      >
                        {kb.name}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={confirmingDeleteId !== null}
        title="删除该对话？"
        message="删除后将无法恢复，对话内的消息记录会一并清除。"
        confirmText="删除"
        cancelText="取消"
        danger
        onClose={() => setConfirmingDeleteId(null)}
        onConfirm={() => {
          if (confirmingDeleteId) deleteConversation(confirmingDeleteId);
          setConfirmingDeleteId(null);
        }}
      />
    </div>
  );
}
