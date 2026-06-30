import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'dist-extension');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const require = createRequire(import.meta.url);
const esbuild = require(path.join(root, 'web/node_modules/esbuild'));

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  typeBuffer.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return out;
}

function writePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    rgba.copy(raw, row + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND'),
  ]);
}

function hexToRgb(hex) {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function blendPixel(data, width, x, y, color, alpha = 1) {
  if (x < 0 || y < 0 || x >= width || y >= width) return;
  const i = (y * width + x) * 4;
  const a = Math.max(0, Math.min(1, alpha)) * (color[3] == null ? 1 : color[3] / 255);
  const inv = 1 - a;
  data[i] = Math.round(color[0] * a + data[i] * inv);
  data[i + 1] = Math.round(color[1] * a + data[i + 1] * inv);
  data[i + 2] = Math.round(color[2] * a + data[i + 2] * inv);
  data[i + 3] = Math.round(255 * a + data[i + 3] * inv);
}

function fillRoundedRectGradient(data, size, x, y, w, h, r, topColor, bottomColor) {
  const top = hexToRgb(topColor);
  const bottom = hexToRgb(bottomColor);
  for (let py = Math.floor(y); py < Math.ceil(y + h); py++) {
    const t = Math.max(0, Math.min(1, (py - y) / h));
    const color = [
      Math.round(top[0] * (1 - t) + bottom[0] * t),
      Math.round(top[1] * (1 - t) + bottom[1] * t),
      Math.round(top[2] * (1 - t) + bottom[2] * t),
    ];
    for (let px = Math.floor(x); px < Math.ceil(x + w); px++) {
      const cx = px < x + r ? x + r : px > x + w - r ? x + w - r : px;
      const cy = py < y + r ? y + r : py > y + h - r ? y + h - r : py;
      const dx = px - cx;
      const dy = py - cy;
      if (dx * dx + dy * dy <= r * r) blendPixel(data, size, px, py, color);
    }
  }
}

function fillRoundedRect(data, size, x, y, w, h, r, color, alpha = 1) {
  for (let py = Math.floor(y); py < Math.ceil(y + h); py++) {
    for (let px = Math.floor(x); px < Math.ceil(x + w); px++) {
      const cx = px < x + r ? x + r : px > x + w - r ? x + w - r : px;
      const cy = py < y + r ? y + r : py > y + h - r ? y + h - r : py;
      const dx = px - cx;
      const dy = py - cy;
      if (dx * dx + dy * dy <= r * r) blendPixel(data, size, px, py, color, alpha);
    }
  }
}

function strokeCircle(data, size, cx, cy, radius, stroke, color) {
  const min = radius - stroke / 2;
  const max = radius + stroke / 2;
  for (let y = Math.floor(cy - max); y <= Math.ceil(cy + max); y++) {
    for (let x = Math.floor(cx - max); x <= Math.ceil(cx + max); x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d >= min && d <= max) blendPixel(data, size, x, y, color);
    }
  }
}

function strokeLine(data, size, x1, y1, x2, y2, stroke, color) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy || 1;
  const pad = stroke;
  for (let y = Math.floor(Math.min(y1, y2) - pad); y <= Math.ceil(Math.max(y1, y2) + pad); y++) {
    for (let x = Math.floor(Math.min(x1, x2) - pad); x <= Math.ceil(Math.max(x1, x2) + pad); x++) {
      const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lenSq));
      const px = x1 + t * dx;
      const py = y1 + t * dy;
      if (Math.hypot(x - px, y - py) <= stroke / 2) blendPixel(data, size, x, y, color);
    }
  }
}

function downsample(source, highSize, size, scale) {
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sum = [0, 0, 0, 0];
      for (let yy = 0; yy < scale; yy++) {
        for (let xx = 0; xx < scale; xx++) {
          const i = (((y * scale + yy) * highSize) + (x * scale + xx)) * 4;
          sum[0] += source[i];
          sum[1] += source[i + 1];
          sum[2] += source[i + 2];
          sum[3] += source[i + 3];
        }
      }
      const n = scale * scale;
      const o = (y * size + x) * 4;
      out[o] = Math.round(sum[0] / n);
      out[o + 1] = Math.round(sum[1] / n);
      out[o + 2] = Math.round(sum[2] / n);
      out[o + 3] = Math.round(sum[3] / n);
    }
  }
  return out;
}

function renderIcon(size) {
  const scale = 4;
  const high = size * scale;
  const data = Buffer.alloc(high * high * 4);
  const u = high;
  fillRoundedRectGradient(data, high, u * 0.06, u * 0.06, u * 0.88, u * 0.88, u * 0.22, '#1f8a7f', '#0b4f49');
  fillRoundedRect(data, high, u * 0.19, u * 0.19, u * 0.32, u * 0.22, u * 0.055, [255, 255, 255], 0.18);
  strokeCircle(data, high, u * 0.43, u * 0.42, u * 0.18, Math.max(3, u * 0.065), [255, 255, 255]);
  strokeLine(data, high, u * 0.56, u * 0.56, u * 0.72, u * 0.72, Math.max(3, u * 0.075), [255, 255, 255]);
  fillRoundedRect(data, high, u * 0.34, u * 0.35, u * 0.065, u * 0.065, u * 0.014, [255, 255, 255], 0.85);
  fillRoundedRect(data, high, u * 0.45, u * 0.35, u * 0.065, u * 0.065, u * 0.014, [255, 255, 255], 0.78);
  fillRoundedRect(data, high, u * 0.395, u * 0.455, u * 0.065, u * 0.065, u * 0.014, [255, 255, 255], 0.72);
  fillRoundedRect(data, high, u * 0.62, u * 0.24, u * 0.17, u * 0.045, u * 0.02, [255, 255, 255], 0.62);
  fillRoundedRect(data, high, u * 0.66, u * 0.33, u * 0.13, u * 0.045, u * 0.02, [255, 255, 255], 0.48);
  return writePng(size, size, downsample(data, high, size, scale));
}

async function generateExtensionIcons(targetDir) {
  await mkdir(targetDir, { recursive: true });
  await Promise.all([16, 32, 48, 128].map((size) => (
    writeFile(path.join(targetDir, `icon${size}.png`), renderIcon(size))
  )));
}

await rm(outDir, { recursive: true, force: true });

const result = spawnSync(
  npmCmd,
  ['--prefix', 'web', 'run', 'build', '--', '--outDir', '../dist-extension'],
  {
    cwd: root,
    env: { ...process.env, BUILD_TARGET: 'extension' },
    stdio: 'inherit',
  },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

await cp(path.join(root, 'extension'), outDir, { recursive: true });
await generateExtensionIcons(path.join(outDir, 'icons'));

await esbuild.build({
  entryPoints: [path.join(root, 'web/src/extension/quick-search-content.tsx')],
  outfile: path.join(outDir, 'quick-search-content.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome114'],
  jsx: 'automatic',
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  plugins: [
    {
      name: 'raw-css',
      setup(build) {
        build.onResolve({ filter: /\.css\?raw$/ }, (args) => ({
          path: path.resolve(args.resolveDir, args.path.replace(/\?raw$/, '')),
          namespace: 'raw-css',
        }));
        build.onLoad({ filter: /.*/, namespace: 'raw-css' }, async (args) => ({
          contents: await readFile(args.path, 'utf8'),
          loader: 'text',
        }));
      },
    },
  ],
});

console.log(`\n扩展包已生成: ${outDir}`);
