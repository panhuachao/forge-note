import { useEffect, useState } from 'react';
import { useKBStore } from '../stores/kb-store';
import { useLayoutStore } from '../stores/layout-store';
import { Icon } from './Icon';
import type { TemplateMeta } from '@shared/types';

/**
 * 首次启动配置指引向导
 * 第 1 步：选择知识库目录路径（弹出系统目录选择框）
 * 第 2 步：可选 - 是否应用内嵌知识库目录模板（PARA+）
 */
export function SetupWizard({ onDone }: { onDone: () => void }) {
  const { setKBs, setActiveKb, setTree, setApplied, pushToast } = useKBStore();
  const { setMainView } = useLayoutStore();

  const [step, setStep] = useState<'dir' | 'template' | 'done'>('dir');
  const [selectedDir, setSelectedDir] = useState('');
  const [kbId, setKbId] = useState('');
  const [templates, setTemplates] = useState<TemplateMeta[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 加载内嵌模板列表供第 2 步展示
  useEffect(() => {
    (async () => {
      try {
        const list = await window.forge.template.list();
        setTemplates(list);
        // 仅有一个内嵌模板时默认选中
        if (list.length === 1) setSelectedTemplate(list[0].templateId);
      } catch {
        setTemplates([]);
      }
    })();
  }, []);

  async function pickDirectory() {
    setBusy(true);
    try {
      const kb = await window.forge.kb.add();
      if (!kb) return; // 用户取消
      setSelectedDir(kb.rootPath);
      setKbId(kb.id);
      setStep('template');
    } catch (e) {
      pushToast({ level: 'error', text: '选择目录失败：' + String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function finish(pickTemplate: boolean) {
    if (!kbId) return;
    setBusy(true);
    try {
      // 写入 KB 列表与激活状态
      setKBs(await window.forge.kb.list());
      const active = await window.forge.kb.getActive();
      if (active) {
        setActiveKb(active);
        const tree = await window.forge.fs.listTree(active.id);
        setTree(tree);
      }

      // 可选：应用内嵌模板（传入全部目录 id，确保完整复制目录结构）
      if (pickTemplate && selectedTemplate) {
        const tmpl = templates.find((t) => t.templateId === selectedTemplate);
        const selections = tmpl ? tmpl.dirs.map((d) => d.id) : [];
        const applied = await window.forge.template.apply(kbId, selectedTemplate, selections);
        setApplied(applied);
        // 应用模板后刷新树
        if (active) setTree(await window.forge.fs.listTree(active.id));
      }

      setStep('done');
      setMainView('home');
      // 短暂展示完成态后通知外层关闭向导
      setTimeout(() => onDone(), 600);
    } catch (e) {
      pushToast({ level: 'error', text: '初始化失败：' + String(e) });
    } finally {
      setBusy(false);
    }
  }

  const tpl = templates[0];

  return (
    <div className="fixed inset-0 bg-canvas flex items-center justify-center z-50">
      {/* 顶部窗口控制条占位，避免与 macOS 红黄绿按钮重叠 */}
      <div className="absolute top-0 left-0 right-0 h-10" />

      <div className="w-full max-w-xl bg-content rounded-xl shadow-2xl border border-border-soft overflow-hidden">
        {/* 品牌头部 */}
        <div className="flex items-center gap-3 px-6 pt-6">
          <div className="w-10 h-10 rounded-xl bg-brand-soft flex items-center justify-center">
            <Icon name="sparkles" className="w-5 h-5 text-brand" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-fg leading-tight">欢迎使用锦囊笔记</h1>
            <p className="text-xs text-fg-muted">几步即可创建属于你的本地知识库</p>
          </div>
        </div>

        {/* 步骤指示 */}
        <div className="flex items-center gap-2 px-6 pt-5 text-xs text-fg-faint">
          <span className={`flex items-center gap-1 ${step !== 'done' ? 'text-brand' : 'text-fg-muted'}`}>
            <span className={`w-5 h-5 rounded-full flex items-center justify-center ${step !== 'done' ? 'bg-brand text-brand-fg' : 'bg-active-bg'}`}>1</span>
            选择目录
          </span>
          <span className="flex-1 h-px bg-border-soft" />
          <span className={`flex items-center gap-1 ${step === 'template' || step === 'done' ? 'text-brand' : 'text-fg-muted'}`}>
            <span className={`w-5 h-5 rounded-full flex items-center justify-center ${step === 'template' || step === 'done' ? 'bg-brand text-brand-fg' : 'bg-active-bg'}`}>2</span>
            目录模板
          </span>
        </div>

        {/* 第 1 步：选择知识库目录 */}
        {step === 'dir' && (
          <div className="px-6 py-7">
            <h2 className="text-xl font-semibold text-fg mb-2">创建你的知识库</h2>
            <p className="text-sm text-fg-secondary mb-6">
              选择一个本地文件夹作为知识库根目录。所有笔记将以 Markdown 文件形式存放在这里，完全由你本地掌控。
            </p>

            <div className="rounded-xl border border-border-soft bg-hover-bg/40 p-4 mb-6">
              <div className="flex items-center gap-2 text-fg-secondary text-sm mb-1">
                <Icon name="folder-open" className="w-4 h-4" />
                <span>知识库根目录</span>
              </div>
              <p className="text-xs text-fg-faint break-all">
                {selectedDir || '尚未选择 - 点击下方按钮在系统中选择或新建文件夹'}
              </p>
            </div>

            <div className="flex justify-end">
              <button onClick={pickDirectory} disabled={busy} className="btn btn-primary">
                {busy ? '打开中…' : '选择文件夹'}
              </button>
            </div>
          </div>
        )}

        {/* 第 2 步：可选内嵌模板 */}
        {step === 'template' && (
          <div className="px-6 py-7">
            <h2 className="text-xl font-semibold text-fg mb-2">是否应用内嵌目录模板？</h2>
            <p className="text-sm text-fg-secondary mb-4">
              模板会在你的知识库里创建一套预设目录结构（如灵感库、项目库等），帮助你更快上手。这是可选步骤，后续也能随时在模板页应用。
            </p>

            {tpl ? (
              <button
                onClick={() => setSelectedTemplate(selectedTemplate === tpl.templateId ? null : tpl.templateId)}
                className={`w-full text-left rounded-xl border p-4 mb-5 transition-colors ${
                  selectedTemplate === tpl.templateId
                    ? 'border-brand bg-active-bg'
                    : 'border-border-soft hover:bg-hover-bg/60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon name="folder-tree" className="w-5 h-5 text-brand" />
                    <span className="font-medium text-fg">{tpl.name}</span>
                  </div>
                  <span
                    className={`w-5 h-5 rounded-full border flex items-center justify-center ${
                      selectedTemplate === tpl.templateId ? 'bg-brand border-brand text-brand-fg' : 'border-border-soft'
                    }`}
                  >
                    {selectedTemplate === tpl.templateId && <Icon name="check-circle" className="w-4 h-4" />}
                  </span>
                </div>
                <p className="text-xs text-fg-secondary mt-1">{tpl.description}</p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {tpl.dirs.map((d) => (
                    <span key={d.id} className="text-[11px] px-2 py-0.5 rounded-full bg-hover-bg text-fg-muted">
                      {d.id} {d.name}
                    </span>
                  ))}
                </div>
              </button>
            ) : (
              <p className="text-sm text-fg-muted mb-5">未发现内嵌模板，可跳过此步。</p>
            )}

            <div className="flex items-center justify-between">
              <button onClick={() => setStep('dir')} disabled={busy} className="btn btn-ghost">
                上一步
              </button>
              <div className="flex gap-2">
                <button onClick={() => finish(false)} disabled={busy} className="btn btn-secondary">
                  跳过，直接完成
                </button>
                <button onClick={() => finish(true)} disabled={busy} className="btn btn-primary">
                  {busy ? '应用模板中…' : selectedTemplate ? '应用并进入' : '完成'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 完成态 */}
        {step === 'done' && (
          <div className="px-6 py-12 flex flex-col items-center">
            <div className="w-14 h-14 rounded-2xl bg-brand-soft flex items-center justify-center mb-4">
              <Icon name="check-circle" className="w-8 h-8 text-brand" />
            </div>
            <h2 className="text-lg font-semibold text-fg mb-1">知识库已就绪</h2>
            <p className="text-sm text-fg-secondary">正在进入锦囊笔记…</p>
          </div>
        )}
      </div>
    </div>
  );
}
