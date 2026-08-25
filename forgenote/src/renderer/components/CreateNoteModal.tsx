import { useEffect, useState } from 'react';
import { useKBStore } from '../stores/kb-store';
import { useLayoutStore } from '../stores/layout-store';
import type { NoteTemplateInfo, TreeNode } from '@shared/types';

interface Props {
  open: boolean;
  initialDirPath?: string;
  onClose: () => void;
}

// 扁平化目录，用于选择新建位置
function flattenDirs(node: TreeNode, depth = 0): { path: string; label: string }[] {
  const out: { path: string; label: string }[] = [];
  if (node.kind === 'dir' && node.path) {
    out.push({ path: node.path, label: node.name });
  }
  if (node.children) {
    for (const c of node.children) out.push(...flattenDirs(c, depth + 1));
  }
  return out;
}

export function CreateNoteModal({ open, initialDirPath, onClose }: Props) {
  const { activeKb, tree, pushToast, setTree } = useKBStore();
  const { openTab, setMainView } = useLayoutStore();
  const [name, setName] = useState('');
  const [targetDir, setTargetDir] = useState(initialDirPath || '');
  const [useTemplate, setUseTemplate] = useState(true);
  const [templateInfo, setTemplateInfo] = useState<NoteTemplateInfo | null>(null);
  const [preview, setPreview] = useState('');
  const [creating, setCreating] = useState(false);

  const dirs = tree ? flattenDirs(tree).filter((d) => d.path) : [];

  // 选择目标目录时加载模板信息
  useEffect(() => {
    if (!open || !activeKb || !targetDir) {
      setTemplateInfo(null);
      setPreview('');
      return;
    }
    (async () => {
      const info = await window.forge.template.getNoteTemplate(activeKb.id, targetDir);
      setTemplateInfo(info);
      const pv = await window.forge.template.previewNoteTemplate(activeKb.id, targetDir, name || '示例笔记');
      setPreview(pv);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, targetDir, name, activeKb?.id]);

  // 重置状态
  useEffect(() => {
    if (open) {
      setName('');
      setTargetDir(initialDirPath || dirs[0]?.path || '');
      setUseTemplate(true);
      setTemplateInfo(null);
      setPreview('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open || !activeKb) return null;

  async function handleCreate() {
    if (!name.trim()) {
      pushToast({ level: 'warn', text: '请输入笔记名称' });
      return;
    }
    setCreating(true);
    const kb = activeKb!;
    try {
      const note = await window.forge.fs.createNote(kb.id, targetDir, {
        name: name.trim(),
        useTemplate
      });
      const t = await window.forge.fs.listTree(kb.id);
      setTree(t);
      pushToast({ level: 'success', text: `已创建笔记：${note.name}` });
      onClose();
      setMainView('note');
      openTab(note.path);
    } catch (e) {
      pushToast({ level: 'error', text: '创建失败：' + String(e) });
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-8" onClick={onClose}>
      <div
        className="bg-content rounded-lg shadow-xl w-full max-w-lg flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <h2 className="font-semibold">新建笔记</h2>
          <button onClick={onClose} className="text-fg-faint hover:text-fg">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-sm">
          {/* 名称 */}
          <div>
            <label className="block text-xs text-fg-muted mb-1">笔记名称</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="输入笔记名称…"
              className="input"
              autoFocus
            />
          </div>

          {/* 目标目录 */}
          <div>
            <label className="block text-xs text-fg-muted mb-1">存放目录</label>
            <select value={targetDir} onChange={(e) => setTargetDir(e.target.value)} className="input">
              <option value="">（根目录）</option>
              {dirs.map((d) => (
                <option key={d.path} value={d.path}>{d.label}</option>
              ))}
            </select>
          </div>

          {/* 模板选择 */}
          <div>
            <label className="block text-xs text-fg-muted mb-1">笔记模板</label>
            <div className="flex gap-2">
              <label
                className={`flex-1 px-3 py-2 rounded border cursor-pointer ${
                  useTemplate ? 'border-brand bg-active-bg text-fg' : 'border-border'
                }`}
              >
                <input type="radio" className="hidden" checked={useTemplate} onChange={() => setUseTemplate(true)} />
                <div className="font-medium">套用目录模板</div>
                <div className="text-xs text-fg-muted">
                  {templateInfo?.hasCustom ? '（已自定义）' : templateInfo ? '（默认）' : '（该目录无模板）'}
                </div>
              </label>
              <label
                className={`flex-1 px-3 py-2 rounded border cursor-pointer ${
                  !useTemplate ? 'border-brand bg-active-bg text-fg' : 'border-border'
                }`}
              >
                <input type="radio" className="hidden" checked={!useTemplate} onChange={() => setUseTemplate(false)} />
                <div className="font-medium">空白笔记</div>
                <div className="text-xs text-fg-muted">仅生成标题</div>
              </label>
            </div>
          </div>

          {/* 模板预览 */}
          {useTemplate && templateInfo && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-fg-muted">模板预览（{templateInfo.dirName}）</label>
                {templateInfo.variables.length > 0 && (
                  <span className="text-[10px] text-fg-faint">
                    可用变量：{templateInfo.variables.join(' ')}
                  </span>
                )}
              </div>
              <pre className="text-xs bg-canvas rounded p-3 max-h-48 overflow-y-auto whitespace-pre-wrap text-fg-secondary">
                {preview || templateInfo.content || '（空模板）'}
              </pre>
            </div>
          )}
          {useTemplate && !templateInfo && (
            <div className="text-xs text-fg-faint">该目录未配置笔记模板，将创建空白笔记。</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border flex justify-end gap-2">
          <button onClick={onClose} className="btn btn-secondary">取消</button>
          <button onClick={handleCreate} disabled={creating} className="btn btn-primary">
            {creating ? '创建中…' : '创建'}
          </button>
        </div>
      </div>
    </div>
  );
}
