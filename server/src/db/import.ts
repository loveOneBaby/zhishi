import { db, deriveDoc, kbNameOf } from './client.js';
import { listKbs, resolveKbId, defaultKbId, ensureKb, updateKbCategory } from './kb.js';
import { listKbCategories } from './kb-category.js';
import { listFolders, getFolder, ensureFolder } from './folder.js';
import { listEntries, deriveSummary } from './entry.js';
import { buildDocIdx } from './doc-write.js';
import { splitDocToIndex } from '../doc.js';
import type { KnowledgeBase, KbCategory, Folder, Entry, IndexNode } from '../types.js';
import type { Block } from '../blocks.js';

// ───────────────────────── 导入 / 导出 ─────────────────────────

export interface ImportEntry {
  id?: string;
  cat?: string;
  kbId?: string;
  folderId?: string | null;
  title?: string;
  py?: string;
  tags?: string[];
  summary?: string;
  intro?: string;
  nodes?: IndexNode[];
  body?: string;
  doc?: Block[];         // BlockNote 块文档(canonical;优先于 intro/nodes/body)
}

export interface ImportKbCategory { id?: string; parentId?: string | null; name: string; sort?: number; }
export interface ImportKb { id?: string; name: string; categoryId?: string | null; sort?: number; }
export interface ImportFolder { id?: string; kbId?: string; parentId?: string | null; name: string; sort?: number; }
export interface ImportPayload {
  kbCategories?: ImportKbCategory[];
  kbs?: ImportKb[];
  folders?: ImportFolder[];
  entries: ImportEntry[];
  targetKbId?: string;
  targetKbName?: string;
  targetFolderId?: string | null;
  importBatchId?: string;
}

// 导出全量（备份）
export interface ExportPayload {
  version: string;
  exportedAt: number;
  kbCategories: KbCategory[];
  kbs: KnowledgeBase[];
  folders: Folder[];
  entries: Entry[];
}

export function exportData(): ExportPayload {
  return {
    version: 'kb-export-2',
    exportedAt: Date.now(),
    kbCategories: listKbCategories(),
    kbs: listKbs(),
    folders: listFolders(),
    entries: listEntries(),
  };
}

// 查询给定 id 中已存在于库内的（用于导入预览判定「新增 / 更新」）
export function existingIds(ids: string[]): Set<string> {
  const result = new Set<string>();
  const unique = [...new Set(ids.filter((x): x is string => typeof x === 'string' && x.length > 0))];
  if (!unique.length) return result;
  // 分批 IN 查询，避免单条往返与变量数上限
  const CHUNK = 500;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const slice = unique.slice(i, i + CHUNK);
    const placeholders = slice.map(() => '?').join(',');
    const rows = db.prepare(`SELECT id FROM entries WHERE id IN (${placeholders})`).all(...slice) as { id: string }[];
    for (const r of rows) result.add(r.id);
  }
  return result;
}

// 导入预览：解析载荷（与 importEntries 一致的归一化），但不写库。
export interface PreviewEntry {
  id?: string;
  cat: string;
  kbId?: string;
  folderId?: string | null;
  title: string;
  tags: string[];
  summary: string;
  intro: string;
  nodes: IndexNode[];
  exists: boolean;   // id 命中已有 → 将更新；否则新增
  valid: boolean;    // 标题非空 → 有效；否则导入时会被跳过
}

export interface ImportPreview {
  total: number;
  valid: number;
  skipped: number;
  newCount: number;
  updateCount: number;
  byCat: { cat: string; count: number }[];
  folders: PreviewFolder[];
  entries: PreviewEntry[];
}

export interface PreviewFolder {
  id?: string;
  kbId?: string;
  parentId?: string | null;
  name: string;
  path: string;
}

function buildPreviewFolders(folders: ImportFolder[] = []): PreviewFolder[] {
  const validFolders = folders.filter((folder) => folder.name && folder.name.trim());
  const byId = new Map(validFolders.filter((folder) => folder.id).map((folder) => [folder.id!, folder]));
  const pathCache = new Map<string, string>();

  const folderPath = (folder: ImportFolder, seen = new Set<string>()): string => {
    if (folder.id && pathCache.has(folder.id)) return pathCache.get(folder.id)!;
    const name = folder.name.trim();
    if (folder.id) {
      if (seen.has(folder.id)) return name;
      seen.add(folder.id);
    }
    const parent = folder.parentId ? byId.get(folder.parentId) : null;
    const path = parent ? `${folderPath(parent, seen)} / ${name}` : name;
    if (folder.id) pathCache.set(folder.id, path);
    return path;
  };

  return validFolders.map((folder) => ({
    id: folder.id,
    kbId: folder.kbId,
    parentId: folder.parentId ?? null,
    name: folder.name.trim(),
    path: folderPath(folder),
  }));
}

