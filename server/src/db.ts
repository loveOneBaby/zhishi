import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { SEED_ENTRIES } from './seed-data.js';
import type { Entry, EntryRow } from './types.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'knowledge.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS entries (
    id        TEXT PRIMARY KEY,
    cat       TEXT NOT NULL,
    title     TEXT NOT NULL,
    py        TEXT NOT NULL DEFAULT '',
    tags      TEXT NOT NULL DEFAULT '[]',
    summary   TEXT NOT NULL DEFAULT '',
    body      TEXT NOT NULL DEFAULT '',
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_entries_cat ON entries(cat);
`);

function rowToEntry(r: EntryRow): Entry {
  let tags: string[] = [];
  try { tags = JSON.parse(r.tags); } catch { tags = []; }
  return {
    id: r.id, cat: r.cat, title: r.title, py: r.py,
    tags, summary: r.summary, body: r.body,
    createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

// 首次启动：若表为空则导入内置种子数据
export function seedIfEmpty(): void {
  const count = (db.prepare('SELECT COUNT(*) AS n FROM entries').get() as { n: number }).n;
  if (count > 0) return;
  const now = Date.now();
  const insert = db.prepare(
    `INSERT INTO entries (id, cat, title, py, tags, summary, body, createdAt, updatedAt)
     VALUES (@id, @cat, @title, @py, @tags, @summary, @body, @createdAt, @updatedAt)`
  );
  const tx = db.transaction(() => {
    for (const e of SEED_ENTRIES) {
      insert.run({
        id: e.id, cat: e.cat, title: e.title, py: e.py,
        tags: JSON.stringify(e.tags), summary: e.summary, body: e.body,
        createdAt: now, updatedAt: now,
      });
    }
  });
  tx();
  console.log(`[db] 已导入 ${SEED_ENTRIES.length} 条内置知识点`);
}

export function listEntries(): Entry[] {
  const rows = db.prepare('SELECT * FROM entries ORDER BY createdAt ASC').all() as EntryRow[];
  return rows.map(rowToEntry);
}

export function getEntry(id: string): Entry | null {
  const row = db.prepare('SELECT * FROM entries WHERE id = ?').get(id) as EntryRow | undefined;
  return row ? rowToEntry(row) : null;
}

export interface EntryInput {
  cat: string;
  title: string;
  py?: string;
  tags?: string[];
  summary?: string;
  body?: string;
}

export function createEntry(input: EntryInput): Entry {
  const now = Date.now();
  const id = 'u' + now + Math.floor(Math.random() * 1000);
  const entry: Entry = {
    id,
    cat: input.cat || '自定义',
    title: input.title.trim(),
    py: (input.py || input.title).toLowerCase(),
    tags: input.tags || [],
    summary: input.summary || (input.body || '').split('\n').find((l) => l.trim()) || '自建知识点',
    body: input.body || '（暂无内容）',
    createdAt: now,
    updatedAt: now,
  };
  db.prepare(
    `INSERT INTO entries (id, cat, title, py, tags, summary, body, createdAt, updatedAt)
     VALUES (@id, @cat, @title, @py, @tags, @summary, @body, @createdAt, @updatedAt)`
  ).run({ ...entry, tags: JSON.stringify(entry.tags) });
  return entry;
}

export function updateEntry(id: string, input: Partial<EntryInput>): Entry | null {
  const cur = getEntry(id);
  if (!cur) return null;
  const next: Entry = {
    ...cur,
    cat: input.cat ?? cur.cat,
    title: input.title?.trim() ?? cur.title,
    py: (input.py ?? cur.py).toLowerCase(),
    tags: input.tags ?? cur.tags,
    summary: input.summary ?? cur.summary,
    body: input.body ?? cur.body,
    updatedAt: Date.now(),
  };
  db.prepare(
    `UPDATE entries SET cat=@cat, title=@title, py=@py, tags=@tags,
       summary=@summary, body=@body, updatedAt=@updatedAt WHERE id=@id`
  ).run({ ...next, tags: JSON.stringify(next.tags) });
  return next;
}

export function deleteEntry(id: string): boolean {
  const info = db.prepare('DELETE FROM entries WHERE id = ?').run(id);
  return info.changes > 0;
}
