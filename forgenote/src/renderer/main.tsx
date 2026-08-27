import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { App } from './App';
import './styles/index.css';

// 渲染层兜底：任何未捕获错误都显示在界面上，便于打包后诊断（避免白屏/黑屏无信息）
function showFatalError(msg: string) {
  const root = document.getElementById('root');
  if (!root) return;
  root.innerHTML = `
    <div style="font-family: -apple-system, 'PingFang SC', sans-serif; padding: 32px; color: #b91c1c;">
      <h2>应用启动失败</h2>
      <pre style="white-space: pre-wrap; background: #fef2f2; padding: 16px; border-radius: 8px; font-size: 13px; line-height: 1.6;">${msg}</pre>
    </div>`;
}

window.addEventListener('error', (e) => {
  showFatalError(String(e.error?.stack || e.message));
});
window.addEventListener('unhandledrejection', (e) => {
  showFatalError('Unhandled rejection: ' + String((e as PromiseRejectionEvent).reason));
});

try {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <HashRouter>
        <App />
      </HashRouter>
    </React.StrictMode>
  );
} catch (err) {
  showFatalError(String((err as Error)?.stack || err));
}
