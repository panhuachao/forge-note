import { useEffect, useState } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
}

const REPO_URL = 'https://github.com/panhuachao/forge-note';
// 产品初衷固定文案
const PHILOSOPHY = '在 AI 时代，不做 AI 的奴隶，而让 AI 帮助自己成长。';

export function AboutDialog({ open, onClose }: Props) {
  const [version, setVersion] = useState<string>('');

  useEffect(() => {
    if (!open) return;
    // 自动从主进程读取 package.json 的 version
    window.forge.app?.getVersion?.().then((v) => setVersion(v || '')).catch(() => {});
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onMouseDown={onClose}
    >
      <div
        className="w-[420px] max-w-[90vw] bg-content border border-border-soft rounded-xl shadow-xl p-6 text-fg-primary"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">锦囊笔记 ForgeNote</h2>
        <p className="mt-1 text-xs text-fg-muted">
          当前版本：<span className="font-mono">{version || '—'}</span> · MIT License · Forge your knowledge.
        </p>

        <p className="mt-4 text-sm leading-relaxed text-fg-secondary">{PHILOSOPHY}</p>

        <p className="mt-4 text-xs text-fg-muted">项目主页</p>
        <a
          href={REPO_URL}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-block text-sm text-fg-secondary hover:underline break-all"
        >
          {REPO_URL}
        </a>

        <div className="mt-6 flex justify-end">
          <button onClick={onClose} className="btn btn-primary px-6 py-2 text-sm">
            好
          </button>
        </div>
      </div>
    </div>
  );
}