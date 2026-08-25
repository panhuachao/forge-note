import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { useKBStore } from '../stores/kb-store';
import type { NoteContent, LinkInfo, DirSuggestion, CardDraft } from '@shared/types';
import { NoteOutline } from '../components/NoteOutline';
import { LinkPanel } from '../components/LinkPanel';
import { AISuggestionPanel } from '../components/AISuggestionPanel';
import { ForgeCardModal } from '../components/ForgeCardModal';
import { renderMarkdownPreview } from '../utils/markdown-preview';

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function NotePage() {
  const params = useParams();
  const nav = useNavigate();
  const notePath = params['*'] ? decodeURIComponent(params['*']) : '';
  const { activeKb, currentNote, setCurrentNote, markDirty, markClean, pushToast } = useKBStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [tab, setTab] = useState<'edit' | 'preview' | 'split'>('split');
  const [linkSuggestions, setLinkSuggestions] = useState<LinkInfo[]>([]);
  const [dirSuggestions, setDirSuggestions] = useState<DirSuggestion[]>([]);
  const [forgeDraft, setForgeDraft] = useState<CardDraft | null>(null);
  const [previewHtml, setPreviewHtml] = useState('');

  // 加载笔记
  useEffect(() => {
    if (!activeKb || !notePath) return;
    (async () => {
      try {
        const c = await window.forge.fs.readNote(activeKb.id, notePath);
        setCurrentNote({ content: c, dirty: false });
      } catch (e) {
        pushToast({ level: 'error', text: '打开笔记失败：' + String(e) });
      }
    })();
    return () => {
      setCurrentNote(null);
      setLinkSuggestions([]);
      setDirSuggestions([]);
    };
  }, [activeKb?.id, notePath]);

  // 初始化编辑器
  useEffect(() => {
    if (!containerRef.current || !currentNote) return;
    if (viewRef.current) {
      viewRef.current.destroy();
      viewRef.current = null;
    }
    const state = EditorState.create({
      doc: currentNote.content.content,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        markdown(),
        EditorView.lineWrapping,
        EditorView.updateListener.of((v) => {
          if (v.docChanged) {
            markDirty();
            if (saveTimer) clearTimeout(saveTimer);
            saveTimer = setTimeout(() => {
              if (activeKb && currentNote) {
                window.forge.fs.writeNote(activeKb.id, currentNote.content.path, v.state.doc.toString());
                markClean(v.state.doc.toString());
              }
            }, 500);
          }
        })
      ]
    });
    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentNote?.content.path]);

  // 预览渲染
  useEffect(() => {
    if (!currentNote) return;
    const html = renderMarkdownPreview(currentNote.content.content, activeKb?.id || '', notePath);
    setPreviewHtml(html);
  }, [currentNote?.content.content, activeKb?.id, notePath]);

  // 触发 AI 链接推荐
  const triggerLinkSuggest = useCallback(async () => {
    if (!activeKb || !currentNote) return;
    try {
      const r = await window.forge.ai.suggestLinks(activeKb.id, currentNote.content.path);
      setLinkSuggestions(r);
    } catch (e) {
      pushToast({ level: 'error', text: String(e) });
    }
  }, [activeKb, currentNote]);

  // 触发 AI 归纳推荐
  const triggerDirSuggest = useCallback(async () => {
    if (!activeKb || !currentNote) return;
    try {
      const r = await window.forge.ai.suggestDir(activeKb.id, currentNote.content.path);
      setDirSuggestions(r);
    } catch (e) {
      pushToast({ level: 'error', text: String(e) });
    }
  }, [activeKb, currentNote]);

  // 触发锻造
  const triggerForge = useCallback(async () => {
    if (!activeKb || !currentNote) return;
    try {
      const d = await window.forge.ai.forgeCard(activeKb.id, currentNote.content.path);
      setForgeDraft(d);
    } catch (e) {
      pushToast({ level: 'error', text: String(e) });
    }
  }, [activeKb, currentNote]);

  // 摘要
  const [summary, setSummary] = useState<string | null>(null);
  const triggerSummarize = useCallback(async () => {
    if (!activeKb || !currentNote) return;
    try {
      const r = await window.forge.ai.summarize(activeKb.id, currentNote.content.path);
      setSummary(r);
    } catch (e) {
      pushToast({ level: 'error', text: String(e) });
    }
  }, [activeKb, currentNote]);

  if (!notePath) {
    return (
      <div className="flex-1 flex items-center justify-center text-ink-400">
        请从左侧目录树选择一篇笔记
      </div>
    );
  }
  if (!currentNote) {
    return <div className="flex-1 flex items-center justify-center text-ink-400">加载中…</div>;
  }

  const fileName = notePath.split('/').pop()?.replace(/\.md$/i, '') || '';

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* 左侧：编辑器 + 预览 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 标题栏 */}
        <div className="h-10 flex items-center px-4 border-b border-ink-200 bg-white gap-2">
          <span className="text-sm text-ink-500">📄</span>
          <span className="text-sm font-medium truncate">{fileName}</span>
          <span className="text-xs text-ink-400 truncate">{notePath}</span>
          {currentNote.dirty && <span className="badge badge-brand ml-1">编辑中</span>}
          <div className="ml-auto flex items-center gap-1">
            <button onClick={triggerSummarize} className="icon-btn text-xs" title="AI 摘要">📝 摘要</button>
            <button onClick={triggerLinkSuggest} className="icon-btn text-xs" title="AI 链接推荐">🔗 链接</button>
            <button onClick={triggerDirSuggest} className="icon-btn text-xs" title="AI 归纳推荐">📂 归档</button>
            <button onClick={triggerForge} className="icon-btn text-xs" title="锻造知识卡片">⚒ 锻造</button>
            <div className="mx-1 w-px h-4 bg-ink-200" />
            <button onClick={() => setTab('edit')} className={`icon-btn text-xs ${tab === 'edit' ? 'text-brand-600' : ''}`}>编辑</button>
            <button onClick={() => setTab('split')} className={`icon-btn text-xs ${tab === 'split' ? 'text-brand-600' : ''}`}>分屏</button>
            <button onClick={() => setTab('preview')} className={`icon-btn text-xs ${tab === 'preview' ? 'text-brand-600' : ''}`}>预览</button>
          </div>
        </div>
        {/* 编辑/预览区 */}
        <div className="flex-1 flex overflow-hidden">
          {(tab === 'edit' || tab === 'split') && (
            <div ref={containerRef} className={`h-full overflow-auto bg-white ${tab === 'split' ? 'w-1/2 border-r border-ink-200' : 'w-full'}`} />
          )}
          {(tab === 'preview' || tab === 'split') && (
            <div
              className={`h-full overflow-auto bg-white p-6 ${tab === 'split' ? 'w-1/2' : 'w-full'}`}
            >
              <article
                className="markdown-preview max-w-3xl mx-auto"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            </div>
          )}
        </div>
      </div>

      {/* 右侧面板：大纲 + 链接 + AI 建议 */}
      <div className="w-72 border-l border-ink-200 bg-white overflow-y-auto">
        <NoteOutline content={currentNote.content.content} onJump={(line) => {
          const view = viewRef.current;
          if (view) {
            const pos = view.state.doc.line(Math.min(line, view.state.doc.lines)).from;
            view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'start' }) });
            view.focus();
          }
        }} />
        <LinkPanel
          kbId={activeKb!.id}
          notePath={notePath}
          inlinks={currentNote.content.inlinks}
          outlinks={currentNote.content.outlinks}
          broken={currentNote.content.brokenLinks}
          onOpen={(p) => nav(`/note/${encodeURIComponent(p)}`)}
        />
        {(linkSuggestions.length > 0 || dirSuggestions.length > 0 || summary) && (
          <AISuggestionPanel
            linkSuggestions={linkSuggestions}
            dirSuggestions={dirSuggestions}
            summary={summary}
            onApplyLinks={async (targets) => {
              await window.forge.ai.insertLinks(activeKb!.id, notePath, targets);
              const c = await window.forge.fs.readNote(activeKb!.id, notePath);
              setCurrentNote({ content: c, dirty: false });
              pushToast({ level: 'success', text: `已插入 ${targets.length} 条链接` });
              setLinkSuggestions([]);
            }}
            onApplyDir={async (dirPath) => {
              const newPath = await window.forge.fs.moveNote(activeKb!.id, notePath, dirPath);
              pushToast({ level: 'success', text: `已移动到 ${dirPath}` });
              nav(`/note/${encodeURIComponent(newPath)}`);
              setDirSuggestions([]);
            }}
            onCloseSummary={() => setSummary(null)}
          />
        )}
      </div>

      {forgeDraft && (
        <ForgeCardModal
          draft={forgeDraft}
          onClose={() => setForgeDraft(null)}
          onConfirm={async (target) => {
            // 写入新卡片
            const content = forgeCardToMarkdown(forgeDraft);
            const fileName = `${forgeDraft.title.replace(/[/\\:*?"<>|]/g, '-')}.md`;
            const newPath = await window.forge.fs.createNote(activeKb!.id, target, { name: fileName, useTemplate: false });
            await window.forge.fs.writeNote(activeKb!.id, newPath.path, content);
            // 在原笔记追加引用
            const orig = await window.forge.fs.readNote(activeKb!.id, notePath);
            const updated = orig.content + `\n\n> 已加工：[[${forgeDraft.title}]]\n`;
            await window.forge.fs.writeNote(activeKb!.id, notePath, updated);
            pushToast({ level: 'success', text: `已锻造并移入 ${target}` });
            setForgeDraft(null);
            nav(`/note/${encodeURIComponent(newPath.path)}`);
          }}
        />
      )}
    </div>
  );
}

function forgeCardToMarkdown(d: CardDraft): string {
  return `# ${d.title}

> 状态：${d.status}
> 来源：${d.source}
> 创建日期：${d.createdAt}

## 核心观点
${d.coreIdea}

## 详细内容
${d.details}

## 可行动项
${d.actionable.map((a) => `- [ ] ${a}`).join('\n')}

## 验证标准
${d.verification}

## 相关链接
${d.relatedLinks.map((l) => `- [[${l}]]`).join('\n')}

## 流转建议
AI 建议移入：${d.suggestedTarget.dirName}
理由：${d.suggestedTarget.reason}
`;
}
