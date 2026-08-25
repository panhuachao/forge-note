// macOS 专用：修复 Electron 二进制被 Gatekeeper 误报为恶意软件的问题
// 原理：递归清除隔离属性 + ad-hoc 签名，使本地 Electron 通过 Gatekeeper 校验
// 非 macOS 平台自动跳过。
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const isMac = process.platform === 'darwin';
const appPath = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'Electron.app');

if (!isMac) {
  console.log('[fix-electron] 非 macOS 平台，跳过。');
  process.exit(0);
}

if (!fs.existsSync(appPath)) {
  console.log('[fix-electron] Electron.app 不存在，跳过（首次安装可能尚未下载）。');
  process.exit(0);
}

try {
  // 1. 递归清除隔离属性（quarantine / provenance）
  execSync(`xattr -cr "${appPath}"`, { stdio: 'pipe' });
  console.log('[fix-electron] 已清除隔离属性。');

  // 2. ad-hoc 签名（临时签名），让 Gatekeeper 信任本地构建
  execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'pipe' });
  console.log('[fix-electron] 已执行 ad-hoc 签名，Gatekeeper 将不再拦截。');
} catch (e) {
  console.warn('[fix-electron] 修复失败（不影响主流程）：', e.message);
}
