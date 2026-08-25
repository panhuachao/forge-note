import { useEffect, useState } from 'react';
import type { TemplateMeta, AppliedTemplate, NoteTemplateInfo } from '@shared/types';
import { useKBStore } from '../stores/kb-store';
import { Icon } from '../components/Icon';

export function TemplatePage() {
  const { activeKb, applied, setApplied, pushToast } = useKBStore();
  const [templates, setTemplates] = useState<TemplateMeta[]>([]);
  const [applying, setApplying] = useState<TemplateMeta | null>(null);
  const [selections, setSelections] = useState<string[]>([]);
  const [aiConfigContent, setAiConfigContent] = useState('');
  const [dirReadmeEdit, setDirReadmeEdit] = useState<{ dirId: string; content: string } | null>(null);
  // 笔记模板编辑
  const [noteTemplateEdit, setNoteTemplateEdit] = useState<NoteTemplateInfo | null>(null);
  const [noteTemplateDraft, setNoteTemplateDraft] = useState('');

  useEffect(() => {
    if (!activeKb) return;
    window.forge.template.list().then(setTemplates);
    window.forge.template.applied(activeKb.id).then((t) => {
      setApplied(t);
      if (t) {
        setAiConfigContent(t.aiConfigContent);
      }
    });
  }, [activeKb?.id]);

  if (!activeKb) {
    return <div className="flex-1 flex items-center justify-center text-fg-faint">请先选择知识库</div>;
  }

  async function apply() {
    if (!applying || !activeKb) return;
    try {
      const t = await window.forge.template.apply(activeKb.id, applying.templateId, selections);
      setApplied(t);
      setApplying(null);
      pushToast({ level: 'success', text: '模板已应用' });
    } catch (e) {
      pushToast({ level: 'error', text: String(e) });
    }
  }

  async function exportTemplate() {
    if (!activeKb) return;
    try {
      const data = await window.forge.template.export(activeKb.id);
      const blob = new Blob([data as BlobPart], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${activeKb.name}.kbtemplate`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      pushToast({ level: 'error', text: String(e) });
    }
  }

  async function importTemplate(file: File) {
    if (!activeKb) return;
    const buf = new Uint8Array(await file.arrayBuffer());
    try {
      const t = await window.forge.template.importTo(activeKb.id, buf);
      setApplied(t);
      pushToast({ level: 'success', text: '模板已导入' });
    } catch (e) {
      pushToast({ level: 'error', text: String(e) });
    }
  }

  async function removeTemplate() {
    if (!activeKb) return;
    if (!confirm('确定移除模板标识？目录文件不会被删除。')) return;
    await window.forge.template.remove(activeKb.id);
    setApplied(null);
    pushToast({ level: 'success', text: '已移除模板标识' });
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-canvas">
      <div className="h-10 flex items-center px-4 border-b border-border bg-content text-sm">
        <span className="font-medium flex items-center gap-1.5"><Icon name="clipboard" className="w-4 h-4 text-brand" /> 知识库模板</span>
      </div>
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {applied ? (
          <section className="bg-content rounded border border-border p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">{applied.meta.name}</h2>
                <p className="text-xs text-fg-muted mt-1">
                  版本 {applied.meta.version} · {applied.meta.author}
                </p>
                <p className="text-sm text-fg-secondary mt-2">{applied.meta.description}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={exportTemplate} className="btn btn-secondary">导出</button>
                <label className="btn btn-secondary cursor-pointer">
                  导入
                  <input
                    type="file"
                    accept=".kbtemplate,.zip"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) importTemplate(f);
                    }}
                  />
                </label>
                <button onClick={removeTemplate} className="btn btn-secondary text-red-600">移除模板</button>
              </div>
            </div>
          </section>
        ) : (
          <section className="bg-content rounded border border-border p-5">
            <h2 className="text-lg font-semibold mb-2">尚未应用模板</h2>
            <p className="text-sm text-fg-muted mb-4">选择下方模板一键搭建你的知识库体系：</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {templates.map((t) => (
                <div key={t.templateId} className="p-4 rounded border border-border hover:border-brand cursor-pointer"
                  onClick={() => {
                    setApplying(t);
                    setSelections(t.dirs.map((d) => d.id));
                  }}>
                  <h3 className="font-medium">{t.name}</h3>
                  <p className="text-xs text-fg-muted mt-1">版本 {t.version} · {t.dirs.length} 个目录</p>
                  <p className="text-sm text-fg-secondary mt-2">{t.description}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {applied && (
          <>
            <section className="bg-content rounded border border-border p-5">
              <h2 className="font-semibold mb-3">目录（{applied.meta.dirs.length}）</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {applied.meta.dirs.map((d) => (
                  <div key={d.id} className="p-3 rounded border border-border flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{d.id} {d.name}</div>
                      <div className="text-xs text-fg-muted">
                        流向：{d.flow.length ? d.flow.join(' / ') : '终点'}
                        {d.sink ? ' · 终态' : ''}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <button
                        className="btn btn-ghost text-xs"
                        onClick={async () => {
                          const c = await window.forge.template.getDirReadme(activeKb.id, `${d.id} ${d.name}`);
                          setDirReadmeEdit({ dirId: d.id, content: c });
                        }}
                      >
                        说明
                      </button>
                      <button
                        className="btn btn-ghost text-xs"
                        onClick={async () => {
                          const info = await window.forge.template.getNoteTemplate(activeKb.id, `${d.id} ${d.name}`);
                          if (info) {
                            setNoteTemplateDraft(info.content);
                            setNoteTemplateEdit(info);
                          }
                        }}
                      >
                        笔记模板
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="bg-content rounded border border-border p-5">
              <h2 className="font-semibold mb-3">AI_CONFIG.md（AI 操作说明书）</h2>
              <textarea
                value={aiConfigContent}
                onChange={(e) => setAiConfigContent(e.target.value)}
                className="input font-mono text-xs h-80"
              />
              <div className="mt-2 flex justify-end">
                <button
                  className="btn btn-primary"
                  onClick={async () => {
                    await window.forge.template.saveAIConfig(activeKb.id, aiConfigContent);
                    pushToast({ level: 'success', text: 'AI_CONFIG.md 已保存' });
                  }}
                >
                  保存
                </button>
              </div>
            </section>
          </>
        )}
      </div>

      {/* 应用模板向导 */}
      {applying && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-content rounded-lg shadow-xl w-full max-w-md p-5">
            <h2 className="font-semibold mb-3">应用模板：{applying.name}</h2>
            <p className="text-sm text-fg-muted mb-3">勾选需要创建的目录（已存在的同名目录会被跳过）：</p>
            <div className="space-y-1 max-h-80 overflow-y-auto">
              {applying.dirs.map((d) => (
                <label key={d.id} className="flex items-center gap-2 p-2 hover:bg-canvas rounded cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selections.includes(d.id)}
                    onChange={(e) => {
                      if (e.target.checked) setSelections([...selections, d.id]);
                      else setSelections(selections.filter((x) => x !== d.id));
                    }}
                  />
                  <span className="text-sm">{d.id} {d.name}</span>
                </label>
              ))}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setApplying(null)} className="btn btn-secondary">取消</button>
              <button onClick={apply} className="btn btn-primary">应用</button>
            </div>
          </div>
        </div>
      )}

      {/* 目录说明编辑 */}
      {dirReadmeEdit && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-8">
          <div className="bg-content rounded-lg shadow-xl w-full max-w-2xl flex flex-col">
            <div className="px-5 py-3 border-b border-border flex items-center justify-between">
              <h2 className="font-semibold">编辑目录说明</h2>
              <button onClick={() => setDirReadmeEdit(null)} className="text-fg-faint hover:text-fg">×</button>
            </div>
            <textarea
              value={dirReadmeEdit.content}
              onChange={(e) => setDirReadmeEdit({ ...dirReadmeEdit, content: e.target.value })}
              className="flex-1 p-5 font-mono text-xs outline-none resize-none"
              rows={20}
            />
            <div className="px-5 py-3 border-t border-border flex justify-end gap-2">
              <button onClick={() => setDirReadmeEdit(null)} className="btn btn-secondary">取消</button>
              <button
                onClick={async () => {
                  const d = applied!.meta.dirs.find((x) => x.id === dirReadmeEdit.dirId);
                  if (!d) return;
                  await window.forge.template.saveDirReadme(activeKb.id, `${d.id} ${d.name}`, dirReadmeEdit.content);
                  pushToast({ level: 'success', text: '目录说明已保存' });
                  setDirReadmeEdit(null);
                }}
                className="btn btn-primary"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 笔记模板编辑 */}
      {noteTemplateEdit && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-8">
          <div className="bg-content rounded-lg shadow-xl w-full max-w-2xl flex flex-col max-h-[85vh]">
            <div className="px-5 py-3 border-b border-border flex items-center justify-between">
              <h2 className="font-semibold">
                编辑笔记模板 · {noteTemplateEdit.dirId} {noteTemplateEdit.dirName}
              </h2>
              <button onClick={() => setNoteTemplateEdit(null)} className="text-fg-faint hover:text-fg">×</button>
            </div>
            <div className="px-5 py-2 text-xs text-fg-faint flex items-center justify-between">
              <span>可用变量：{noteTemplateEdit.variables.join(' ')}</span>
              {noteTemplateEdit.hasCustom && (
                <button
                  className="text-brand hover:underline"
                  onClick={async () => {
                    const info = await window.forge.template.resetNoteTemplate(
                      activeKb.id,
                      noteTemplateEdit.dirPath
                    );
                    if (info) {
                      setNoteTemplateEdit(info);
                      setNoteTemplateDraft(info.content);
                      pushToast({ level: 'success', text: '已重置为默认模板' });
                    }
                  }}
                >
                  重置为默认
                </button>
              )}
            </div>
            <textarea
              value={noteTemplateDraft}
              onChange={(e) => setNoteTemplateDraft(e.target.value)}
              className="flex-1 m-5 mt-1 p-4 font-mono text-xs outline-none resize-none border border-border rounded"
              rows={16}
              placeholder="# {{name}}

## 内容

（在此输入该目录下新建笔记的默认内容，支持 {{name}} {{kbName}} {{date}} {{time}} {{timestamp}} 变量）"
            />
            <div className="px-5 py-3 border-t border-border flex justify-end gap-2">
              <button onClick={() => setNoteTemplateEdit(null)} className="btn btn-secondary">取消</button>
              <button
                className="btn btn-primary"
                onClick={async () => {
                  await window.forge.template.saveNoteTemplate(activeKb.id, noteTemplateEdit.dirPath, noteTemplateDraft);
                  pushToast({ level: 'success', text: '笔记模板已保存' });
                  setNoteTemplateEdit(null);
                }}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
