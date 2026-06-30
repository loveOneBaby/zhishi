const fs = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { deflateSync } = require('node:zlib');

const root = path.resolve(__dirname, '..');
const assetsDir = path.join(root, 'assets');
const iconsetDir = path.join(assetsDir, 'icon.iconset');

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
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
  for (let y = 0; y < height; y += 1) {
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

function mix(a, b, t) {
  return [
    Math.round(a[0] * (1 - t) + b[0] * t),
    Math.round(a[1] * (1 - t) + b[1] * t),
    Math.round(a[2] * (1 - t) + b[2] * t),
  ];
}

function blendPixel(data, width, x, y, color, alpha = 1) {
  if (x < 0 || y < 0 || x >= width || y >= width) return;
  const i = (y * width + x) * 4;
  const sourceAlpha = Math.max(0, Math.min(1, alpha)) * (color[3] == null ? 1 : color[3] / 255);
  const inv = 1 - sourceAlpha;
  data[i] = Math.round(color[0] * sourceAlpha + data[i] * inv);
  data[i + 1] = Math.round(color[1] * sourceAlpha + data[i + 1] * inv);
  data[i + 2] = Math.round(color[2] * sourceAlpha + data[i + 2] * inv);
  data[i + 3] = Math.round(255 * sourceAlpha + data[i + 3] * inv);
}

function roundedRectContains(px, py, x, y, w, h, r) {
  const cx = px < x + r ? x + r : px > x + w - r ? x + w - r : px;
  const cy = py < y + r ? y + r : py > y + h - r ? y + h - r : py;
  return (px - cx) * (px - cx) + (py - cy) * (py - cy) <= r * r;
}

function fillRoundedRect(data, size, x, y, w, h, r, color, alpha = 1) {
  for (let py = Math.floor(y); py < Math.ceil(y + h); py += 1) {
    for (let px = Math.floor(x); px < Math.ceil(x + w); px += 1) {
      if (roundedRectContains(px, py, x, y, w, h, r)) blendPixel(data, size, px, py, color, alpha);
    }
  }
}

function fillRoundedRectGradient(data, size, x, y, w, h, r, stops) {
  for (let py = Math.floor(y); py < Math.ceil(y + h); py += 1) {
    for (let px = Math.floor(x); px < Math.ceil(x + w); px += 1) {
      if (!roundedRectContains(px, py, x, y, w, h, r)) continue;
      const tx = Math.max(0, Math.min(1, (px - x) / w));
      const ty = Math.max(0, Math.min(1, (py - y) / h));
      const top = mix(stops.topLeft, stops.topRight, tx);
      const bottom = mix(stops.bottomLeft, stops.bottomRight, tx);
      blendPixel(data, size, px, py, mix(top, bottom, ty));
    }
  }
}

function strokeRoundedRect(data, size, x, y, w, h, r, stroke, color, alpha = 1) {
  const inset = stroke;
  for (let py = Math.floor(y); py < Math.ceil(y + h); py += 1) {
    for (let px = Math.floor(x); px < Math.ceil(x + w); px += 1) {
      const outer = roundedRectContains(px, py, x, y, w, h, r);
      const inner = roundedRectContains(
        px,
        py,
        x + inset,
        y + inset,
        w - inset * 2,
        h - inset * 2,
        Math.max(0, r - inset),
      );
      if (outer && !inner) blendPixel(data, size, px, py, color, alpha);
    }
  }
}

function fillCircle(data, size, cx, cy, radius, color, alpha = 1) {
  const r2 = radius * radius;
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y += 1) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x += 1) {
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r2) blendPixel(data, size, x, y, color, alpha);
    }
  }
}

function strokeCircle(data, size, cx, cy, radius, stroke, color, alpha = 1) {
  const min = radius - stroke / 2;
  const max = radius + stroke / 2;
  for (let y = Math.floor(cy - max); y <= Math.ceil(cy + max); y += 1) {
    for (let x = Math.floor(cx - max); x <= Math.ceil(cx + max); x += 1) {
      const d = Math.hypot(x - cx, y - cy);
      if (d >= min && d <= max) blendPixel(data, size, x, y, color, alpha);
    }
  }
}

