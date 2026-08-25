// 渲染 logo.svg -> 各尺寸 PNG (resources/icons)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { Resvg } from '@resvg/resvg-js';

const root = join(process.cwd(), 'resources/icons');
const svg = readFileSync(join(root, 'logo.svg'), 'utf8');
const sizes = [16, 32, 64, 128, 256, 512, 1024];

for (const s of sizes) {
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: s } });
  const png = r.render().asPng();
  writeFileSync(join(root, `icon-${s}.png`), png);
}
// 别名：1024 作为 icon.png
const big = new Resvg(svg, { fitTo: { mode: 'width', value: 1024 } }).render().asPng();
writeFileSync(join(root, 'icon.png'), big);
writeFileSync(join(root, 'logo-source.png'), big);
console.log('rendered', sizes.join(','));
