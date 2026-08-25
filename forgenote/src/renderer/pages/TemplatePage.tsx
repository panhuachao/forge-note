import { useEffect, useState } from 'react';
import type { TemplateMeta, AppliedTemplate } from '@shared/types';
import { useKBStore } from '../stores/kb-store';
import { useNavigate } from 'react-router-dom';

export function TemplatePage() {
  const { activeKb, applied, setApplied, pushToast } = useKBStore();
  const [templates, setTemplates] = useState<TemplateMeta[]>([]);
  const [applying, setApplying] = useState<TemplateMeta | null>(null);
  const [selections, setSelections] = useState<string[]>([]);
  const [aiConfigContent, setAiConfigContent] = useState('');
  const [dirReadmeEdit, setDirReadmeEdit] = useState<{ dirId: string; content: string } | null>(null);
  const nav = useNavigate();

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
    return <div className="flex-1 flex items-center justify-center text-ink-400">请先选择知识库</div>;
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
    <div className="flex-1 flex flex-col overflow-hidden bg-ink-50">
      <div className="h-10 flex items-center px-4 border-b border-ink-200 bg-white text-sm">
        <span className="font-medium">📋 知识库模板</span>
      </div>
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {applied ? (
          <section className="bg-white rounded border border-ink-200 p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">{applied.meta.name}</h2>
                <p className="text-xs text-ink-500 mt-1">
                  版本 {applied.meta.version} · {applied.meta.author}
                </p>
                <p className="text-sm text-ink-600 mt-2">{applied.meta.description}</p>
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
          <section className="bg-white rounded border border-ink-200 p-5">
            <h2 className="text-lg font-semibold mb-2">尚未应用模板</h2>
            <p className="text-sm text-ink-500 mb-4">选择下方模板一键搭建你的知识库体系：</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {templates.map((t) => (
                <div key={t.templateId} className="p-4 rounded border border-ink-200 hover:border-brand-600 cursor-pointer"
                  onClick={() => {
                    setApplying(t);
                    setSelections(t.dirs.map((d) => d.id));
                  }}>
                  <h3 className="font-medium">{t.name}</h3>
                  <p className="text-xs text-ink-500 mt-1">版本 {t.version} · {t.dirs.length} 个目录</p>
                  <p className="text-sm text-ink-600 mt-2">{t.description}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {applied && (
          <>
            <section className="bg-white rounded border border-ink-200 p-5">
              <h2 className="font-semibold mb-3">目录（{applied.meta.dirs.length}）</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {applied.meta.dirs.map((d) => (
                  <div key={d.id} className="p-3 rounded border border-ink-200 flex items-center gap-2">
                    <span style={{ color: d.color }} className="text-lg">{d.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{d.id} {d.name}</div>
                      <div className="text-xs text-ink-500">
                        流向：{d.flow.length ? d.flow.join(' / ') : '终点'}
                        {d.sink ? ' · 终态' : ''}
                      </div>
                    </div>
                    <button
                      className="btn btn-ghost text-xs"
                      onClick={async () => {
                        const c = await window.forge.template.getDirReadme(activeKb.id, `${d.id} ${d.name}`);
                        setDirReadmeEdit({ dirId: d.id, content: c });
                      }}
                    >
                      编辑说明
                    </button>
                  </div>
                ))}
              </div>
            </section>

            <section className="bg-white rounded border border-ink-200 p-5">
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
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-5">
            <h2 className="font-semibold mb-3">应用模板：{applying.name}</h2>
            <p className="text-sm text-ink-500 mb-3">勾选需要创建的目录（已存在的同名目录会被跳过）：</p>
            <div className="space-y-1 max-h-80 overflow-y-auto">
              {applying.dirs.map((d) => (
                <label key={d.id} className="flex items-center gap-2 p-2 hover:bg-ink-50 rounded cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selections.includes(d.id)}
                    onChange={(e) => {
                      if (e.target.checked) setSelections([...selections, d.id]);
                      else setSelections(selections.filter((x) => x !== d.id));
                    }}
                  />
                  <span style={{ color: d.color }}>{d.icon}</span>
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
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl flex flex-col">
            <div className="px-5 py-3 border-b border-ink-200 flex items-center justify-between">
              <h2 className="font-semibold">编辑目录说明</h2>
              <button onClick={() => setDirReadmeEdit(null)} className="text-ink-400 hover:text-ink-800">×</button>
            </div>
            <textarea
              value={dirReadmeEdit.content}
              onChange={(e) => setDirReadmeEdit({ ...dirReadmeEdit, content: e.target.value })}
              className="flex-1 p-5 font-mono text-xs outline-none resize-none"
              rows={20}
            />
            <div className="px-5 py-3 border-t border-ink-200 flex justify-end gap-2">
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
    </div>
  );
}
