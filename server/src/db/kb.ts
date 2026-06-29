import { db, genId, DEFAULT_KB_NAME, rowToKb } from './client.js';
import type { KnowledgeBase, KbRow } from '../types.js';
import { getKbCategory } from './kb-category.js';

// 取首个知识库 id；无则创建默认库（用于兜底归属）
export async function defaultKbId(): Promise<string> {
  const first = await db.prepare('SELECT id FROM knowledge_bases ORDER BY sort ASC, createdAt ASC LIMIT 1').get() as { id: string } | undefined;
  if (first) return first.id;
  return (await createKb(DEFAULT_KB_NAME)).id;
}

// 解析知识点归属的知识库：优先用 kbId，其次按 cat 名查找/创建，最后落默认库
export async function resolveKbId(kbId?: string, cat?: string): Promise<string> {
  if (kbId) {
    const exists = await db.prepare('SELECT 1 FROM knowledge_bases WHERE id = ?').get(kbId);
    if (exists) return kbId;
  }
  if (cat && cat.trim()) return (await ensureKb(cat.trim())).id;
  return defaultKbId();
}

// ───────────────────────── 知识库 CRUD ─────────────────────────

// 内存缓存：远程 Turso 查询有 100-200ms 延迟
let kbsCache: { data: KnowledgeBase[]; ts: number } | null = null;
const CACHE_TTL = 5000;
let kbsRefresh: Promise<KnowledgeBase[]> | null = null;
let kbsCacheVersion = 0;

async function refreshKbsCache(): Promise<KnowledgeBase[]> {
  const now = Date.now();
  const version = kbsCacheVersion;
  const rows = await db.prepare('SELECT * FROM knowledge_bases ORDER BY sort ASC, createdAt ASC').all() as unknown as KbRow[];
  const data = rows.map(rowToKb);
  if (version === kbsCacheVersion) kbsCache = { data, ts: now };
  return data;
}

export async function listKbs(): Promise<KnowledgeBase[]> {
  const now = Date.now();
  if (kbsCache && now - kbsCache.ts < CACHE_TTL) return kbsCache.data;
  if (kbsCache) {
    scheduleKbsRefresh();
    return kbsCache.data;
  }
  if (!kbsRefresh) kbsRefresh = refreshKbsCache().finally(() => { kbsRefresh = null; });
  return kbsRefresh;
}

function scheduleKbsRefresh(): void {
  if (kbsRefresh) return;
  setTimeout(() => {
    if (kbsRefresh || !kbsCache) return;
    kbsRefresh = refreshKbsCache()
      .catch((err) => {
        console.warn('[db] 后台刷新 kbs 缓存失败:', err);
        return kbsCache?.data ?? [];
      })
      .finally(() => { kbsRefresh = null; });
  }, 0);
}

export function clearKbsCache(): void {
  kbsCacheVersion += 1;
  kbsCache = null;
  kbsRefresh = null;
}

export async function getKb(id: string): Promise<KnowledgeBase | null> {
  const row = await db.prepare('SELECT * FROM knowledge_bases WHERE id = ?').get(id) as unknown as KbRow | undefined;
  return row ? rowToKb(row) : null;
}

async function normalizeCategoryId(categoryId?: string | null): Promise<string | null> {
  if (categoryId == null) return null;
  const trimmed = String(categoryId).trim();
  if (!trimmed) return null;
  return (await getKbCategory(trimmed)) ? trimmed : null;
}

export async function createKb(name: string, categoryId?: string | null): Promise<KnowledgeBase> {
  const now = Date.now();
  const id = genId('kb');
  const maxRow = await db.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM knowledge_bases').get() as { m: number };
  const kb: KnowledgeBase = {
    id,
    name: name.trim() || '未命名知识库',
    categoryId: await normalizeCategoryId(categoryId),
    sort: Number(maxRow.m) + 1,
    createdAt: now,
    updatedAt: now,
  };
  await db.prepare('INSERT INTO knowledge_bases (id, name, categoryId, sort, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, kb.name, kb.categoryId, kb.sort, now, now);
  clearKbsCache();
  return kb;
}

export async function renameKb(id: string, name: string): Promise<KnowledgeBase | null> {
  if (!name.trim()) return null;
  const now = Date.now();
  await db.prepare('UPDATE knowledge_bases SET name = ?, updatedAt = ? WHERE id = ?').run(name.trim(), now, id);
  clearKbsCache();
  return getKb(id);
}

export async function updateKbCategory(id: string, categoryId?: string | null): Promise<KnowledgeBase | null> {
  const now = Date.now();
  const normalizedCategoryId = await normalizeCategoryId(categoryId);
  const row = await db.prepare('UPDATE knowledge_bases SET categoryId = ?, updatedAt = ? WHERE id = ? RETURNING *')
    .get(normalizedCategoryId, now, id) as unknown as KbRow | undefined;
  clearKbsCache();
  return row ? rowToKb(row) : null;
}

export interface DeleteKbResult {
  kbId: string;
  folderIds: string[];
  entryIds: string[];
}

// 删除知识库：级联删除其下所有文件夹与知识点
export async function deleteKb(id: string): Promise<DeleteKbResult | null> {
  const result = await db.tx(async () => {
    const kbRow = await db.prepare('DELETE FROM knowledge_bases WHERE id = ? RETURNING id').get(id) as { id: string } | undefined;
    if (!kbRow) return null;
    const entryRows = await db.prepare('DELETE FROM entries WHERE kbId = ? RETURNING id').all(id) as { id: string }[];
    const folderRows = await db.prepare('DELETE FROM folders WHERE kbId = ? RETURNING id').all(id) as { id: string }[];
    return {
      kbId: kbRow.id,
      folderIds: folderRows.map((row) => row.id),
      entryIds: entryRows.map((row) => row.id),
    };
  });
  clearKbsCache();
  return result;
}

export async function reorderKbs(ids: string[]): Promise<void> {
  const stmt = db.prepare('UPDATE knowledge_bases SET sort = :sort WHERE id = :id');
  await db.tx(async () => {
    for (const [index, id] of ids.entries()) await stmt.run({ id, sort: index });
  });
  clearKbsCache();
}

// 按名查找知识库；不存在则创建（幂等，供 seed / 迁移 / 导入复用）
export async function ensureKb(name: string): Promise<KnowledgeBase> {
  const trimmed = name.trim() || DEFAULT_KB_NAME;
  const row = await db.prepare('SELECT * FROM knowledge_bases WHERE name = ?').get(trimmed) as unknown as KbRow | undefined;
  if (row) return rowToKb(row);
  return createKb(trimmed);
}
