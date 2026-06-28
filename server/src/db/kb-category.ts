import { db, genId, rowToKbCategory } from './client.js';
import { clearKbsCache } from './kb.js';
import type { KbCategory, KbCategoryRow } from '../types.js';

let kbCategoriesCache: { data: KbCategory[]; ts: number } | null = null;
const CACHE_TTL = 5000;
let kbCategoriesRefresh: Promise<KbCategory[]> | null = null;
let kbCategoriesCacheVersion = 0;

function normalizeParentId(parentId?: string | null): string | null {
  if (parentId == null) return null;
  const trimmed = String(parentId).trim();
  return trimmed || null;
}

async function refreshKbCategoriesCache(): Promise<KbCategory[]> {
  const now = Date.now();
  const version = kbCategoriesCacheVersion;
  const rows = await db.prepare('SELECT * FROM kb_categories ORDER BY sort ASC, createdAt ASC').all() as unknown as KbCategoryRow[];
  const data = rows.map(rowToKbCategory);
  if (version === kbCategoriesCacheVersion) kbCategoriesCache = { data, ts: now };
  return data;
}

export async function listKbCategories(): Promise<KbCategory[]> {
  const now = Date.now();
  if (kbCategoriesCache && now - kbCategoriesCache.ts < CACHE_TTL) return kbCategoriesCache.data;
  if (kbCategoriesCache) {
    scheduleKbCategoriesRefresh();
    return kbCategoriesCache.data;
  }
  if (!kbCategoriesRefresh) kbCategoriesRefresh = refreshKbCategoriesCache().finally(() => { kbCategoriesRefresh = null; });
  return kbCategoriesRefresh;
}

function scheduleKbCategoriesRefresh(): void {
  if (kbCategoriesRefresh) return;
  setTimeout(() => {
    if (kbCategoriesRefresh || !kbCategoriesCache) return;
    kbCategoriesRefresh = refreshKbCategoriesCache()
      .catch((err) => {
        console.warn('[db] 后台刷新 kb categories 缓存失败:', err);
        return kbCategoriesCache?.data ?? [];
      })
      .finally(() => { kbCategoriesRefresh = null; });
  }, 0);
}

export function clearKbCategoriesCache(): void {
  kbCategoriesCacheVersion += 1;
  kbCategoriesCache = null;
  kbCategoriesRefresh = null;
}

export async function getKbCategory(id: string): Promise<KbCategory | null> {
  const row = await db.prepare('SELECT * FROM kb_categories WHERE id = ?').get(id) as unknown as KbCategoryRow | undefined;
  return row ? rowToKbCategory(row) : null;
}

export async function createKbCategory(name: string, parentId?: string | null): Promise<KbCategory | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const normalizedParentId = normalizeParentId(parentId);

  const now = Date.now();
  const id = genId('kbc');
  const row = normalizedParentId
    ? await db.prepare(`
      INSERT INTO kb_categories (id, parentId, name, sort, createdAt, updatedAt)
      SELECT ?, ?, ?, COALESCE((SELECT MAX(sort) FROM kb_categories WHERE parentId = ?), 0) + 1, ?, ?
      WHERE EXISTS (SELECT 1 FROM kb_categories WHERE id = ?)
      RETURNING *
    `).get(id, normalizedParentId, trimmed, normalizedParentId, now, now, normalizedParentId) as unknown as KbCategoryRow | undefined
    : await db.prepare(`
      INSERT INTO kb_categories (id, parentId, name, sort, createdAt, updatedAt)
      SELECT ?, NULL, ?, COALESCE((SELECT MAX(sort) FROM kb_categories WHERE parentId IS NULL), 0) + 1, ?, ?
      RETURNING *
    `).get(id, trimmed, now, now) as unknown as KbCategoryRow | undefined;
  clearKbCategoriesCache();
  return row ? rowToKbCategory(row) : null;
}

export async function renameKbCategory(id: string, name: string): Promise<KbCategory | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const now = Date.now();
  const row = await db.prepare('UPDATE kb_categories SET name = ?, updatedAt = ? WHERE id = ? RETURNING *')
    .get(trimmed, now, id) as unknown as KbCategoryRow | undefined;
  clearKbCategoriesCache();
  return row ? rowToKbCategory(row) : null;
}

export async function deleteKbCategory(id: string): Promise<boolean> {
  const category = await getKbCategory(id);
  if (!category) return false;
  const now = Date.now();
  const result = await db.tx(async () => {
    await db.prepare('UPDATE kb_categories SET parentId = ?, updatedAt = ? WHERE parentId = ?')
      .run(category.parentId, now, id);
    await db.prepare('UPDATE knowledge_bases SET categoryId = ?, updatedAt = ? WHERE categoryId = ?')
      .run(category.parentId, now, id);
    const info = await db.prepare('DELETE FROM kb_categories WHERE id = ?').run(id);
    return Number(info.changes) > 0;
  });
  clearKbCategoriesCache();
  clearKbsCache();
  return result;
}
