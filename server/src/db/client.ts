import { createClient, type Client, type InArgs, type InStatement, type InValue, type ResultSet, type Transaction } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Entry, EntryRow, KnowledgeBase, Folder, KbRow, KbCategory, KbCategoryRow, FolderRow } from '../types.js';
import { parseBodyToIndex, normalizeIndex } from '../index-tree.js';
import { normalizeDocBlocks, splitDocToIndex, treeToDoc } from '../doc.js';
import type { Block } from '../blocks.js';

// ───────────────────────── 连接 ─────────────────────────
// 统一用 @libsql/client：本地场景 file:./data/knowledge.db（离线、可直接读现有库文件），
// 远程场景 libsql://<db>.turso.io + TURSO_AUTH_TOKEN。由环境变量按场景切换。
const DATA_DIR = path.resolve(process.cwd(), 'data');
const DEFAULT_FILE = path.join(DATA_DIR, 'knowledge.db');

function resolveDbUrl(): string {
  if (process.env.TURSO_DATABASE_URL) return process.env.TURSO_DATABASE_URL;
  if (process.env.DB_PATH) return 'file:' + process.env.DB_PATH; // 兼容旧 DB_PATH
  return 'file:' + DEFAULT_FILE;
}
const DB_URL = resolveDbUrl();

// 本地 file: 模式需要目录存在（远程无文件）
if (DB_URL.startsWith('file:') && !fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const client: Client = createClient({ url: DB_URL, authToken: process.env.TURSO_AUTH_TOKEN });

// ───────────────────────── 异步 shim ─────────────────────────
// 用 libSQL client 实现，对外保留原 node:sqlite 的 db.prepare(sql).get/.all/.run + db.exec 调用形状（返回 Promise）。
// 关键：用 AsyncLocalStorage 把「事务内」的 prepare/exec 自动路由到当前 transaction，
// 这样既有的「事务外 prepare、事务内 run」写法（如 import.ts 的批量预编译语句）无需改造。

export interface RunResult { changes: number; lastInsertRowid: bigint | undefined }
export interface PreparedStatement {
  get(...args: unknown[]): Promise<any>;
  all(...args: unknown[]): Promise<any[]>;
  run(...args: unknown[]): Promise<RunResult>;
}
export interface DbAdapter {
  exec(sql: string): Promise<void>;
  prepare(sql: string): PreparedStatement;
}
export interface Db extends DbAdapter {
  tx<T>(fn: () => Promise<T>): Promise<T>;
}

// 底层执行器：root 用 client，tx 内用 transaction。prepare/exec 在调用时经 currentCore() 路由，
// 这样「事务外 prepare、事务内 run」的写法（import.ts 的批量预编译语句）能自动落到当前事务。
interface AdapterCore {
  _exec(sql: string): Promise<void>;
  _run(stmt: InStatement): Promise<ResultSet>;
}

// 单个参数包：数组→positional；普通对象→named；基本类型→单 positional
function isNamedArgs(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v) && !Buffer.isBuffer(v) && !(v instanceof Uint8Array);
}
function toArgs(args: unknown[]): InArgs {
  if (args.length === 0) return [];
  if (args.length === 1) {
    const a = args[0];
    if (isNamedArgs(a)) return a as Record<string, InValue>;
    if (Array.isArray(a)) return a as InValue[];
    return [a as InValue];
  }
  return args as InArgs;
}

function makePreparedStatement(sql: string): PreparedStatement {
  return {
    get: (...args) => currentCore()._run({ sql, args: toArgs(args) }).then((r) => r.rows[0]),
    all: (...args) => currentCore()._run({ sql, args: toArgs(args) }).then((r) => [...r.rows] as any[]),
    run: (...args) => currentCore()._run({ sql, args: toArgs(args) }).then((r) => ({ changes: r.rowsAffected, lastInsertRowid: r.lastInsertRowid })),
  };
}

const rootCore: AdapterCore = {
  _exec: (sql) => client.executeMultiple(sql),
  _run: (s) => client.execute(s),
};
const txStorage = new AsyncLocalStorage<AdapterCore>();

function currentCore(): AdapterCore {
  return txStorage.getStore() ?? rootCore;
}

