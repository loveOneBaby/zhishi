import { db, genId, rowToFolder } from './client.js';
import { getKb } from './kb.js';
import type { Folder, FolderRow } from '../types.js';

// ───────────────────────── 文件夹 CRUD ─────────────────────────

export function listFolders(): Folder[] {
  const rows = db.prepare('SELECT * FROM folders ORDER BY sort ASC, createdAt ASC').all() as unknown as FolderRow[];
  return rows.map(rowToFolder);
}

export function getFolder(id: string): Folder | null {
  const row = db.prepare('SELECT * FROM folders WHERE id = ?').get(id) as unknown as FolderRow | undefined;
  return row ? rowToFolder(row) : null;
}

export function createFolder(input: { kbId: string; parentId?: string | null; name: string }): Folder | null {
  const kbId = input.kbId;
  if (!getKb(kbId)) return null;
  const parentId = input.parentId || null;
  if (parentId) {
    const parent = getFolder(parentId);
    if (!parent || parent.kbId !== kbId) return null; // 父必须存在于同一知识库
  }
  const now = Date.now();
  const id = genId('fd');
  const maxRow = parentId
    ? (db.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM folders WHERE kbId = ? AND parentId = ?').get(kbId, parentId) as { m: number })
    : (db.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM folders WHERE kbId = ? AND parentId IS NULL').get(kbId) as { m: number });
  const folder: Folder = { id, kbId, parentId, name: input.name.trim() || '未命名文件夹', sort: Number(maxRow.m) + 1, createdAt: now, updatedAt: now };
  db.prepare('INSERT INTO folders (id, kbId, parentId, name, sort, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, folder.kbId, folder.parentId, folder.name, folder.sort, now, now);
  return folder;
}

export function renameFolder(id: string, name: string): Folder | null {
  if (!name.trim()) return null;
  const now = Date.now();
  db.prepare('UPDATE folders SET name = ?, updatedAt = ? WHERE id = ?').run(name.trim(), now, id);
  return getFolder(id);
}

// 收集某文件夹及其全部后代 id（用于级联删除与移动防环）
function folderSubtreeIds(id: string): Set<string> {
  const result = new Set<string>([id]);
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    const children = db.prepare('SELECT id FROM folders WHERE parentId = ?').all(cur) as { id: string }[];
    for (const c of children) {
      if (!result.has(c.id)) { result.add(c.id); stack.push(c.id); }
    }
  }
  return result;
}

// 移动文件夹：改父 / 跨库。parentId 为 null 表示移到目标库根级；禁止移入自身或其后代
export function moveFolder(id: string, opts: { parentId?: string | null; kbId?: string }): boolean {
  const cur = getFolder(id);
  if (!cur) return false;
  const newKbId = opts.kbId ?? cur.kbId;
  if (!getKb(newKbId)) return false;
  let newParentId = opts.parentId !== undefined ? opts.parentId : cur.parentId;
  if (newParentId) {
    if (folderSubtreeIds(id).has(newParentId)) return false; // 防环
    const parent = getFolder(newParentId);
    if (!parent) return false;
    // 跨库移动时，若目标父不属于新库，则降级挂到新库根
    newParentId = parent.kbId === newKbId ? newParentId : null;
  }
  db.prepare('UPDATE folders SET kbId = ?, parentId = ?, updatedAt = ? WHERE id = ?').run(newKbId, newParentId, Date.now(), id);
  return true;
}

// 删除文件夹：级联删除子文件夹与其中知识点
export function deleteFolder(id: string): boolean {
  const ids = [...folderSubtreeIds(id)];
  if (!ids.length) return false;
  const placeholders = ids.map(() => '?').join(',');
  db.exec('BEGIN');
  try {
    db.prepare(`DELETE FROM entries WHERE folderId IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM folders WHERE id IN (${placeholders})`).run(...ids);
    db.exec('COMMIT');
    return true;
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

export function reorderFolders(ids: string[]): void {
  const stmt = db.prepare('UPDATE folders SET sort = :sort WHERE id = :id');
  db.exec('BEGIN');
  try {
    ids.forEach((id, index) => stmt.run({ id, sort: index }));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// 按名 + 父查找文件夹；不存在则创建（幂等）
export function ensureFolder(kbId: string, name: string, parentId: string | null = null): Folder {
  const row = parentId
    ? (db.prepare('SELECT * FROM folders WHERE kbId = ? AND parentId = ? AND name = ?').get(kbId, parentId, name) as unknown as FolderRow | undefined)
    : (db.prepare('SELECT * FROM folders WHERE kbId = ? AND parentId IS NULL AND name = ?').get(kbId, name) as unknown as FolderRow | undefined);
  if (row) return rowToFolder(row);
  return createFolder({ kbId, parentId, name })!;
}
