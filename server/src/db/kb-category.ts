import { db, genId, rowToKbCategory } from './client.js';
import type { KbCategory, KbCategoryRow } from '../types.js';

function normalizeParentId(parentId?: string | null): string | null {
  if (parentId == null) return null;
  const trimmed = String(parentId).trim();
  return trimmed || null;
}

export async function listKbCategories(): Promise<KbCategory[]> {
  const rows = await db.prepare('SELECT * FROM kb_categories ORDER BY sort ASC, createdAt ASC').all() as unknown as KbCategoryRow[];
  return rows.map(rowToKbCategory);
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
  return row ? rowToKbCategory(row) : null;
}

export async function renameKbCategory(id: string, name: string): Promise<KbCategory | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const now = Date.now();
  const row = await db.prepare('UPDATE kb_categories SET name = ?, updatedAt = ? WHERE id = ? RETURNING *')
    .get(trimmed, now, id) as unknown as KbCategoryRow | undefined;
  return row ? rowToKbCategory(row) : null;
}

export async function deleteKbCategory(id: string): Promise<boolean> {
  const category = await getKbCategory(id);
  if (!category) return false;
  const now = Date.now();
  return db.tx(async () => {
    await db.prepare('UPDATE kb_categories SET parentId = ?, updatedAt = ? WHERE parentId = ?')
      .run(category.parentId, now, id);
    await db.prepare('UPDATE knowledge_bases SET categoryId = ?, updatedAt = ? WHERE categoryId = ?')
      .run(category.parentId, now, id);
    const info = await db.prepare('DELETE FROM kb_categories WHERE id = ?').run(id);
    return Number(info.changes) > 0;
  });
}
