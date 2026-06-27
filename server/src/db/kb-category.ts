import { db, genId, rowToKbCategory } from './client.js';
import type { KbCategory, KbCategoryRow } from '../types.js';

function normalizeParentId(parentId?: string | null): string | null {
  if (parentId == null) return null;
  const trimmed = String(parentId).trim();
  return trimmed || null;
}

export function listKbCategories(): KbCategory[] {
  const rows = db.prepare('SELECT * FROM kb_categories ORDER BY sort ASC, createdAt ASC').all() as unknown as KbCategoryRow[];
  return rows.map(rowToKbCategory);
}

export function getKbCategory(id: string): KbCategory | null {
  const row = db.prepare('SELECT * FROM kb_categories WHERE id = ?').get(id) as unknown as KbCategoryRow | undefined;
  return row ? rowToKbCategory(row) : null;
}

export function createKbCategory(name: string, parentId?: string | null): KbCategory | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const normalizedParentId = normalizeParentId(parentId);
  if (normalizedParentId && !getKbCategory(normalizedParentId)) return null;

  const now = Date.now();
  const id = genId('kbc');
  const maxRow = normalizedParentId
    ? db.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM kb_categories WHERE parentId = ?').get(normalizedParentId) as { m: number }
    : db.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM kb_categories WHERE parentId IS NULL').get() as { m: number };
  db.prepare('INSERT INTO kb_categories (id, parentId, name, sort, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, normalizedParentId, trimmed, Number(maxRow.m) + 1, now, now);
  return getKbCategory(id);
}

export function renameKbCategory(id: string, name: string): KbCategory | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const now = Date.now();
  db.prepare('UPDATE kb_categories SET name = ?, updatedAt = ? WHERE id = ?').run(trimmed, now, id);
  return getKbCategory(id);
}

export function deleteKbCategory(id: string): boolean {
  const category = getKbCategory(id);
  if (!category) return false;
  const now = Date.now();
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE kb_categories SET parentId = ?, updatedAt = ? WHERE parentId = ?')
      .run(category.parentId, now, id);
    db.prepare('UPDATE knowledge_bases SET categoryId = ?, updatedAt = ? WHERE categoryId = ?')
      .run(category.parentId, now, id);
    const info = db.prepare('DELETE FROM kb_categories WHERE id = ?').run(id);
    db.exec('COMMIT');
    return Number(info.changes) > 0;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