function strokeLine(data, size, x1, y1, x2, y2, stroke, color, alpha = 1) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy || 1;
  const pad = stroke;
  for (let y = Math.floor(Math.min(y1, y2) - pad); y <= Math.ceil(Math.max(y1, y2) + pad); y += 1) {
    for (let x = Math.floor(Math.min(x1, x2) - pad); x <= Math.ceil(Math.max(x1, x2) + pad); x += 1) {
      const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lenSq));
      const px = x1 + t * dx;
      const py = y1 + t * dy;
      if (Math.hypot(x - px, y - py) <= stroke / 2) blendPixel(data, size, x, y, color, alpha);
    }
  }
  fillCircle(data, size, x1, y1, stroke / 2, color, alpha);
  fillCircle(data, size, x2, y2, stroke / 2, color, alpha);
}

function downsample(source, highSize, size, scale) {
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sum = [0, 0, 0, 0];
      for (let yy = 0; yy < scale; yy += 1) {
        for (let xx = 0; xx < scale; xx += 1) {
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
  const bg = {
    topLeft: hexToRgb('#2dd4bf'),
    topRight: hexToRgb('#0f8f7f'),
    bottomLeft: hexToRgb('#0f766e'),
    bottomRight: hexToRgb('#063f3a'),
  };

  fillRoundedRect(data, high, u * 0.078, u * 0.094, u * 0.844, u * 0.84, u * 0.205, [0, 34, 30], 0.18);
  fillRoundedRectGradient(data, high, u * 0.07, u * 0.06, u * 0.86, u * 0.86, u * 0.205, bg);
  strokeRoundedRect(data, high, u * 0.07, u * 0.06, u * 0.86, u * 0.86, u * 0.205, u * 0.018, [255, 255, 255], 0.24);

  fillRoundedRect(data, high, u * 0.16, u * 0.14, u * 0.68, u * 0.24, u * 0.12, [255, 255, 255], 0.12);
  fillRoundedRect(data, high, u * 0.63, u * 0.22, u * 0.18, u * 0.045, u * 0.022, [255, 255, 255], 0.65);
  fillRoundedRect(data, high, u * 0.68, u * 0.31, u * 0.13, u * 0.045, u * 0.022, [255, 255, 255], 0.42);
  fillRoundedRect(data, high, u * 0.59, u * 0.40, u * 0.22, u * 0.045, u * 0.022, [255, 255, 255], 0.35);

  strokeLine(data, high, u * 0.57, u * 0.57, u * 0.73, u * 0.73, u * 0.08, [246, 255, 252], 0.96);
  strokeCircle(data, high, u * 0.43, u * 0.42, u * 0.17, u * 0.072, [246, 255, 252], 0.98);
  strokeCircle(data, high, u * 0.43, u * 0.42, u * 0.105, u * 0.018, [12, 86, 78], 0.22);

  fillCircle(data, high, u * 0.35, u * 0.37, u * 0.034, [255, 255, 255], 0.9);
  fillCircle(data, high, u * 0.47, u * 0.37, u * 0.034, [255, 255, 255], 0.82);
  fillCircle(data, high, u * 0.41, u * 0.49, u * 0.034, [255, 255, 255], 0.72);
  strokeLine(data, high, u * 0.37, u * 0.39, u * 0.45, u * 0.39, u * 0.018, [255, 255, 255], 0.52);
  strokeLine(data, high, u * 0.40, u * 0.47, u * 0.46, u * 0.40, u * 0.018, [255, 255, 255], 0.42);

  fillCircle(data, high, u * 0.73, u * 0.25, u * 0.035, [255, 216, 117], 0.95);
  fillCircle(data, high, u * 0.77, u * 0.29, u * 0.016, [255, 255, 255], 0.78);

  return writePng(size, size, downsample(data, high, size, scale));
}

async function writeIconset() {
  await fs.rm(iconsetDir, { recursive: true, force: true });
  await fs.mkdir(iconsetDir, { recursive: true });

  const files = [
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

  await Promise.all(files.map(([name, size]) => fs.writeFile(path.join(iconsetDir, name), renderIcon(size))));
  await fs.writeFile(path.join(assetsDir, 'icon.png'), renderIcon(1024));

  const iconutil = spawnSync('iconutil', ['-c', 'icns', iconsetDir, '-o', path.join(assetsDir, 'icon.icns')], {
    stdio: 'inherit',
  });
  if (iconutil.status !== 0) throw new Error(`iconutil failed with status ${iconutil.status}`);
}

writeIconset().catch((error) => {
  console.error(error);
  process.exit(1);
});
