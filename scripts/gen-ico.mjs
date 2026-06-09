/**
 * Wrap build/icon.png (512x512 PNG) into build/icon.ico (PNG-in-ICO, Vista+).
 * Used for the Windows app icon and the dev desktop shortcut. No dependencies.
 */
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(process.cwd(), 'build');
const png = fs.readFileSync(path.join(dir, 'icon.png'));

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: 1 = icon
header.writeUInt16LE(1, 4); // image count

const entry = Buffer.alloc(16);
entry.writeUInt8(0, 0); // width  (0 = 256+)
entry.writeUInt8(0, 1); // height (0 = 256+)
entry.writeUInt8(0, 2); // color palette
entry.writeUInt8(0, 3); // reserved
entry.writeUInt16LE(1, 4); // color planes
entry.writeUInt16LE(32, 6); // bits per pixel
entry.writeUInt32LE(png.length, 8); // size of image data
entry.writeUInt32LE(6 + 16, 12); // offset to image data

fs.writeFileSync(path.join(dir, 'icon.ico'), Buffer.concat([header, entry, png]));
console.log(`Wrote build/icon.ico (${6 + 16 + png.length} bytes)`);
