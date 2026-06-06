/**
 * Generate a branded app icon (build/icon.png, 512x512 RGBA) with no external dependencies.
 * Draws a navy rounded-square with an ascending gold/emerald/electric bar-chart motif.
 * electron-builder uses build/icon.png to produce platform icons (.ico/.icns/.png).
 */
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

const S = 512;
const buf = Buffer.alloc(S * S * 4); // RGBA

const NAVY = [11, 31, 58, 255];
const GOLD = [245, 179, 1, 255];
const EMERALD = [16, 185, 129, 255];
const ELECTRIC = [47, 109, 246, 255];
const TRANSPARENT = [0, 0, 0, 0];

function set(x, y, c) {
  const i = (y * S + x) * 4;
  buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = c[3];
}

// rounded-square mask
const radius = 96;
function inRounded(x, y) {
  const minX = 0, minY = 0, maxX = S - 1, maxY = S - 1;
  const rx = Math.min(Math.max(x, minX + radius), maxX - radius);
  const ry = Math.min(Math.max(y, minY + radius), maxY - radius);
  const dx = x < minX + radius ? x - (minX + radius) : x > maxX - radius ? x - (maxX - radius) : 0;
  const dy = y < minY + radius ? y - (minY + radius) : y > maxY - radius ? y - (maxY - radius) : 0;
  return dx * dx + dy * dy <= radius * radius || (rx === x ? true : dx * dx + dy * dy <= radius * radius);
}

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    set(x, y, inRounded(x, y) ? NAVY : TRANSPARENT);
  }
}

// three ascending bars (chart motif), centered
const bars = [
  { color: GOLD, h: 150 },
  { color: EMERALD, h: 230 },
  { color: ELECTRIC, h: 310 },
];
const barW = 80;
const gap = 28;
const totalW = bars.length * barW + (bars.length - 1) * gap;
let bx = Math.floor((S - totalW) / 2);
const baseY = 380;
for (const bar of bars) {
  const top = baseY - bar.h;
  for (let y = top; y < baseY; y++) {
    for (let x = bx; x < bx + barW; x++) {
      if (inRounded(x, y)) set(x, y, bar.color);
    }
  }
  bx += barW + gap;
}

// PNG encode
function crc32(buf2) {
  let c = ~0;
  for (let i = 0; i < buf2.length; i++) {
    c ^= buf2[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8;   // bit depth
ihdr[9] = 6;   // color type RGBA
ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

// raw scanlines with filter byte 0
const raw = Buffer.alloc(S * (1 + S * 4));
for (let y = 0; y < S; y++) {
  raw[y * (1 + S * 4)] = 0;
  buf.copy(raw, y * (1 + S * 4) + 1, y * S * 4, (y + 1) * S * 4);
}
const idat = zlib.deflateSync(raw, { level: 9 });

const png = Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);

const outDir = path.resolve(process.cwd(), 'build');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'icon.png'), png);
console.log(`Wrote build/icon.png (${png.length} bytes, ${S}x${S})`);
