import { db, genId, rowToFolder } from './client.js';
import { getKb } from './kb.js';
import { clearEntriesCache } from './entry.js';
import type { Folder, FolderRow } from '../types.js';

// ───────────────────────── 文件夹 CRUD ─────────────────────────

let foldersCache: { data: Folder[]; ts: number } | null = null;
const CACHE_TTL = 5000;
let foldersRefresh: Promise<Folder[]> | null = null;
let foldersCacheVersion = 0;

async function refreshFoldersCache(): Promise<Folder[]> {
  const now = Date.now();
  const version = foldersCacheVersion;
  const rows = await db.prepare('SELECT * FROM folders ORDER BY sort ASC, createdAt ASC').all() as unknown as FolderRow[];
  const data = rows.map(rowToFolder);
  if (version === foldersCacheVersion) foldersCache = { data, ts: now };
  return data;
}

export async function listFolders(): Promise<Folder[]> {
  const now = Date.now();
  if (foldersCache && now - foldersCache.ts < CACHE_TTL) return foldersCache.data;
  if (foldersCache) {
    scheduleFoldersRefresh();
    return foldersCache.data;
  }
  if (!foldersRefresh) foldersRefresh = refreshFoldersCache().finally(() => { foldersRefresh = null; });
  return foldersRefresh;
}

function scheduleFoldersRefresh(): void {
  if (foldersRefresh) return;
  setTimeout(() => {
    if (foldersRefresh || !foldersCache) return;
    foldersRefresh = refreshFoldersCache()
      .catch((err) => {
        console.warn('[db] 后台刷新 folders 缓存失败:', err);
        return foldersCache?.data ?? [];
      })
      .finally(() => { foldersRefresh = null; });
  }, 0);
}

export function clearFoldersCache(): void {
  foldersCacheVersion += 1;
  foldersCache = null;
  foldersRefresh = null;
}

export async function getFolder(id: string): Promise<Folder | null> {
  const row = await db.prepare('SELECT * FROM folders WHERE id = ?').get(id) as unknown as FolderRow | undefined;
  return row ? rowToFolder(row) : null;
}

export async function createFolder(input: { kbId: string; parentId?: string | null; name: string }): Promise<Folder | null> {
  const kbId = input.kbId;
  if (!await getKb(kbId)) return null;
  const parentId = input.parentId || null;
  if (parentId) {
    const parent = await getFolder(parentId);
    if (!parent || parent.kbId !== kbId) return null; // 父必须存在于同一知识库
  }
  const now = Date.now();
  const id = genId('fd');
  const maxRow = parentId
    ? (await db.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM folders WHERE kbId = ? AND parentId = ?').get(kbId, parentId) as { m: number })
    : (await db.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM folders WHERE kbId = ? AND parentId IS NULL').get(kbId) as { m: number });
  const folder: Folder = { id, kbId, parentId, name: input.name.trim() || '未命名文件夹', sort: Number(maxRow.m) + 1, createdAt: now, updatedAt: now };
  await db.prepare('INSERT INTO folders (id, kbId, parentId, name, sort, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, folder.kbId, folder.parentId, folder.name, folder.sort, now, now);
  clearFoldersCache();
  return folder;
}

export async function renameFolder(id: string, name: string): Promise<Folder | null> {
  if (!name.trim()) return null;
  const now = Date.now();
  await db.prepare('UPDATE folders SET name = ?, updatedAt = ? WHERE id = ?').run(name.trim(), now, id);
  clearFoldersCache();
  return getFolder(id);
}

async function folderSubtreeRows(id: string): Promise<Array<{ id: string; kbId: string }>> {
  return db.prepare(`
    WITH RECURSIVE subtree(id, kbId) AS (
      SELECT id, kbId FROM folders WHERE id = ?
      UNION
      SELECT folders.id, folders.kbId
      FROM folders
      JOIN subtree ON folders.kbId = subtree.kbId AND folders.parentId = subtree.id
    )
    SELECT id, kbId FROM subtree
  `).all(id) as Promise<Array<{ id: string; kbId: string }>>;
}

// 收集某文件夹及其全部后代 id（用于级联删除与移动防环）
async function folderSubtreeIds(id: string): Promise<Set<string>> {
  return new Set((await folderSubtreeRows(id)).map((row) => row.id));
}

// 移动文件夹：改父 / 跨库。parentId 为 null 表示移到目标库根级；禁止移入自身或其后代
export async function moveFolder(id: string, opts: { parentId?: string | null; kbId?: string }): Promise<boolean> {
  const cur = await getFolder(id);
  if (!cur) return false;
  const newKbId = opts.kbId ?? cur.kbId;
  if (!await getKb(newKbId)) return false;
  let newParentId = opts.parentId !== undefined ? opts.parentId : cur.parentId;
  if (newParentId) {
    if ((await folderSubtreeIds(id)).has(newParentId)) return false; // 防环
    const parent = await getFolder(newParentId);
    if (!parent) return false;
    // 跨库移动时，若目标父不属于新库，则降级挂到新库根
    newParentId = parent.kbId === newKbId ? newParentId : null;
  }
  await db.prepare('UPDATE folders SET kbId = ?, parentId = ?, updatedAt = ? WHERE id = ?').run(newKbId, newParentId, Date.now(), id);
  clearFoldersCache();
  return true;
}

export interface DeleteFolderResult {
  folderIds: string[];
  entryIds: string[];
}

// 删除文件夹：级联删除子文件夹与其中知识点
export async function deleteFolder(id: string): Promise<DeleteFolderResult | null> {
  const subtree = await folderSubtreeRows(id);
  if (!subtree.length) return null;
  const ids = subtree.map((row) => row.id);
  const kbId = subtree[0].kbId;
  const placeholders = ids.map(() => '?').join(',');
  const result = await db.tx(async () => {
    const entryRows = await db.prepare(`DELETE FROM entries WHERE kbId = ? AND folderId IN (${placeholders}) RETURNING id`)
      .all(kbId, ...ids) as { id: string }[];
    const folderRows = await db.prepare(`DELETE FROM folders WHERE id IN (${placeholders}) RETURNING id`)
      .all(...ids) as { id: string }[];
    return {
      folderIds: folderRows.map((row) => row.id),
      entryIds: entryRows.map((row) => row.id),
    };
  });
  clearFoldersCache();
  clearEntriesCache();
  return result;
}

export async function reorderFolders(ids: string[]): Promise<void> {
  const stmt = db.prepare('UPDATE folders SET sort = :sort WHERE id = :id');
  await db.tx(async () => {
    for (const [index, id] of ids.entries()) await stmt.run({ id, sort: index });
  });
  clearFoldersCache();
}

// 按名 + 父查找文件夹；不存在则创建（幂等）
export async function ensureFolder(kbId: string, name: string, parentId: string | null = null): Promise<Folder> {
  const row = parentId
    ? (await db.prepare('SELECT * FROM folders WHERE kbId = ? AND parentId = ? AND name = ?').get(kbId, parentId, name) as unknown as FolderRow | undefined)
    : (await db.prepare('SELECT * FROM folders WHERE kbId = ? AND parentId IS NULL AND name = ?').get(kbId, name) as unknown as FolderRow | undefined);
  if (row) return rowToFolder(row);
  return (await createFolder({ kbId, parentId, name }))!;
}
