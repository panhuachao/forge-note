// 将多个 PNG 打包为 Windows .ico（内嵌 PNG 数据，现代 Windows 支持）
// 用法: node scripts/make-ico.mjs <out.ico> <sizes:png> <sizes:png> ...
import { writeFileSync, readFileSync } from 'fs';

const [, , out, ...pairs] = process.argv;
const entries = [];
for (const p of pairs) {
  const [sizes, file] = p.split(':');
  for (const s of sizes.split(',')) {
    const size = parseInt(s, 10);
    const data = readFileSync(file);
    entries.push({ size, data });
  }
}
entries.sort((a, b) => a.size - b.size);

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type = icon
header.writeUInt16LE(entries.length, 4);

const dirEntrySize = 16;
const offsetStart = 6 + dirEntrySize * entries.length;
let offset = offsetStart;
const dir = [];
for (const e of entries) {
  const entry = Buffer.alloc(dirEntrySize);
  const b = e.size >= 256 ? 0 : e.size; // 256+ 用 0 表示
  entry.writeUInt8(b, 0); // width
  entry.writeUInt8(b, 1); // height
  entry.writeUInt8(0, 2); // palette
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bit count
  entry.writeUInt32LE(e.data.length, 8); // data size
  entry.writeUInt32LE(offset, 12); // data offset
  dir.push(entry);
  offset += e.data.length;
}

const outBuf = Buffer.concat([header, ...dir, ...entries.map((e) => e.data)]);
writeFileSync(out, outBuf);
console.log('wrote', out, entries.map((e) => e.size).join(','));