export const db: Db = {
  exec: (sql) => currentCore()._exec(sql),
  prepare: (sql) => makePreparedStatement(sql),
  tx: async <T>(fn: () => Promise<T>): Promise<T> => {
    const tx: Transaction = await client.transaction('write');
    const core: AdapterCore = {
      _exec: (sql) => tx.executeMultiple(sql),
      _run: (s) => tx.execute(s),
    };
    return txStorage.run(core, async () => {
      try {
        const res = await fn();
        await tx.commit();
        return res;
      } catch (e) {
        try { await tx.rollback(); } catch { /* ignore rollback error */ }
        throw e;
      }
    });
  },
};

// ───────────────────────── 建表 / 迁移 ─────────────────────────

// ALTER 加列：列已存在则忽略（两后端通用，去掉对 PRAGMA table_info 的依赖）
export async function tryAlter(sql: string, onAdded?: () => Promise<void>): Promise<void> {
  try {
    await db.exec(sql);
    if (onAdded) await onAdded();
  } catch (e) {
    if (/duplicate column/i.test(String((e as Error)?.message ?? ''))) return; // 列已存在
    throw e;
  }
}

export async function initSchema(): Promise<void> {
  await db.exec(`
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
      kind      TEXT NOT NULL,
      mime      TEXT NOT NULL DEFAULT '',
      hash      TEXT,
      data      BLOB,
      url       TEXT,
      width     INTEGER,
      height    INTEGER,
      alt       TEXT NOT NULL DEFAULT '',
      size      INTEGER NOT NULL DEFAULT 0,
      createdAt INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_assets_hash ON assets(hash);
  `);

  // WAL 仅本地 file: 有意义；远程 libsql 不支持 PRAGMA，忽略错误
  try { await db.exec('PRAGMA journal_mode = WAL;'); } catch { /* remote: PRAGMA 不可用 */ }

  // 迁移旧库：补 categoryId / sort / idx / kbId / folderId 列
  await tryAlter('ALTER TABLE knowledge_bases ADD COLUMN categoryId TEXT');
  await db.exec('UPDATE knowledge_bases SET categoryId = NULL WHERE categoryId IS NOT NULL AND categoryId NOT IN (SELECT id FROM kb_categories)');

  await tryAlter('ALTER TABLE entries ADD COLUMN sort INTEGER NOT NULL DEFAULT 0', async () => {
    await db.exec('UPDATE entries SET sort = createdAt');
  });
  await tryAlter("ALTER TABLE entries ADD COLUMN idx TEXT NOT NULL DEFAULT ''", async () => {
    const rows = await db.prepare('SELECT id, body FROM entries').all() as { id: string; body: string }[];
    if (!rows.length) return;
    const setIdx = db.prepare('UPDATE entries SET idx = :idx WHERE id = :id');
    await db.tx(async () => {
      for (const r of rows) await setIdx.run({ id: r.id, idx: JSON.stringify(parseBodyToIndex(r.body || '')) });
    });
    console.log(`[db] 已将 ${rows.length} 条旧正文转换为结构化索引`);
  });
  await tryAlter("ALTER TABLE entries ADD COLUMN kbId TEXT NOT NULL DEFAULT ''");
  await tryAlter('ALTER TABLE entries ADD COLUMN folderId TEXT');
  // kbId / folderId 列就绪后再建索引（旧库的列是后补的，不能在建表块里直接引用）
  await db.exec('CREATE INDEX IF NOT EXISTS idx_entries_kbid_folder ON entries(kbId, folderId);');
}

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

export async function kbNameOf(kbId: string): Promise<string> {
  if (!kbId) return '未分类';
  const row = await db.prepare('SELECT name FROM knowledge_bases WHERE id = ?').get(kbId) as { name: string } | undefined;
  return row?.name ?? '未分类';
}

export async function rowToEntry(r: EntryRow, kbName?: string): Promise<Entry> {
  let tags: string[] = [];
  try { tags = JSON.parse(r.tags); } catch { tags = []; }
  const doc = docOf(r);
  const tree = splitDocToIndex(doc);
  const cat = kbName !== undefined ? kbName : await kbNameOf(r.kbId ?? '');
  return {
    id: r.id,
    cat,
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
