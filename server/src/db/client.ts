import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import type { Entry, EntryRow, IndexNode, KnowledgeBase, Folder, KbRow, KbCategory, KbCategoryRow, FolderRow } from '../types.js';
import { parseBodyToIndex, normalizeIndex } from '../index-tree.js';
import { normalizeDocBlocks, splitDocToIndex, treeToDoc } from '../doc.js';
import type { Block } from '../blocks.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'knowledge.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// 使用 Node 内置 SQLite（node:sqlite，Node 22.5+ / 24 可用），无需原生编译
export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
  CREATE TABLE IF NOT EXISTS kb_categories (
    id        TEXT PRIMARY KEY,
    parentId  TEXT,
    name      TEXT NOT NULL,
    sort      INTEGER NOT NULL DEFAULT 0,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_kb_categories_parent ON kb_categories(parentId);
  CREATE TABLE IF NOT EXISTS knowledge_bases (
    id        TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    categoryId TEXT,
    sort      INTEGER NOT NULL DEFAULT 0,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS folders (
    id        TEXT PRIMARY KEY,
    kbId      TEXT NOT NULL,
    parentId  TEXT,
    name      TEXT NOT NULL,
    sort      INTEGER NOT NULL DEFAULT 0,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(kbId, parentId);
  CREATE TABLE IF NOT EXISTS entries (
    id        TEXT PRIMARY KEY,
    cat       TEXT NOT NULL,
    kbId      TEXT NOT NULL DEFAULT '',
    folderId  TEXT,
    title     TEXT NOT NULL,
    py        TEXT NOT NULL DEFAULT '',
    tags      TEXT NOT NULL DEFAULT '[]',
    summary   TEXT NOT NULL DEFAULT '',
    body      TEXT NOT NULL DEFAULT '',
    idx       TEXT NOT NULL DEFAULT '',
    sort      INTEGER NOT NULL DEFAULT 0,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_entries_cat ON entries(cat);
  CREATE TABLE IF NOT EXISTS seed_migrations (
    version   TEXT PRIMARY KEY,
    appliedAt INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS assets (
    id        TEXT PRIMARY KEY,
    kind      TEXT NOT NULL,        -- 'data'(站内存储二进制) | 'external'(外链)
    mime      TEXT NOT NULL DEFAULT '',
    hash      TEXT,                 -- data 资源的内容哈希,用于去重
    data      BLOB,                 -- kind=data 时的二进制
    url       TEXT,                 -- kind=external 时的外链
    width     INTEGER,
    height    INTEGER,
    alt       TEXT NOT NULL DEFAULT '',
    size      INTEGER NOT NULL DEFAULT 0,
    createdAt INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_assets_hash ON assets(hash);
`);

// 迁移旧库：补 categoryId / sort / idx / kbId / folderId 列
const kbColumns = db.prepare('PRAGMA table_info(knowledge_bases)').all() as { name: string }[];
if (!kbColumns.some((c) => c.name === 'categoryId')) {
  db.exec('ALTER TABLE knowledge_bases ADD COLUMN categoryId TEXT');
}
db.exec('UPDATE knowledge_bases SET categoryId = NULL WHERE categoryId IS NOT NULL AND categoryId NOT IN (SELECT id FROM kb_categories)');

const entryColumns = db.prepare('PRAGMA table_info(entries)').all() as { name: string }[];
if (!entryColumns.some((c) => c.name === 'sort')) {
  db.exec('ALTER TABLE entries ADD COLUMN sort INTEGER NOT NULL DEFAULT 0');
  db.exec('UPDATE entries SET sort = createdAt');
}
if (!entryColumns.some((c) => c.name === 'idx')) {
  db.exec("ALTER TABLE entries ADD COLUMN idx TEXT NOT NULL DEFAULT ''");
  const rows = db.prepare('SELECT id, body FROM entries').all() as { id: string; body: string }[];
  const setIdx = db.prepare('UPDATE entries SET idx = :idx WHERE id = :id');
  db.exec('BEGIN');
  try {
    for (const r of rows) setIdx.run({ id: r.id, idx: JSON.stringify(parseBodyToIndex(r.body || '')) });
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  console.log(`[db] 已将 ${rows.length} 条旧正文转换为结构化索引`);
}
if (!entryColumns.some((c) => c.name === 'kbId')) {
  db.exec("ALTER TABLE entries ADD COLUMN kbId TEXT NOT NULL DEFAULT ''");
}
if (!entryColumns.some((c) => c.name === 'folderId')) {
  db.exec('ALTER TABLE entries ADD COLUMN folderId TEXT');
}
// kbId / folderId 列就绪后再建索引（旧库的列是后补的，不能在建表块里直接引用）
db.exec('CREATE INDEX IF NOT EXISTS idx_entries_kbid_folder ON entries(kbId, folderId);');

export const DEFAULT_KB_NAME = '面试知识库';

let idCounter = 0;
export function genId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}`;
}

// 统一取出 canonical 块文档:优先 idx.doc;兼容旧 idx.nodes / 旧 body
function docOf(r: EntryRow): Block[] {
  if (r.idx) {
    try {
      const parsed = JSON.parse(r.idx) as { doc?: unknown; nodes?: unknown; intro?: unknown };
      if (Array.isArray(parsed.doc)) return normalizeDocBlocks(parsed.doc);
      if (Array.isArray(parsed.nodes)) return treeToDoc(normalizeIndex(parsed));
    } catch { /* fallthrough */ }
  }
  return treeToDoc(parseBodyToIndex(r.body || ''));
}

export function rowToKb(r: KbRow): KnowledgeBase {
  return { id: r.id, name: r.name, categoryId: r.categoryId ?? null, sort: r.sort, createdAt: r.createdAt, updatedAt: r.updatedAt };
}

export function rowToKbCategory(r: KbCategoryRow): KbCategory {
  return { id: r.id, parentId: r.parentId ?? null, name: r.name, sort: r.sort, createdAt: r.createdAt, updatedAt: r.updatedAt };
}

export function rowToFolder(r: FolderRow): Folder {
  return { id: r.id, kbId: r.kbId, parentId: r.parentId, name: r.name, sort: r.sort, createdAt: r.createdAt, updatedAt: r.updatedAt };
}

export function kbNameOf(kbId: string): string {
  if (!kbId) return '未分类';
  const row = db.prepare('SELECT name FROM knowledge_bases WHERE id = ?').get(kbId) as { name: string } | undefined;
  return row?.name ?? '未分类';
}

export function rowToEntry(r: EntryRow, kbName?: string): Entry {
  let tags: string[] = [];
  try { tags = JSON.parse(r.tags); } catch { tags = []; }
  const doc = docOf(r);
  const tree = splitDocToIndex(doc);
  return {
    id: r.id,
    cat: kbName ?? kbNameOf(r.kbId ?? ''),
    kbId: r.kbId ?? '',
    folderId: r.folderId ?? null,
    title: r.title, py: r.py,
    tags, summary: r.summary, intro: tree.intro, nodes: tree.nodes, doc,
    sort: r.sort ?? r.createdAt,
    createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

// 由各种输入(doc / intro+nodes / body)得到 canonical 块文档(不含落库副作用,供预览复用)
export function deriveDoc(input: { doc?: unknown; intro?: unknown; nodes?: unknown; body?: string }): Block[] {
  if (Array.isArray(input.doc)) return normalizeDocBlocks(input.doc);
  if (input.nodes !== undefined || input.intro !== undefined) return treeToDoc(normalizeIndex({ intro: input.intro ?? '', nodes: input.nodes ?? [] }));
  return treeToDoc(parseBodyToIndex(input.body ?? ''));
}
