import { useEffect, useState } from 'react';
import { useKBStore } from './stores/kb-store';
import { useLayoutStore } from './stores/layout-store';
import { MainMenuRail } from './components/MainMenuRail';
import { ToastContainer } from './components/Toast';
import { LeftPanel } from './components/LeftPanel';
import { RightPanel } from './components/RightPanel';
import { MultiNoteEditor } from './components/MultiNoteEditor';
import { HomePage } from './pages/HomePage';
import { GraphPage } from './pages/GraphPage';
import { TemplatePage } from './pages/TemplatePage';
import { AuditPage } from './pages/AuditPage';
import { SettingsPage } from './pages/SettingsPage';
import ChatPage from './pages/ChatPage';
import SearchResultsPage from './pages/SearchResultsPage';
import { StatusBar } from './components/StatusBar';
import { Onboarding } from './components/Onboarding';
import { SetupWizard } from './components/SetupWizard';
import { CreateNoteModal } from './components/CreateNoteModal';
import { QuickNoteModal } from './components/QuickNoteModal';
import { TopBar } from './components/TopBar';
import { TreeContextMenuRoot } from './components/TreeContextMenuRoot';
import { CollapsedLeftHandle, CollapsedRightHandle } from './components/CollapsedPanelHandle';

export function App() {
  const {
    setKBs, setActiveKb, setTree, setApplied, setAIConfig,
    openCreateNote, createNoteOpen, createNoteDir, closeCreateNote,
    quickNoteOpen, closeQuickNote
  } = useKBStore();
  const { mainView, leftPanelCollapsed, rightPanelCollapsed } = useLayoutStore();
  const [quickNoteInitial, setQuickNoteInitial] = useState('');
  const [showSetup, setShowSetup] = useState(false);

  useEffect(() => {
    (async () => {
      const kbs = await window.forge.kb.list();
      setKBs(kbs);
      // 首次启动：没有任何知识库时，展示配置指引向导
      if (kbs.length === 0) {
        setShowSetup(true);
        return;
      }
      const active = await window.forge.kb.getActive();
      if (active) await openKb(active.id);
      const aiCfg = await window.forge.ai.getConfig();
      setAIConfig(aiCfg);
    })();
    const off = window.forge.events.onFsChange(async () => {
      const { activeKb } = useKBStore.getState();
      if (!activeKb) return;
      const tree = await window.forge.fs.listTree(activeKb.id);
      setTree(tree);
    });
    const offMenu = window.forge.events.onMenuNewNote(() => {
      const { activeKb } = useKBStore.getState();
      if (activeKb) openCreateNote();
    });
    // 从任意页面（如对话历史）请求打开快速笔记并预填内容
    const onOpenQuickNote = (e: Event) => {
      const detail = (e as CustomEvent<{ content?: string }>).detail;
      setQuickNoteInitial(detail?.content || '');
      useKBStore.getState().openQuickNote();
    };
    window.addEventListener('forgenote:open-quicknote', onOpenQuickNote);
    return () => {
      off();
      offMenu();
      window.removeEventListener('forgenote:open-quicknote', onOpenQuickNote);
    };
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

  function renderMain() {
    if (mainView === 'home') return <HomePage />;
    if (mainView === 'graph') return <GraphPage />;
    if (mainView === 'template') return <TemplatePage />;
    if (mainView === 'audit') return <AuditPage />;
    if (mainView === 'settings') return <SettingsPage />;
    if (mainView === 'chat') return <ChatPage />;
    if (mainView === 'search-results') return <SearchResultsPage />;
    return <MultiNoteEditor />;
  }

  const isNoteView = mainView === 'note';
  const showLeft = isNoteView && !leftPanelCollapsed;
  const showRight = isNoteView && !rightPanelCollapsed;

  return (
    <div className="h-screen w-screen flex flex-col bg-canvas">
      {/* 主体三栏：MainMenuRail / LeftPanel / Middle / RightPanel
          TopBar 嵌在中列顶部，与主体共用同一水平行
          → 左/中/右的分割线可贯穿到顶（窗口控件行）
          → 左/右 TopBar 段背景浅灰、中段白底
          非笔记视图（graph/template/...）没有 TopBar，
          但中列首行仍需让出 macOS 红黄绿按钮（pl-[72px]），
          避免各 page 自己的 h-10 标题栏与窗口控件重叠 */}
      <div className="flex-1 flex overflow-hidden">
        <MainMenuRail />
        {isNoteView && (showLeft ? <LeftPanel /> : <CollapsedLeftHandle />)}
        <div className="flex-1 flex flex-col overflow-hidden bg-content">
          {isNoteView && <TopBar />}
          <div className="flex-1 flex overflow-hidden">{renderMain()}</div>
        </div>
        {isNoteView && (showRight ? <RightPanel /> : <CollapsedRightHandle />)}
      </div>
      <StatusBar />
      <ToastContainer />
      <Onboarding />
      {showSetup && <SetupWizard onDone={() => setShowSetup(false)} />}
      <TreeContextMenuRoot />
      <CreateNoteModal open={createNoteOpen} initialDirPath={createNoteDir} onClose={closeCreateNote} />
      <QuickNoteModal
        key={quickNoteInitial ? 'qk-filled' : 'qk-empty'}
        open={quickNoteOpen}
        initialContent={quickNoteInitial}
        onClose={closeQuickNote}
      />
    </div>
  );
}