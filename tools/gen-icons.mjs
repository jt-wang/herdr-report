// Writes the app icons as PNGs with no image dependency: the Things-style
// progress circle (an outline with a filled wedge) in white on the page's blue.
// The PNG writer comes from codexbar-pwa (MIT, same author).
//
//   node tools/gen-icons.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const OUT = new URL("../web/", import.meta.url);
const BLUE = [0x33, 0x73, 0xeb];

const CRC = Int32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour + alpha
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Shapes in units of the icon's width, centre at (0.5, 0.5).
// rounded: corner radius of the blue square, 0 for full bleed (iOS and
// "maskable" icons are cut to shape by the system). scale: glyph size.
function icon(size, { rounded = 0, scale = 1 } = {}) {
  const ring = 0.3 * scale, stroke = 0.055 * scale, inner = ring - stroke * 1.9;
  const wedge = (2 / 3) * 2 * Math.PI; // two thirds done
  const SS = 4; // supersamples per axis
  const rgba = Buffer.alloc(size * size * 4);
  const inSquare = (x, y) => {
    if (!rounded) return true;
    const dx = Math.max(rounded - x, 0, x - (1 - rounded)), dy = Math.max(rounded - y, 0, y - (1 - rounded));
    return dx * dx + dy * dy <= rounded * rounded;
  };
  const isGlyph = (x, y) => {
    const dx = x - 0.5, dy = y - 0.5, r = Math.hypot(dx, dy);
    if (Math.abs(r - ring) <= stroke / 2) return true;
    if (r > inner) return false;
    const a = (Math.atan2(dx, -dy) + 2 * Math.PI) % (2 * Math.PI); // from 12 o'clock, clockwise
    return a <= wedge;
  };
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bg = 0, fg = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size, y = (py + (sy + 0.5) / SS) / size;
          if (!inSquare(x, y)) continue;
          bg++;
          if (isGlyph(x, y)) fg++;
        }
      }
      const n = SS * SS, i = (py * size + px) * 4;
      const w = bg ? fg / bg : 0;
      rgba[i] = Math.round(BLUE[0] + (255 - BLUE[0]) * w);
      rgba[i + 1] = Math.round(BLUE[1] + (255 - BLUE[1]) * w);
      rgba[i + 2] = Math.round(BLUE[2] + (255 - BLUE[2]) * w);
      rgba[i + 3] = Math.round((255 * bg) / n);
    }
  }
  return png(size, rgba);
}

const files = {
  "icon-180.png": icon(180), // apple-touch-icon: iOS rounds the corners itself
  "icon-192.png": icon(192, { rounded: 0.22 }),
  "icon-512.png": icon(512, { rounded: 0.22 }),
  "icon-maskable-512.png": icon(512, { scale: 0.8 }), // glyph inside the 80% safe zone
  "icon-32.png": icon(32, { rounded: 0.22, scale: 1.15 }),
};
for (const [name, data] of Object.entries(files)) writeFileSync(new URL(name, OUT), data);
console.log(Object.keys(files).join(" "));
