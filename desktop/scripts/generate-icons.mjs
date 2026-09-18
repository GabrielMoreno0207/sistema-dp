/**
 * Gera os ícones do aplicativo em resources/ (PNG), sem dependências externas.
 * Uso: node scripts/generate-icons.mjs
 *
 * - icon.png            256x256  ícone do app / instalador
 * - tray.png            16x16    bandeja (sem mensagens não lidas) + tray@2x.png 32x32
 * - tray-unread.png     16x16    bandeja (com mensagens não lidas) + tray-unread@2x.png
 * - badge.png           16x16    selo vermelho sobre o ícone da barra de tarefas + badge@2x.png
 *
 * O Electron escolhe a versão @2x sozinho em telas com escala de 200%.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources');

// ---------------------------------------------------------------- PNG

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bits por canal
  header[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filtro "none"
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- formas (coordenadas 0..1)

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function inRoundedRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

function inTriangle(x, y, [ax, ay], [bx, by], [cx, cy]) {
  const d1 = (x - bx) * (ay - by) - (ax - bx) * (y - by);
  const d2 = (x - cx) * (by - cy) - (bx - cx) * (y - cy);
  const d3 = (x - ax) * (cy - ay) - (cx - ax) * (y - ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/** Rasteriza com supersampling 4x4 para bordas suaves. draw(x, y) -> [r,g,b] | null */
function render(size, draw) {
  const SS = 4;
  const out = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const color = draw((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size);
          if (color) {
            r += color[0];
            g += color[1];
            b += color[2];
            a += 1;
          }
        }
      }
      const i = (py * size + px) * 4;
      if (a > 0) {
        out[i] = Math.round(r / a);
        out[i + 1] = Math.round(g / a);
        out[i + 2] = Math.round(b / a);
        out[i + 3] = Math.round((a / (SS * SS)) * 255);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- desenho

const BLUE = hex('#1d4ed8');
const WHITE = hex('#ffffff');
const RED = hex('#dc2626');

/** Balão de conversa branco com três pontos, sobre quadrado azul arredondado */
function drawIcon(x, y) {
  const dots = [0.36, 0.5, 0.64];
  if (dots.some((cx) => inCircle(x, y, cx, 0.445, 0.052))) return BLUE;
  if (inRoundedRect(x, y, 0.2, 0.24, 0.8, 0.65, 0.13)) return WHITE;
  if (inTriangle(x, y, [0.3, 0.6], [0.46, 0.6], [0.28, 0.8])) return WHITE;
  if (inRoundedRect(x, y, 0.03, 0.03, 0.97, 0.97, 0.22)) return BLUE;
  return null;
}

function drawIconWithBadge(x, y) {
  if (inCircle(x, y, 0.79, 0.21, 0.19)) return RED;
  if (inCircle(x, y, 0.79, 0.21, 0.25)) return WHITE;
  return drawIcon(x, y);
}

const drawBadge = (x, y) => (inCircle(x, y, 0.5, 0.5, 0.42) ? RED : inCircle(x, y, 0.5, 0.5, 0.5) ? WHITE : null);

mkdirSync(OUT_DIR, { recursive: true });
const files = [
  ['icon.png', 256, drawIcon],
  ['tray.png', 16, drawIcon],
  ['tray@2x.png', 32, drawIcon],
  ['tray-unread.png', 16, drawIconWithBadge],
  ['tray-unread@2x.png', 32, drawIconWithBadge],
  ['badge.png', 16, drawBadge],
  ['badge@2x.png', 32, drawBadge],
];
for (const [name, size, draw] of files) {
  writeFileSync(join(OUT_DIR, name), encodePng(size, render(size, draw)));
  console.log(`resources/${name} (${size}x${size})`);
}