export function buildImportPreview(list: ImportEntry[], folders: ImportFolder[] = []): ImportPreview {
  const ids = list.map((e) => e.id).filter((x): x is string => typeof x === 'string' && x.length > 0);
  const existing = existingIds(ids);
  const entries: PreviewEntry[] = [];
  let valid = 0, skipped = 0, newCount = 0, updateCount = 0;
  const catMap = new Map<string, number>();
  for (const raw of list) {
    const title = typeof raw.title === 'string' ? raw.title.trim() : '';
    const isValid = Boolean(title);
    // 预览不写库:用 deriveDoc(不落图片)派生索引
    const tree = splitDocToIndex(deriveDoc({ doc: raw.doc, intro: raw.intro, nodes: raw.nodes, body: raw.body }));
    const cat = (raw.cat && String(raw.cat).trim()) || '未分类';
    const exists = typeof raw.id === 'string' && raw.id.length > 0 && existing.has(raw.id);
    entries.push({
      id: typeof raw.id === 'string' && raw.id ? raw.id : undefined,
      cat,
      kbId: raw.kbId,
      folderId: raw.folderId ?? null,
      title: title || '（无标题）',
      tags: Array.isArray(raw.tags) ? raw.tags : [],
      summary: (raw.summary && raw.summary.trim()) ? raw.summary.trim() : deriveSummary({}, tree),
      intro: tree.intro,
      nodes: tree.nodes,
      exists,
      valid: isValid,
    });
    if (!isValid) { skipped += 1; continue; }
    valid += 1;
    if (exists) updateCount += 1; else newCount += 1;
    catMap.set(cat, (catMap.get(cat) ?? 0) + 1);
  }
  const byCat = [...catMap.entries()]
    .map(([cat, count]) => ({ cat, count }))
    .sort((a, b) => b.count - a.count);
  return { total: list.length, valid, skipped, newCount, updateCount, byCat, folders: buildPreviewFolders(folders), entries };
}

