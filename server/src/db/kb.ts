import { db, genId, DEFAULT_KB_NAME, rowToKb } from './client.js';
import type { KnowledgeBase, KbRow } from '../types.js';
import { getKbCategory } from './kb-category.js';

// 取首个知识库 id；无则创建默认库（用于兜底归属）
export function defaultKbId(): string {
  const first = db.prepare('SELECT id FROM knowledge_bases ORDER BY sort ASC, createdAt ASC LIMIT 1').get() as { id: string } | undefined;
  if (first) return first.id;
  return createKb(DEFAULT_KB_NAME).id;
}

// 解析知识点归属的知识库：优先用 kbId，其次按 cat 名查找/创建，最后落默认库
export function resolveKbId(kbId?: string, cat?: string): string {
  if (kbId) {
    const exists = db.prepare('SELECT 1 FROM knowledge_bases WHERE id = ?').get(kbId);
    if (exists) return kbId;
  }
  if (cat && cat.trim()) return ensureKb(cat.trim()).id;
  return defaultKbId();
}

// ───────────────────────── 知识库 CRUD ─────────────────────────

export function listKbs(): KnowledgeBase[] {
  const rows = db.prepare('SELECT * FROM knowledge_bases ORDER BY sort ASC, createdAt ASC').all() as unknown as KbRow[];
  return rows.map(rowToKb);
}

export function getKb(id: string): KnowledgeBase | null {
  const row = db.prepare('SELECT * FROM knowledge_bases WHERE id = ?').get(id) as unknown as KbRow | undefined;
  return row ? rowToKb(row) : null;
}

function normalizeCategoryId(categoryId?: string | null): string | null {
  if (categoryId == null) return null;
  const trimmed = String(categoryId).trim();
  if (!trimmed) return null;
  return getKbCategory(trimmed) ? trimmed : null;
}

export function createKb(name: string, categoryId?: string | null): KnowledgeBase {
  const now = Date.now();
  const id = genId('kb');
  const maxRow = db.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM knowledge_bases').get() as { m: number };
  const kb: KnowledgeBase = {
    id,
    name: name.trim() || '未命名知识库',
    categoryId: normalizeCategoryId(categoryId),
    sort: Number(maxRow.m) + 1,
    createdAt: now,
    updatedAt: now,
  };
  db.prepare('INSERT INTO knowledge_bases (id, name, categoryId, sort, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, kb.name, kb.categoryId, kb.sort, now, now);
  return kb;
}

export function renameKb(id: string, name: string): KnowledgeBase | null {
  if (!name.trim()) return null;
  const now = Date.now();
  db.prepare('UPDATE knowledge_bases SET name = ?, updatedAt = ? WHERE id = ?').run(name.trim(), now, id);
  return getKb(id);
}

export function updateKbCategory(id: string, categoryId?: string | null): KnowledgeBase | null {
  if (!getKb(id)) return null;
  const now = Date.now();
  db.prepare('UPDATE knowledge_bases SET categoryId = ?, updatedAt = ? WHERE id = ?')
    .run(normalizeCategoryId(categoryId), now, id);
  return getKb(id);
}

// 删除知识库：级联删除其下所有文件夹与知识点
export function deleteKb(id: string): boolean {
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM entries WHERE kbId = ?').run(id);
    db.prepare('DELETE FROM folders WHERE kbId = ?').run(id);
    const info = db.prepare('DELETE FROM knowledge_bases WHERE id = ?').run(id);
    db.exec('COMMIT');
    return Number(info.changes) > 0;
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

export function reorderKbs(ids: string[]): void {
  const stmt = db.prepare('UPDATE knowledge_bases SET sort = :sort WHERE id = :id');
  db.exec('BEGIN');
  try {
    ids.forEach((id, index) => stmt.run({ id, sort: index }));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// 按名查找知识库；不存在则创建（幂等，供 seed / 迁移 / 导入复用）
export function ensureKb(name: string): KnowledgeBase {
  const trimmed = name.trim() || DEFAULT_KB_NAME;
  const row = db.prepare('SELECT * FROM knowledge_bases WHERE name = ?').get(trimmed) as unknown as KbRow | undefined;
  if (row) return rowToKb(row);
  return createKb(trimmed);
}
