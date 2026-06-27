import { createHash } from 'node:crypto';

// 资源(图片等)的纯函数:dataURL 解析、内容哈希(去重)、图片尺寸嗅探。无 DB 依赖,便于单测。

export interface ParsedDataUrl {
  mime: string;
  bytes: Buffer;
}

// 解析 `data:image/png;base64,xxxx`
export function parseDataUrl(input: string): ParsedDataUrl | null {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(input || '');
  if (!m) return null;
  const mime = (m[1] || 'application/octet-stream').toLowerCase();
  const isBase64 = Boolean(m[2]);
  const payload = m[3] ?? '';
  try {
    const bytes = isBase64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf8');
    if (!bytes.length) return null;
    return { mime, bytes };
  } catch {
    return null;
  }
}

export function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function extOfMime(mime: string): string {
  const map: Record<string, string> = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif',
    'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/avif': 'avif',
  };
  return map[mime.toLowerCase()] ?? 'bin';
}

// 从二进制嗅探图片尺寸(PNG / JPEG / GIF),识别不出返回 null
export function sniffImageSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    // PNG: IHDR 宽高在 16..24
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length >= 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    // GIF: 逻辑屏幕宽高(小端)在 6..10
    return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    // JPEG: 扫描 SOF 段
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      // SOF0..SOF15(除 DHT/DAC/RST/SOI/EOI)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = bytes.readUInt16BE(offset + 5);
        const width = bytes.readUInt16BE(offset + 7);
        return { width, height };
      }
      const segLen = bytes.readUInt16BE(offset + 2);
      if (segLen < 2) break;
      offset += 2 + segLen;
    }
  }
  return null;
}

export interface NormalizedImageRef {
  kind: 'external' | 'data';
  url?: string;       // external 直接用
  dataUrl?: string;   // data: 待落库为资源
}

// 把 markdown / 块里的图片地址归一:远程/站内 → external;data: → 待落库
export function classifyImageSrc(src: string): NormalizedImageRef | null {
  const s = (src || '').trim();
  if (!s) return null;
  if (/^data:/i.test(s)) return { kind: 'data', dataUrl: s };
  if (/^(https?:\/\/|\/)/i.test(s)) return { kind: 'external', url: s };
  return null; // 本地磁盘路径等不支持
}

// 资源仅允许图片 MIME。text/html 等会被 /raw 原样回吐 → 同源存储型 XSS,故拒绝。
// 不含 image/svg+xml:SVG 可内嵌脚本,直接访问 /raw 会执行脚本,风险过高。
const ALLOWED_IMAGE_MIMES = new Set([
  'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/avif',
]);
export function isAllowedImageMime(mime: string): boolean {
  return ALLOWED_IMAGE_MIMES.has(mime.toLowerCase());
}

// 外链资源仅允许 http/https 绝对地址或站内 / 相对路径;
// 拒绝 javascript: / data: / 协议相对 //evil.com(后者经 res.redirect 会开放重定向)。
export function isSafeExternalUrl(url: string): boolean {
  const s = (url || '').trim();
  if (!s) return false;
  // 站内相对路径(单个 / 开头)安全;协议相对 //evil.com 会经 redirect 跳外站,必须拒绝
  if (s.startsWith('/') && !s.startsWith('//')) return true;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