// 批量导入（备份恢复 / 迁移）。replace=true 先清空；按 id upsert，兼容旧 body / cat 字段。
export function importEntries(payload: ImportPayload, replace: boolean): { imported: number } {
  const insertEntry = db.prepare(
    `INSERT INTO entries (id, cat, kbId, folderId, title, py, tags, summary, body, idx, sort, createdAt, updatedAt)
     VALUES (:id, :cat, :kbId, :folderId, :title, :py, :tags, :summary, '', :idx, :sort, :createdAt, :updatedAt)`
  );
  const updateEntry = db.prepare(
    `UPDATE entries SET cat=:cat, kbId=:kbId, folderId=:folderId, title=:title, py=:py, tags=:tags, summary=:summary, idx=:idx, updatedAt=:updatedAt WHERE id=:id`
  );
  const insertKb = db.prepare(
    'INSERT OR IGNORE INTO knowledge_bases (id, name, categoryId, sort, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insertCategory = db.prepare(
    'INSERT OR IGNORE INTO kb_categories (id, parentId, name, sort, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insertFolder = db.prepare(
    'INSERT OR IGNORE INTO folders (id, kbId, parentId, name, sort, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const existsStmt = db.prepare('SELECT 1 FROM entries WHERE id = ?');

  let imported = 0;
  db.exec('BEGIN');
  try {
    if (replace) {
      db.exec('DELETE FROM entries');
      db.exec('DELETE FROM folders');
      db.exec('DELETE FROM knowledge_bases');
      db.exec('DELETE FROM kb_categories');
    }

    // 1) 知识库分类
    const categoryIdMap = new Map<string, string>(); // 载荷原 id/name → 实际入库 id
    const rawCategories = payload.kbCategories ?? [];
    for (let i = 0; i < rawCategories.length; i++) {
      const c = rawCategories[i];
      if (!c.name || !c.name.trim()) continue;
      const id = c.id || `kbc_${Date.now().toString(36)}_${i}`;
      if (c.id) categoryIdMap.set(c.id, id);
      categoryIdMap.set(c.name, id);
    }
    for (const c of rawCategories) {
      if (!c.name || !c.name.trim()) continue;
      const id = (c.id && categoryIdMap.get(c.id)) || categoryIdMap.get(c.name);
      if (!id) continue;
      const parentId = c.parentId ? (categoryIdMap.get(c.parentId) ?? null) : null;
      const now = Date.now();
      insertCategory.run(id, parentId, c.name.trim(), c.sort ?? 0, now, now);
    }

    // 2) 知识库
    const kbIdMap = new Map<string, string>();   // 载荷原 id → 实际入库 id
    for (const k of payload.kbs ?? []) {
      const now = Date.now();
      const categoryId = k.categoryId ? (categoryIdMap.get(k.categoryId) ?? k.categoryId) : null;
      if (k.id) {
        insertKb.run(k.id, k.name, categoryId, k.sort ?? 0, now, now);
        kbIdMap.set(k.id, k.id);
      } else {
        const kb = ensureKb(k.name);
        if (categoryId) updateKbCategory(kb.id, categoryId);
        kbIdMap.set(k.name, kb.id);
      }
    }
    // 兜底知识库：在导入的知识库就绪后再取，避免 replace 清空后凭空多建一个默认库
    const fallbackKbId = defaultKbId();

    // 3) 文件夹：按依赖多趟建入（先建父、再建子），未就绪的父降级为根
    const pending = [...(payload.folders ?? [])];
    const folderIdMap = new Map<string, string>(); // 载荷原 id → 实际 id
    let progress = true;
    while (pending.length && progress) {
      progress = false;
      for (let i = pending.length - 1; i >= 0; i--) {
        const f = pending[i];
        const kbId = f.kbId ? (kbIdMap.get(f.kbId) ?? resolveKbId(f.kbId, undefined)) : fallbackKbId;
        if (f.parentId && !folderIdMap.has(f.parentId) && !getFolder(f.parentId)) continue; // 等父先建，或挂到已有文件夹
        const parentId = f.parentId ? (folderIdMap.get(f.parentId) ?? (getFolder(f.parentId) ? f.parentId : null)) : null;
        const now = Date.now();
        if (f.id) {
          insertFolder.run(f.id, kbId, parentId, f.name, f.sort ?? 0, now, now);
          folderIdMap.set(f.id, f.id);
        } else {
          const folder = ensureFolder(kbId, f.name, parentId);
          folderIdMap.set(f.name + '::' + (parentId ?? ''), folder.id);
        }
        pending.splice(i, 1);
        progress = true;
      }
    }
    for (const f of pending) {
      // 父缺失，强制挂根
      const kbId = f.kbId ? (kbIdMap.get(f.kbId) ?? resolveKbId(f.kbId, undefined)) : fallbackKbId;
      const now = Date.now();
      if (f.id) { insertFolder.run(f.id, kbId, null, f.name, f.sort ?? 0, now, now); folderIdMap.set(f.id, f.id); }
      else { const folder = ensureFolder(kbId, f.name, null); folderIdMap.set(f.name + '::', folder.id); }
    }

    // 4) 知识点
    let maxSort = Number((db.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM entries').get() as { m: number }).m);
    for (const raw of payload.entries) {
      if (!raw || typeof raw.title !== 'string' || !raw.title.trim()) continue;
      const now = Date.now();
      const id = typeof raw.id === 'string' && raw.id ? raw.id : 'u' + now + Math.floor(Math.random() * 100000);
      // 统一 doc-canonical:优先 doc 块,其次 intro/nodes,其次旧 body;图片落库去重
      const { tree, idx } = buildDocIdx({ doc: raw.doc, intro: raw.intro, nodes: raw.nodes, body: raw.body });
      const cat = (raw.cat && String(raw.cat).trim()) || '未分类';
      const kbId = raw.kbId ? (kbIdMap.get(raw.kbId) ?? resolveKbId(raw.kbId, cat)) : resolveKbId(undefined, cat);
      // 未声明 folderId 的旧载荷按 cat 建根文件夹；明确 folderId:null 表示导入到知识库根级。
      const hasFolderId = Object.prototype.hasOwnProperty.call(raw, 'folderId');
      let folderId: string | null;
      if (hasFolderId) {
        folderId = raw.folderId ? (folderIdMap.get(raw.folderId) ?? raw.folderId) : null;
        if (folderId && !getFolder(folderId)) folderId = null;
      } else {
        folderId = ensureFolder(kbId, cat, null).id;
      }
      const title = raw.title.trim();
      const py = (raw.py || title).toLowerCase();
      const tags = JSON.stringify(Array.isArray(raw.tags) ? raw.tags : []);
      const summary = (raw.summary && raw.summary.trim()) ? raw.summary.trim() : deriveSummary({}, tree);
      const exists = Boolean(existsStmt.get(id));
      if (exists) {
        updateEntry.run({ id, cat: kbNameOf(kbId), kbId, folderId, title, py, tags, summary, idx, updatedAt: now });
      } else {
        maxSort += 1;
        insertEntry.run({ id, cat: kbNameOf(kbId), kbId, folderId, title, py, tags, summary, idx, sort: maxSort, createdAt: now, updatedAt: now });
      }
      imported += 1;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { imported };
}
