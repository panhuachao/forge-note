import { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useKBStore } from './stores/kb-store';
import { Sidebar } from './components/Sidebar';
import { TitleBar } from './components/TitleBar';
import { ToastContainer } from './components/Toast';
import { HomePage } from './pages/HomePage';
import { NotePage } from './pages/NotePage';
import { GraphPage } from './pages/GraphPage';
import { TemplatePage } from './pages/TemplatePage';
import { SettingsPage } from './pages/SettingsPage';
import { AuditPage } from './pages/AuditPage';
import { Onboarding } from './components/Onboarding';

export function App() {
  const { setKBs, setActiveKb, setTree, setApplied, setTheme, theme, setAIConfig } = useKBStore();
  const location = useLocation();

  useEffect(() => {
    // 初始化
    (async () => {
      const kbs = await window.forge.kb.list();
      setKBs(kbs);
      const active = await window.forge.kb.getActive();
      if (active) {
        await openKb(active.id);
      }
      const aiCfg = await window.forge.ai.getConfig();
      setAIConfig(aiCfg);
    })();
    // 监听文件系统变动
    const off = window.forge.events.onFsChange(async (e) => {
      const { activeKb } = useKBStore.getState();
      if (!activeKb) return;
      // 重建树
      const tree = await window.forge.fs.listTree(activeKb.id);
      setTree(tree);
    });
    return () => off();
  }, []);

  async function openKb(kbId: string) {
    await window.forge.kb.open(kbId);
    const active = await window.forge.kb.getActive();
    setActiveKb(active);
    if (active) {
      const tree = await window.forge.fs.listTree(active.id);
      setTree(tree);
      const applied = await window.forge.template.applied(active.id);
      setApplied(applied);
    }
  }

  useEffect(() => {
    if (theme === 'dark') document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [theme]);

  const { activeKb } = useKBStore();
  const showSidebar = !!activeKb;

  return (
    <div className="h-screen w-screen flex flex-col bg-ink-50">
      <TitleBar />
      <div className="flex-1 flex overflow-hidden">
        {showSidebar && <Sidebar />}
        <main className="flex-1 flex overflow-hidden">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/note/*" element={<NotePage />} />
            <Route path="/graph" element={<GraphPage />} />
            <Route path="/template" element={<TemplatePage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/audit" element={<AuditPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
      <ToastContainer />
      <Onboarding />
    </div>
  );
}
