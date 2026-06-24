import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { SEED_LIBRARIES } from './seed-data/index.js';
import type { Entry, EntryRow, IndexNode } from './types.js';
import { parseBodyToIndex, normalizeIndex, type IndexTree } from './index-tree.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'knowledge.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// 使用 Node 内置 SQLite（node:sqlite，Node 22.5+ / 24 可用），无需原生编译
export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
  CREATE TABLE IF NOT EXISTS entries (
    id        TEXT PRIMARY KEY,
    cat       TEXT NOT NULL,
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
`);

// 迁移旧库：补 sort / idx 列，并把旧 markdown 正文一次性转换为结构化索引
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

function treeOf(r: EntryRow): IndexTree {
  if (r.idx) {
    try { return normalizeIndex(JSON.parse(r.idx)); } catch { /* fallthrough */ }
  }
  return parseBodyToIndex(r.body || '');
}

function rowToEntry(r: EntryRow): Entry {
  let tags: string[] = [];
  try { tags = JSON.parse(r.tags); } catch { tags = []; }
  const tree = treeOf(r);
  return {
    id: r.id, cat: r.cat, title: r.title, py: r.py,
    tags, summary: r.summary, intro: tree.intro, nodes: tree.nodes,
    sort: r.sort ?? r.createdAt,
    createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

// 按版本导入知识库；旧种子的 markdown 正文在写入时转换为结构化索引
export function seedBuiltins(): void {
  const applied = new Set(
    (db.prepare('SELECT version FROM seed_migrations').all() as { version: string }[]).map((row) => row.version)
  );
  const count = db.prepare('SELECT COUNT(*) AS n FROM entries').get() as { n: number };
  const insert = db.prepare(
    `INSERT OR IGNORE INTO entries (id, cat, title, py, tags, summary, body, idx, sort, createdAt, updatedAt)
     VALUES (:id, :cat, :title, :py, :tags, :summary, :body, :idx, :sort, :createdAt, :updatedAt)`
  );
  const updateBuiltin = db.prepare(
    `UPDATE entries SET cat=:cat, title=:title, py=:py, tags=:tags,
       summary=:summary, body=:body, idx=:idx, updatedAt=:updatedAt WHERE id=:id`
  );
  const deleteBuiltin = db.prepare('DELETE FROM entries WHERE id = ?');
  const markApplied = db.prepare('INSERT INTO seed_migrations (version, appliedAt) VALUES (?, ?)');
  let added = 0, updated = 0, removed = 0;

  db.exec('BEGIN');
  try {
    for (const library of SEED_LIBRARIES) {
      if (applied.has(library.version)) continue;
      const skipLegacyBase = library.version === 'base-v1' && count.n > 0;
      if (!skipLegacyBase) {
        const now = Date.now();
        for (const e of library.entries) {
          const idx = JSON.stringify(parseBodyToIndex(e.body));
          const values = {
            id: e.id, cat: e.cat, title: e.title, py: e.py,
            tags: JSON.stringify(e.tags), summary: e.summary, body: e.body, idx,
            sort: now, createdAt: now, updatedAt: now,
          };
          if (library.overwrite) {
            const info = updateBuiltin.run({
              id: e.id, cat: e.cat, title: e.title, py: e.py,
              tags: JSON.stringify(e.tags), summary: e.summary, body: e.body, idx, updatedAt: now,
            });
            if (Number(info.changes) > 0) updated += Number(info.changes);
            else added += Number(insert.run(values).changes);
          } else {
            added += Number(insert.run(values).changes);
          }
        }
        for (const id of library.removeIds ?? []) removed += Number(deleteBuiltin.run(id).changes);
      }
      markApplied.run(library.version, Date.now());
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  if (added || updated || removed) {
    console.log(`[db] 内置知识点：新增 ${added}，更新 ${updated}，移除 ${removed}`);
  }
}

export function listEntries(): Entry[] {
  const rows = db.prepare('SELECT * FROM entries ORDER BY sort ASC, createdAt ASC').all() as unknown as EntryRow[];
  return rows.map(rowToEntry);
}

export function getEntry(id: string): Entry | null {
  const row = db.prepare('SELECT * FROM entries WHERE id = ?').get(id) as unknown as EntryRow | undefined;
  return row ? rowToEntry(row) : null;
}

export interface EntryInput {
  cat: string;
  title: string;
  py?: string;
  tags?: string[];
  summary?: string;
  intro?: string;
  nodes?: IndexNode[];
}

function deriveSummary(input: { summary?: string }, tree: IndexTree): string {
  if (input.summary && input.summary.trim()) return input.summary.trim();
  const firstIntro = tree.intro.split('\n').map((l) => l.trim()).find(Boolean);
  return firstIntro || tree.nodes[0]?.title || '自建知识点';
}

export function createEntry(input: EntryInput): Entry {
  const now = Date.now();
  const id = 'u' + now + Math.floor(Math.random() * 1000);
  const tree = normalizeIndex({ intro: input.intro ?? '', nodes: input.nodes ?? [] });
  const maxRow = db.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM entries').get() as { m: number };
  const entry: Entry = {
    id,
    cat: input.cat || '自定义',
    title: input.title.trim(),
    py: (input.py || input.title).toLowerCase(),
    tags: input.tags || [],
    summary: deriveSummary(input, tree),
    intro: tree.intro,
    nodes: tree.nodes,
    sort: Number(maxRow.m) + 1,
    createdAt: now,
    updatedAt: now,
  };
  db.prepare(
    `INSERT INTO entries (id, cat, title, py, tags, summary, body, idx, sort, createdAt, updatedAt)
     VALUES (:id, :cat, :title, :py, :tags, :summary, '', :idx, :sort, :createdAt, :updatedAt)`
  ).run({
    id: entry.id, cat: entry.cat, title: entry.title, py: entry.py,
    tags: JSON.stringify(entry.tags), summary: entry.summary,
    idx: JSON.stringify(tree), sort: entry.sort, createdAt: now, updatedAt: now,
  });
  return entry;
}

// 按给定顺序重排（管理模块拖拽）。ids 为某个知识库内的全部知识点 id。
export function reorderEntries(ids: string[]): void {
  const stmt = db.prepare('UPDATE entries SET sort = :sort WHERE id = :id');
  db.exec('BEGIN');
  try {
    ids.forEach((id, index) => stmt.run({ id, sort: index }));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function updateEntry(id: string, input: Partial<EntryInput>): Entry | null {
  const cur = getEntry(id);
  if (!cur) return null;
  const tree = normalizeIndex({
    intro: input.intro ?? cur.intro,
    nodes: input.nodes ?? cur.nodes,
  });
  const nextTitle = input.title?.trim() ?? cur.title;
  // 标题变更且未显式给 py 时，按新标题重算拼音源，避免检索过期
  const nextPy = input.py != null
    ? input.py.toLowerCase()
    : (input.title != null ? nextTitle.toLowerCase() : cur.py);
  let nextSummary = input.summary ?? cur.summary;
  if (!nextSummary || !nextSummary.trim()) nextSummary = deriveSummary({}, tree);
  const next: Entry = {
    ...cur,
    cat: input.cat ?? cur.cat,
    title: nextTitle,
    py: nextPy,
    tags: input.tags ?? cur.tags,
    summary: nextSummary,
    intro: tree.intro,
    nodes: tree.nodes,
    updatedAt: Date.now(),
  };
  db.prepare(
    `UPDATE entries SET cat=:cat, title=:title, py=:py, tags=:tags,
       summary=:summary, idx=:idx, updatedAt=:updatedAt WHERE id=:id`
  ).run({
    id: next.id, cat: next.cat, title: next.title, py: next.py,
    tags: JSON.stringify(next.tags), summary: next.summary,
    idx: JSON.stringify(tree), updatedAt: next.updatedAt,
  });
  return next;
}

export function deleteEntry(id: string): boolean {
  const info = db.prepare('DELETE FROM entries WHERE id = ?').run(id);
  return Number(info.changes) > 0;
}

// 重命名知识库：把该分类下所有知识点的 cat 改为新名（用于管理模块的「重命名知识库」）
export function renameCategory(from: string, to: string): number {
  const target = to.trim();
  if (!from || !target || from === target) return 0;
  const now = Date.now();
  const info = db.prepare('UPDATE entries SET cat = ?, updatedAt = ? WHERE cat = ?').run(target, now, from);
  return Number(info.changes);
}

// 删除知识库：删除该分类下的全部知识点（用于管理模块的「删除知识库」）
export function deleteCategory(name: string): number {
  if (!name) return 0;
  const info = db.prepare('DELETE FROM entries WHERE cat = ?').run(name);
  return Number(info.changes);
}

// 批量导入（备份恢复 / 迁移）。replace=true 先清空；按 id upsert，兼容旧 body 字段。
export interface ImportEntry {
  id?: string;
  cat?: string;
  title?: string;
  py?: string;
  tags?: string[];
  summary?: string;
  intro?: string;
  nodes?: IndexNode[];
  body?: string;
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

// 导入预览：对已 convertEntry 过的列表做归一化展示与统计，但不写库。
// 解析逻辑与 importEntries 一致（normalizeIndex / parseBodyToIndex / deriveSummary）。
export interface PreviewEntry {
  id?: string;
  cat: string;
  title: string;
  tags: string[];
  summary: string;
  intro: string;
  nodes: IndexNode[];
  exists: boolean;   // id 命中已有 → 将更新；否则新增
  valid: boolean;    // 标题非空 → 有效；否则导入时会被跳过
}

export interface ImportPreview {
  total: number;       // 解析到的条目总数
  valid: number;       // 将导入的有效条目数
  skipped: number;     // 将被跳过的无效条目数
  newCount: number;    // 新增
  updateCount: number; // 更新
  byCat: { cat: string; count: number }[];
  entries: PreviewEntry[];
}

export function buildImportPreview(list: ImportEntry[]): ImportPreview {
  const ids = list.map((e) => e.id).filter((x): x is string => typeof x === 'string' && x.length > 0);
  const existing = existingIds(ids);
  const entries: PreviewEntry[] = [];
  let valid = 0, skipped = 0, newCount = 0, updateCount = 0;
  const catMap = new Map<string, number>();
  for (const raw of list) {
    const title = typeof raw.title === 'string' ? raw.title.trim() : '';
    const isValid = Boolean(title);
    const tree = (raw.nodes !== undefined || raw.intro !== undefined)
      ? normalizeIndex({ intro: raw.intro ?? '', nodes: raw.nodes ?? [] })
      : parseBodyToIndex(raw.body ?? '');
    const cat = (raw.cat && String(raw.cat).trim()) || '自定义';
    const exists = typeof raw.id === 'string' && raw.id.length > 0 && existing.has(raw.id);
    entries.push({
      id: typeof raw.id === 'string' && raw.id ? raw.id : undefined,
      cat,
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
  return { total: list.length, valid, skipped, newCount, updateCount, byCat, entries };
}

export function importEntries(list: ImportEntry[], replace: boolean): { imported: number } {
  const insert = db.prepare(
    `INSERT INTO entries (id, cat, title, py, tags, summary, body, idx, sort, createdAt, updatedAt)
     VALUES (:id, :cat, :title, :py, :tags, :summary, '', :idx, :sort, :createdAt, :updatedAt)`
  );
  const update = db.prepare(
    `UPDATE entries SET cat=:cat, title=:title, py=:py, tags=:tags, summary=:summary, idx=:idx, updatedAt=:updatedAt WHERE id=:id`
  );
  let imported = 0;
  db.exec('BEGIN');
  try {
    if (replace) db.exec('DELETE FROM entries');
    let maxSort = Number((db.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM entries').get() as { m: number }).m);
    for (const raw of list) {
      if (!raw || typeof raw.title !== 'string' || !raw.title.trim()) continue;
      const now = Date.now();
      const id = typeof raw.id === 'string' && raw.id ? raw.id : 'u' + now + Math.floor(Math.random() * 100000);
      const tree = (raw.nodes !== undefined || raw.intro !== undefined)
        ? normalizeIndex({ intro: raw.intro ?? '', nodes: raw.nodes ?? [] })
        : parseBodyToIndex(raw.body ?? '');
      const idx = JSON.stringify(tree);
      const cat = (raw.cat && String(raw.cat).trim()) || '自定义';
      const title = raw.title.trim();
      const py = (raw.py || title).toLowerCase();
      const tags = JSON.stringify(Array.isArray(raw.tags) ? raw.tags : []);
      const summary = (raw.summary && raw.summary.trim()) ? raw.summary.trim() : deriveSummary({}, tree);
      const exists = db.prepare('SELECT 1 FROM entries WHERE id = ?').get(id);
      if (exists) {
        update.run({ id, cat, title, py, tags, summary, idx, updatedAt: now });
      } else {
        maxSort += 1;
        insert.run({ id, cat, title, py, tags, summary, idx, sort: maxSort, createdAt: now, updatedAt: now });
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
