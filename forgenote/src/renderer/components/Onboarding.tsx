import { useEffect, useState } from 'react';
import { useKBStore } from '../stores/kb-store';
import { useLayoutStore } from '../stores/layout-store';

export function Onboarding() {
  const { activeKb, applied } = useKBStore();
  const { setMainView } = useLayoutStore();
  const [step, setStep] = useState(0);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!activeKb || !applied) return;
    const dismissed = localStorage.getItem(`forgenote:onboarded:${activeKb.id}`);
    if (dismissed) return;
    setShow(true);
    setStep(0);
  }, [activeKb?.id, applied?.appliedAt]);

  function dismiss() {
    if (activeKb) localStorage.setItem(`forgenote:onboarded:${activeKb.id}`, '1');
    setShow(false);
  }

  if (!show) return null;

  const steps = [
    {
      title: '欢迎来到锦囊笔记',
      body: '已为你应用「' + (applied?.meta.name || '') + '」模板。点击查看各目录说明开始使用。',
      action: () => setMainView('template')
    },
    {
      title: '创建第一条灵感',
      body: '在「00 灵感库」中新建笔记，记录你一闪而过的想法。',
      action: () => {
        // 滚动到目录树
        const tree = document.querySelector('[data-tree]') as HTMLElement | null;
        tree?.scrollIntoView();
      }
    },
    {
      title: '体验 AI 归纳推荐',
      body: '保存笔记后点击「归档」按钮，AI 会根据模板规则推荐最合适的归档目录。',
      action: () => {}
    }
  ];

  const s = steps[step];

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-content rounded-lg shadow-xl w-full max-w-md p-6">
        <h2 className="text-lg font-semibold mb-2">{s.title}</h2>
        <p className="text-sm text-fg-secondary mb-5">{s.body}</p>
        <div className="flex items-center justify-between">
          <div className="text-xs text-fg-faint">第 {step + 1} / {steps.length} 步</div>
          <div className="flex gap-2">
            <button onClick={dismiss} className="btn btn-ghost">跳过引导</button>
            {step > 0 && <button onClick={() => setStep(step - 1)} className="btn btn-secondary">上一步</button>}
            {step < steps.length - 1 ? (
              <button onClick={() => { s.action(); setStep(step + 1); }} className="btn btn-primary">下一步</button>
            ) : (
              <button onClick={dismiss} className="btn btn-primary">开始使用</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
