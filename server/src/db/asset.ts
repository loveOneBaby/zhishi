import { db } from './client.js';
import { parseDataUrl, sha256, sniffImageSize, classifyImageSrc, isAllowedImageMime } from '../assets.js';

const ASSET_CHUNK_BYTES = 256 * 1024;
const ASSET_BYTES_CACHE_LIMIT = 64 * 1024 * 1024;
const assetBytesCache = new Map<string, { mime: string; bytes: Buffer }>();
const assetReads = new Map<string, Promise<{ mime: string; bytes: Buffer } | null>>();
let assetBytesCacheSize = 0;

export interface AssetMeta {
  id: string;
  kind: 'data' | 'external';
  mime: string;
  url: string;            // 统一对外可用地址(data → /api/assets/:id/raw；external → 原 url)
  width: number | null;
  height: number | null;
  alt: string;
  size: number;
  createdAt: number;
}

function assetRowToMeta(r: Record<string, unknown>): AssetMeta {
  const kind = r.kind === 'external' ? 'external' : 'data';
  return {
    id: String(r.id),
    kind,
    mime: String(r.mime ?? ''),
    url: kind === 'external' ? String(r.url ?? '') : `/api/assets/${String(r.id)}/raw`,
    width: r.width == null ? null : Number(r.width),
    height: r.height == null ? null : Number(r.height),
    alt: String(r.alt ?? ''),
    size: Number(r.size ?? 0),
    createdAt: Number(r.createdAt ?? 0),
  };
}

// 落库一张 data:base64 图片(按内容哈希去重),返回元信息(含站内 url)
export async function createDataAsset(dataUrl: string, alt = ''): Promise<AssetMeta | null> {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return null;
  // 仅允许图片:防止 data:text/html 等经 /raw 原样回吐造成同源存储型 XSS
  if (!isAllowedImageMime(parsed.mime)) return null;
  const hash = sha256(parsed.bytes);
  const existing = await db.prepare('SELECT * FROM assets WHERE hash = ? AND kind = \'data\' LIMIT 1').get(hash) as Record<string, unknown> | undefined;
  if (existing) return assetRowToMeta(existing);
  const size = sniffImageSize(parsed.bytes);
  const id = 'as_' + hash.slice(0, 16);
  await db.prepare(
    `INSERT OR IGNORE INTO assets (id, kind, mime, hash, data, url, width, height, alt, size, createdAt)
     VALUES (:id, 'data', :mime, :hash, :data, NULL, :width, :height, :alt, :size, :createdAt)`
  ).run({
    id, mime: parsed.mime, hash, data: parsed.bytes,
    width: size?.width ?? null, height: size?.height ?? null,
    alt, size: parsed.bytes.length, createdAt: Date.now(),
  });
  const row = await db.prepare('SELECT * FROM assets WHERE id = ?').get(id) as Record<string, unknown>;
  return assetRowToMeta(row);
}

// 登记一个外链图片(不下载,仅存引用)
export async function registerExternalAsset(url: string, alt = ''): Promise<AssetMeta> {
  const id = 'ax_' + sha256(Buffer.from(url)).slice(0, 16);
  await db.prepare(
    `INSERT OR IGNORE INTO assets (id, kind, mime, hash, data, url, width, height, alt, size, createdAt)
     VALUES (:id, 'external', '', NULL, NULL, :url, NULL, NULL, :alt, 0, :createdAt)`
  ).run({ id, url, alt, createdAt: Date.now() });
  const row = await db.prepare('SELECT * FROM assets WHERE id = ?').get(id) as Record<string, unknown>;
  return assetRowToMeta(row);
}

// 统一入口:把任意图片地址(data: / 外链)收敛成站内可用的稳定 url
export async function ingestImageSrc(src: string, alt = ''): Promise<AssetMeta | null> {
  const ref = classifyImageSrc(src);
  if (!ref) return null;
  if (ref.kind === 'data' && ref.dataUrl) return createDataAsset(ref.dataUrl, alt);
  if (ref.kind === 'external' && ref.url) return registerExternalAsset(ref.url, alt);
  return null;
}

export async function getAsset(id: string): Promise<AssetMeta | null> {
  const row = await db.prepare(`
    SELECT id, kind, mime, url, width, height, alt, size, createdAt
    FROM assets
    WHERE id = ?
  `).get(id) as Record<string, unknown> | undefined;
  return row ? assetRowToMeta(row) : null;
}

export async function getAssetBytes(id: string): Promise<{ mime: string; bytes: Buffer } | null> {
  const cached = assetBytesCache.get(id);
  if (cached) {
    assetBytesCache.delete(id);
    assetBytesCache.set(id, cached);
    return cached;
  }
  const active = assetReads.get(id);
  if (active) return active;
  const read = loadAssetBytes(id).then((asset) => {
    if (asset) rememberAssetBytes(id, asset);
    return asset;
  }).finally(() => assetReads.delete(id));
  assetReads.set(id, read);
  return read;
}

async function loadAssetBytes(id: string): Promise<{ mime: string; bytes: Buffer } | null> {
  const meta = await db.prepare(`
    SELECT mime, length(data) AS size
    FROM assets
    WHERE id = ? AND kind = 'data'
  `).get(id) as { mime: string; size: number } | undefined;
  if (!meta || !Number(meta.size)) return null;

  // libSQL HTTP 对单个大 BLOB 响应非常慢；分块读取可避免远程响应超时。
  const chunks = await Promise.all(assetChunkRanges(Number(meta.size)).map(async ({ offset, length }) => {
    const row = await db.prepare(`
      SELECT substr(data, ?, ?) AS data
      FROM assets
      WHERE id = ? AND kind = 'data'
    `).get(offset, length, id) as { data: ArrayBuffer | Buffer | null } | undefined;
    return row?.data ? Buffer.from(row.data as ArrayBuffer) : Buffer.alloc(0);
  }));
  const bytes = Buffer.concat(chunks);
  if (bytes.length !== Number(meta.size)) throw new Error(`资源读取不完整: ${bytes.length}/${meta.size}`);
  return { mime: meta.mime, bytes };
}

function rememberAssetBytes(id: string, asset: { mime: string; bytes: Buffer }): void {
  if (asset.bytes.length > ASSET_BYTES_CACHE_LIMIT) return;
  const previous = assetBytesCache.get(id);
  if (previous) assetBytesCacheSize -= previous.bytes.length;
  assetBytesCache.delete(id);
  assetBytesCache.set(id, asset);
  assetBytesCacheSize += asset.bytes.length;
  while (assetBytesCacheSize > ASSET_BYTES_CACHE_LIMIT) {
    const oldest = assetBytesCache.entries().next().value as [string, { mime: string; bytes: Buffer }] | undefined;
    if (!oldest) break;
    assetBytesCache.delete(oldest[0]);
    assetBytesCacheSize -= oldest[1].bytes.length;
  }
}

export function assetChunkRanges(size: number, chunkSize = ASSET_CHUNK_BYTES): Array<{ offset: number; length: number }> {
  if (!Number.isFinite(size) || size <= 0 || !Number.isFinite(chunkSize) || chunkSize <= 0) return [];
  const ranges: Array<{ offset: number; length: number }> = [];
  for (let offset = 1; offset <= size; offset += chunkSize) {
    ranges.push({ offset, length: Math.min(chunkSize, size - offset + 1) });
  }
  return ranges;
}
