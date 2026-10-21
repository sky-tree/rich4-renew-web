#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = join(__dirname, '../public/icons');

// --- Standard Minimal PNG Encoder using Node.js zlib ---

function crc32(buf) {
  let table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c;
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ table[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodeRGBAtoPNG(width, height, rgbaBuffer) {
  // PNG signature
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR: width, height, bitDepth=8, colorType=6 (RGBA), comp=0, filter=0, interlace=0
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const ihdrChunk = makeChunk('IHDR', ihdr);

  // IDAT: Scanlines with filter type 0 (None)
  const scanlineLength = 1 + width * 4;
  const rawData = Buffer.alloc(scanlineLength * height);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * scanlineLength;
    rawData[rowOffset] = 0; // Filter: None
    rgbaBuffer.copy(rawData, rowOffset + 1, y * width * 4, (y + 1) * width * 4);
  }

  const compressed = zlib.deflateSync(rawData, { level: 9 });
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, ihdrChunk, idatChunk, iendChunk]);
}

// --- Procedural Rich4 Icon Renderer with 3x3 Supersampling ---

function samplePixel(u, v) {
  // u, v in [-1, 1]
  // 1. App background rounded rectangle (maskable safe: box extent 0.88, corner 0.22)
  const boxExtent = 0.88;
  const cornerR = 0.22;
  const dx = Math.max(0, Math.abs(u) - (boxExtent - cornerR));
  const dy = Math.max(0, Math.abs(v) - (boxExtent - cornerR));
  const boxDist = Math.hypot(dx, dy) - cornerR;

  if (boxDist > 0) {
    // Outside icon shape
    return [0, 0, 0, 0];
  }

  // Base teal background gradient (top-left #10444c to bottom-right #072327)
  const grad = (u + v + 2) / 4; // 0..1
  let r = Math.round(16 * (1 - grad) + 7 * grad);
  let g = Math.round(68 * (1 - grad) + 35 * grad);
  let b = Math.round(76 * (1 - grad) + 39 * grad);
  let a = 255;

  const distToCenter = Math.hypot(u, v);

  // 2. Outer golden coin ring (r = 0.58 .. 0.70)
  if (distToCenter >= 0.56 && distToCenter <= 0.72) {
    const coinGrad = (u - v + 1.4) / 2.8; // highlight top-left
    const cr = Math.round(245 * coinGrad + 196 * (1 - coinGrad));
    const cg = Math.round(180 * coinGrad + 140 * (1 - coinGrad));
    const cb = Math.round(30 * coinGrad + 15 * (1 - coinGrad));

    // Smooth edge blending inside ring
    const edgeDist = Math.min(distToCenter - 0.56, 0.72 - distToCenter);
    const alpha = Math.min(1, edgeDist / 0.02);
    r = Math.round(r * (1 - alpha) + cr * alpha);
    g = Math.round(g * (1 - alpha) + cg * alpha);
    b = Math.round(b * (1 - alpha) + cb * alpha);
  }

  // Inner ring accent
  if (distToCenter >= 0.52 && distToCenter <= 0.55) {
    r = Math.round(r * 0.4 + 255 * 0.6);
    g = Math.round(g * 0.4 + 215 * 0.6);
    b = Math.round(b * 0.4 + 0 * 0.6);
  }

  // 3. Central white dice tile (rounded square, half-size 0.28, corner 0.07)
  const diceHalf = 0.28;
  const diceCorner = 0.07;
  const ddx = Math.max(0, Math.abs(u) - (diceHalf - diceCorner));
  const ddy = Math.max(0, Math.abs(v) - (diceHalf - diceCorner));
  const diceDist = Math.hypot(ddx, ddy) - diceCorner;

  if (diceDist <= 0) {
    // Inside white dice: pure ivory white with gentle warm shading
    const diceShade = 1 - (u * 0.1 + v * 0.1);
    let dr = Math.min(255, Math.round(250 * diceShade));
    let dg = Math.min(255, Math.round(252 * diceShade));
    let db = Math.min(255, Math.round(255 * diceShade));

    // 4. Dice dots: 4 red pips (Rich4 signature)
    const dotOffset = 0.13;
    const dotR = 0.055;
    const dots = [
      [-dotOffset, -dotOffset],
      [dotOffset, -dotOffset],
      [-dotOffset, dotOffset],
      [dotOffset, dotOffset],
    ];

    let insidePip = false;
    for (const [cx, cy] of dots) {
      const pipDist = Math.hypot(u - cx, v - cy);
      if (pipDist <= dotR) {
        insidePip = true;
        // Deep Chinese lacquer red (#d32f2f) with pip depth
        const pipShade = Math.min(1, (dotR - pipDist) / 0.015);
        dr = Math.round(211 * pipShade + 180 * (1 - pipShade));
        dg = Math.round(47 * pipShade + 30 * (1 - pipShade));
        db = Math.round(47 * pipShade + 30 * (1 - pipShade));
        break;
      }
    }

    // Blend dice into canvas
    const diceEdgeAlpha = Math.min(1, Math.max(0, -diceDist / 0.015));
    r = Math.round(r * (1 - diceEdgeAlpha) + dr * diceEdgeAlpha);
    g = Math.round(g * (1 - diceEdgeAlpha) + dg * diceEdgeAlpha);
    b = Math.round(b * (1 - diceEdgeAlpha) + db * diceEdgeAlpha);
  }

  // Border glow on the app icon
  if (boxDist > -0.03 && boxDist <= 0) {
    const glow = Math.min(1, (boxDist + 0.03) / 0.03);
    r = Math.round(r * (1 - glow * 0.5) + 255 * glow * 0.5);
    g = Math.round(g * (1 - glow * 0.5) + 215 * glow * 0.5);
    b = Math.round(b * (1 - glow * 0.5) + 70 * glow * 0.5);
  }

  return [r, g, b, a];
}

function renderIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  const samples = [
    [-1 / 3, -1 / 3], [0, -1 / 3], [1 / 3, -1 / 3],
    [-1 / 3, 0],      [0, 0],      [1 / 3, 0],
    [-1 / 3, 1 / 3],  [0, 1 / 3],  [1 / 3, 1 / 3],
  ];
  const weight = 1 / samples.length;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let rSum = 0, gSum = 0, bSum = 0, aSum = 0;
      for (const [sx, sy] of samples) {
        const u = ((x + 0.5 + sx * 0.5) / (size / 2)) - 1;
        const v = ((y + 0.5 + sy * 0.5) / (size / 2)) - 1;
        const [r, g, b, a] = samplePixel(u, v);
        rSum += r * (a / 255);
        gSum += g * (a / 255);
        bSum += b * (a / 255);
        aSum += a;
      }
      const finalA = Math.round(aSum * weight);
      const alphaNorm = finalA > 0 ? (finalA / 255) : 1;
      const finalR = Math.min(255, Math.round((rSum * weight) / alphaNorm));
      const finalG = Math.min(255, Math.round((gSum * weight) / alphaNorm));
      const finalB = Math.min(255, Math.round((bSum * weight) / alphaNorm));

      const idx = (y * size + x) * 4;
      buf[idx] = finalR;
      buf[idx + 1] = finalG;
      buf[idx + 2] = finalB;
      buf[idx + 3] = finalA;
    }
  }

  return encodeRGBAtoPNG(size, size, buf);
}

// Generate SVG representation for modern browsers
function generateSVG() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#10444c"/>
      <stop offset="100%" stop-color="#072327"/>
    </linearGradient>
    <linearGradient id="gold" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffe875"/>
      <stop offset="50%" stop-color="#f5b300"/>
      <stop offset="100%" stop-color="#c48200"/>
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="130%" height="130%">
      <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#000" flood-opacity="0.35"/>
    </filter>
  </defs>
  <!-- Background Rounded Rect -->
  <rect x="32" y="32" width="448" height="448" rx="96" fill="url(#bg)" stroke="#ffe875" stroke-width="4" stroke-opacity="0.5"/>
  <!-- Golden Ring -->
  <circle cx="256" cy="256" r="162" fill="none" stroke="url(#gold)" stroke-width="28" filter="url(#shadow)"/>
  <circle cx="256" cy="256" r="136" fill="none" stroke="#ffe875" stroke-width="4" stroke-opacity="0.7"/>
  <!-- Central Ivory Dice with 4 Red Pips -->
  <rect x="184" y="184" width="144" height="144" rx="28" fill="#fafafa" filter="url(#shadow)"/>
  <circle cx="218" cy="218" r="14" fill="#d32f2f"/>
  <circle cx="294" cy="218" r="14" fill="#d32f2f"/>
  <circle cx="218" cy="294" r="14" fill="#d32f2f"/>
  <circle cx="294" cy="294" r="14" fill="#d32f2f"/>
</svg>
`;
}

// Generate minimal ICO header wrapping a 32x32 PNG
function generateICO(png32Buffer) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // ICO image type (1 = icon)
  header.writeUInt16LE(1, 4); // count of images: 1

  const entry = Buffer.alloc(16);
  entry.writeUInt8(32, 0); // width
  entry.writeUInt8(32, 1); // height
  entry.writeUInt8(0, 2);  // color palette (0 = no palette)
  entry.writeUInt8(0, 3);  // reserved
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(png32Buffer.length, 8); // image size
  entry.writeUInt32LE(22, 12); // image offset (6 header + 16 entry = 22)

  return Buffer.concat([header, entry, png32Buffer]);
}

function main() {
  if (!existsSync(ICONS_DIR)) {
    mkdirSync(ICONS_DIR, { recursive: true });
  }

  console.log('[generate-icons] Rendering icon-192.png...');
  const png192 = renderIcon(192);
  writeFileSync(join(ICONS_DIR, 'icon-192.png'), png192);

  console.log('[generate-icons] Rendering icon-512.png...');
  const png512 = renderIcon(512);
  writeFileSync(join(ICONS_DIR, 'icon-512.png'), png512);

  console.log('[generate-icons] Rendering icon-32.png and favicon.ico...');
  const png32 = renderIcon(32);
  writeFileSync(join(ICONS_DIR, 'icon-32.png'), png32);
  const ico = generateICO(png32);
  writeFileSync(join(__dirname, '../public/favicon.ico'), ico);

  console.log('[generate-icons] Writing icon.svg...');
  writeFileSync(join(ICONS_DIR, 'icon.svg'), generateSVG(), 'utf8');

  console.log('[generate-icons] Successfully generated all standalone PWA icons.');
}

main();
