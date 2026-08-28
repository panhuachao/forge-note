// 从 resources/icons/logo.png 生成各尺寸 PNG 图标、macOS .icns 与 Windows .ico
// 用法: node scripts/render-logo.mjs
// 依赖: macOS 自带 sips / iconutil
import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', 'resources', 'icons');

const src = join(root, 'logo.png');
if (!existsSync(src)) {
  console.error('找不到源图 resources/icons/logo.png');
  process.exit(1);
}

const sizes = [16, 32, 64, 128, 256, 512, 1024];
const tmp = join(root, '.render-tmp');
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

// 1) 居中裁剪为正方形（取较短边），避免非方形 logo 变形
const dims = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', src])
  .toString()
  .split('\n');
const getNum = (lines, key) => {
  const l = lines.find((x) => x.includes(key));
  return l ? parseInt(l.split(':')[1].trim(), 10) : 0;
};
const w = getNum(dims, 'pixelWidth');
const h = getNum(dims, 'pixelHeight');
const side = Math.min(w, h);
const square = join(tmp, 'square.png');
execFileSync('sips', ['-c', String(side), String(side), src, '--out', square], {
  stdio: 'ignore',
});

// 2) 缩放各尺寸 PNG
for (const s of sizes) {
  const out = join(root, `icon-${s}.png`);
  execFileSync('sips', ['-z', String(s), String(s), square, '--out', out], {
    stdio: 'ignore',
  });
  console.log('rendered', out);
}
const big = join(root, 'icon-1024.png');
writeFileSync(join(root, 'icon.png'), readFileSync(big));
writeFileSync(join(root, 'logo-source.png'), readFileSync(big));
console.log('rendered icon.png / logo-source.png');

// 3) macOS .icns (通过 .iconset)
const iconset = join(tmp, 'icon.iconset');
mkdirSync(iconset, { recursive: true });
const iconMap = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
];
for (const [name, s] of iconMap) {
  execFileSync('sips', ['-z', String(s), String(s), square, '--out', join(iconset, name)], {
    stdio: 'ignore',
  });
}
const icns = join(root, 'icon.icns');
execFileSync('iconutil', ['--convert', 'icns', '--output', icns, iconset], { stdio: 'ignore' });
console.log('rendered', icns);

// 4) Windows .ico (复用 scripts/make-ico.mjs)
const ico = join(root, 'icon.ico');
const icoSizes = [16, 32, 64, 128, 256, 512, 1024];
const icoArgs = icoSizes.map((s) => `${s}:${join(root, `icon-${s}.png`)}`);
execFileSync('node', [join(__dirname, 'make-ico.mjs'), ico, ...icoArgs], { stdio: 'ignore' });
console.log('rendered', ico);

// 清理临时目录
rmSync(tmp, { recursive: true, force: true });
console.log('done.');
