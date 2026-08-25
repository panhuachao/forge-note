import { useState, useEffect, useRef } from 'react';
import { useKBStore } from '../stores/kb-store';
import { useLayoutStore } from '../stores/layout-store';
import { useChatStore } from '../stores/chat-store';
import { Icon, IconName } from '../components/Icon';
import { AI_MODELS, ModelOption, AIModelConfig } from '@shared/types/ai';
import {
  handleTitleBarDoubleClick,
  TITLEBAR_DRAG_STYLE
} from '../lib/window-control';

type ChatMode = 'ask' | 'search';

interface ModeItem {
  id: ChatMode;
  icon: IconName;
  label: string;
  desc: string;
}

const modes: ModeItem[] = [
  { id: 'ask', icon: 'chat-bubble', label: '问答模式', desc: 'AI 检索知识库后回答' },
  { id: 'search', icon: 'magnifying-glass', label: '检索模式', desc: '通过笔记搜索跳转结果' }
];

export function HomePage() {
  const { activeKb, kbs, setActiveKb, setTree, setApplied, setKBs, pushToast, aiConfig, setAIConfig } = useKBStore();
  const { setMainView } = useLayoutStore();
  const [mode, setMode] = useState<ChatMode>('ask');
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // 自动撑高 textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 240) + 'px';
  }, [input]);

  // 占位提示（多行输入上方）
  const placeholder =
    mode === 'ask'
      ? '今天帮你做些什么？\n@引用对话文件 · /调用技能与指令'
      : '在所有笔记中检索关键词…\nEnter 跳转搜索结果';

  // 初始化：有 KB 但无 active 时自动激活第一个
  useEffect(() => {
    if (!activeKb && kbs.length > 0) {
      const first = kbs[0];
      (async () => {
        await window.forge.kb.setActive(first.id);
        setActiveKb({
          id: first.id,
          name: first.name,
          rootPath: first.rootPath,
          createdAt: 0,
          templateId: first.templateId
        });
        const t = await window.forge.fs.listTree(first.id);
        setTree(t);
        const a = await window.forge.template.applied(first.id);
        setApplied(a);
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleAddKb() {
    const kb = await window.forge.kb.add();
    if (kb) {
      setKBs(await window.forge.kb.list());
      setActiveKb(kb);
      const t = await window.forge.fs.listTree(kb.id);
      setTree(t);
      const applied = await window.forge.template.applied(kb.id);
      setApplied(applied);
      pushToast({ level: 'success', text: `已添加知识库：${kb.name}` });
    }
  }

  async function switchKb(kbId: string) {
    if (!kbId || kbId === activeKb?.id) return;
    await window.forge.kb.setActive(kbId);
    const active = await window.forge.kb.getActive();
    if (active) {
      setActiveKb(active);
      const t = await window.forge.fs.listTree(active.id);
      setTree(t);
      const a = await window.forge.template.applied(active.id);
      setApplied(a);
    }
  }

  async function switchModel(modelId: string) {
    // 根据选中的模型 id 推断其所属 provider（DeepSeek 等走 openai 兼容）
    const providerForModel =
      (Object.keys(AI_MODELS) as Array<keyof typeof AI_MODELS>).find((p) =>
        AI_MODELS[p].some((m) => m.id === modelId)
      ) || aiConfig.provider;
    const next: AIModelConfig = {
      ...aiConfig,
      provider: providerForModel,
      model: modelId
    } as AIModelConfig;
    setAIConfig(next);
    try {
      await window.forge.ai.setConfig(next);
    } catch (e) {
      console.error(e);
    }
  }

  async function send() {
    if (!activeKb || !input.trim()) return;
    const q = input.trim();
    setInput('');

    if (mode === 'search') {
      // 检索模式：跳转到独立检索结果页，并传入 query
      window.dispatchEvent(new CustomEvent('forge:search-init', { detail: { q } }));
      setMainView('search-results');
      return;
    }

    // 问答模式：创建一个新的 AI 对话，跳转到 chat 页
    const { createConversation } = useChatStore.getState();
    createConversation({ firstUserText: q, kbId: activeKb.id });
    setMainView('chat');
  }

  // 当前 provider 可选模型
  const currentModels: ModelOption[] =
    aiConfig.provider === 'ollama' || aiConfig.provider === 'openai'
      ? AI_MODELS[aiConfig.provider]
      : [];

  // 无知识库：空状态
  if (kbs.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-canvas px-6">
        <div className="w-full max-w-md flex flex-col items-center text-center">
          <div className="w-16 h-16 rounded-2xl bg-brand-soft flex items-center justify-center mb-6 shadow-sm">
            <Icon name="sparkles" className="w-8 h-8 text-brand" />
          </div>
          <h1 className="text-3xl font-bold text-fg mb-3">锦囊笔记</h1>
          <p className="text-fg-muted mb-8 leading-relaxed">
            一款文件优先、本地主权、开源免费的个人知识管理工具。
            <br />
            选择本地文件夹，即可开启你的知识库。
          </p>
          <button onClick={handleAddKb} className="btn btn-primary px-5 py-2.5 text-sm mb-4">
            选择文件夹，开启我的知识库
          </button>
          <p className="text-xs text-fg-faint">数据完全保存在你本地，可随时导出与迁移</p>
        </div>
      </div>
    );
  }

  if (!activeKb) {
    return <div className="flex-1 flex items-center justify-center text-fg-muted">加载中…</div>;
  }

  return (
    <div className="flex-1 flex flex-col bg-canvas overflow-hidden">
      {/* 顶部统一标题栏条带（不显示图标和标题，仅作为标题栏带，与其他页面一致）
          支持双击放大/还原、按住拖动 */}
      <div
        className="fixed top-0 left-0 right-0 z-20 h-14 border-b border-border bg-toolbar"
        style={TITLEBAR_DRAG_STYLE}
        onDoubleClick={handleTitleBarDoubleClick}
      />
      <div className="flex-1 flex flex-col items-center px-8 py-6 pt-20 overflow-y-auto">
        {/* 标题 */}
        <h1 className="text-2xl font-bold text-fg mt-6 mb-6 text-center">
          锦囊笔记，<span className="text-brand">我帮你</span>
        </h1>

        {/* 模式切换按钮组（胶囊型） */}
        <div className="flex items-center gap-2 mb-6">
          {modes.map((m) => {
            const active = mode === m.id;
            return (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`flex items-center gap-2 px-5 py-2 rounded-full text-sm transition-all ${
                  active
                    ? 'bg-brand-soft text-brand border border-brand/20 shadow-sm'
                    : 'bg-content text-fg-secondary hover:bg-hover-bg border border-border-soft'
                }`}
                title={m.desc}
              >
                <Icon name={m.icon} className="w-4 h-4" />
                <span>{m.label}</span>
              </button>
            );
          })}
        </div>

        {/* 主输入卡片：大圆角，柔和边框（参考图片） */}
        <div className="w-full max-w-2xl">
          <div className="rounded-2xl bg-content border border-border-soft shadow-sm overflow-hidden">
            {/* 多行输入区（核心强调）：占位提示在上 + textarea 居中 */}
            <div className="px-5 pt-4 pb-2">
              {/* 占位提示（灰底胶囊样式，参考图片） */}
              {!input && (
                <div className="inline-flex items-center gap-1.5 px-3 py-1 mb-2 rounded-full bg-hover-bg text-xs text-fg-muted">
                  <span className="whitespace-pre-wrap leading-relaxed">
                    {placeholder.split('\n')[0]}
                  </span>
                </div>
              )}

              {/* textarea（自动撑高，min-h 80px） */}
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
                placeholder={input ? '' : placeholder}
                className="w-full bg-transparent outline-none text-base text-fg placeholder:text-fg-faint resize-none min-h-[80px] max-h-[240px] leading-6"
              />

              {/* 操作行：左下 + / 右下 模型徽章 + 语音 + 发送 */}
              <div className="flex items-center justify-between pt-2">
                <button
                  title="附件（暂未开放）"
                  className="w-8 h-8 flex items-center justify-center text-fg-muted hover:bg-hover-bg rounded-xl flex-shrink-0"
                >
                  <Icon name="plus" className="w-5 h-5" />
                </button>

                <div className="flex items-center gap-2">
                  {/* 模型徽章（按图片右下角"Hy3 ▼"） */}
                  {aiConfig.provider !== 'none' && currentModels.length > 0 ? (
                    <div className="relative group">
                      <button className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs text-fg-secondary hover:bg-hover-bg">
                        <Icon name="bolt" className="w-3.5 h-3.5" />
                        <span>{aiConfig.model || currentModels[0].label}</span>
                        <Icon name="chevron-down" className="w-3 h-3" />
                      </button>
                      <div className="absolute right-0 bottom-full mb-1 bg-content border border-border-soft rounded-xl shadow-lg z-30 hidden group-hover:block min-w-[240px] overflow-hidden">
                        {currentModels.map((m) => {
                          const active = (aiConfig.model || currentModels[0].id) === m.id;
                          return (
                            <button
                              key={m.id}
                              onClick={() => switchModel(m.id)}
                              className={`flex flex-col items-start w-full text-left px-3 py-2 text-xs hover:bg-hover-bg ${
                                active ? 'text-fg bg-active-bg' : 'text-fg-secondary'
                              }`}
                            >
                              <span className="font-medium">{m.label}</span>
                              {m.desc && <span className="text-fg-faint text-[10px]">{m.desc}</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setMainView('settings')}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs text-fg-muted hover:bg-hover-bg"
                    >
                      <Icon name="bolt" className="w-3.5 h-3.5" />
                      <span>未配置</span>
                    </button>
                  )}

                  <button
                    title="语音（暂未开放）"
                    className="w-8 h-8 flex items-center justify-center text-fg-muted hover:bg-hover-bg rounded-xl flex-shrink-0"
                  >
                    <Icon name="microphone" className="w-4 h-4" />
                  </button>
                  <button
                    onClick={send}
                    disabled={!input.trim()}
                    title={mode === 'ask' ? '发送' : '检索'}
                    className="w-9 h-9 flex items-center justify-center bg-brand hover:bg-brand-hover disabled:bg-fg-faint text-brand-fg rounded-full flex-shrink-0 shadow-sm transition-colors"
                  >
                    <Icon name="arrow-up" className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* 底部：选择知识库（淡灰色背景胶囊行） */}
            <div className="border-t border-border-soft px-5 py-3 flex items-center gap-2 text-xs">
              <div className="relative group">
                <button className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-hover-bg text-fg-secondary hover:bg-active-bg">
                  <Icon name="folder" className="w-3.5 h-3.5" />
                  <span>{activeKb.name}</span>
                  <Icon name="chevron-down" className="w-3 h-3" />
                </button>
                <div className="absolute left-0 bottom-full mb-1 bg-content border border-border-soft rounded-xl shadow-lg z-30 hidden group-hover:block min-w-[200px] overflow-hidden">
                  {kbs.map((kb) => (
                    <button
                      key={kb.id}
                      onClick={async () => {
                        await switchKb(kb.id);
                      }}
                      className={`block w-full text-left px-3 py-1.5 text-xs hover:bg-hover-bg ${
                        activeKb.id === kb.id ? 'text-fg bg-active-bg' : 'text-fg-secondary'
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
  );
}