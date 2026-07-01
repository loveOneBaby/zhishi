import { createClient as createHttpClient } from '@libsql/client/http';
import type { Client, InArgs, InStatement, InValue, ResultSet, Transaction } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { loadEnvFile } from '../env.js';
import type { Entry, EntryRow, KnowledgeBase, Folder, KbRow, KbCategory, KbCategoryRow, FolderRow } from '../types.js';
import { parseBodyToIndex, normalizeIndex } from '../index-tree.js';
import { normalizeDocBlocks, splitDocToIndex, treeToDoc } from '../doc.js';
import type { Block } from '../blocks.js';

// 先加载 .env（TURSO_DATABASE_URL / DB_PATH 等），再解析连接 URL。
// ESM 下 index.ts 的 loadEnvFile() 在函数体里、晚于 import 链执行；若不在 client.ts 此处先加载，
// 本地会用 .env 里的 Turso 变量时，连接创建在变量加载之前 → 误回退到 file: 本地文件模式。
// （线上 Render 由平台在进程启动前注入环境变量，不受影响。）
loadEnvFile();

// ───────────────────────── 连接 ─────────────────────────
// 统一用 @libsql/client：本地场景 file:./data/knowledge.db（离线、可直接读现有库文件），
// 远程场景 libsql://<db>.turso.io + TURSO_AUTH_TOKEN。
// 连接来源优先级：用户在 UI 保存的配置文件 > 环境变量(TURSO_DATABASE_URL/DB_PATH) > 默认本地文件。
// 注意：不 import 主入口 '@libsql/client'（它会预加载原生 libsql 二进制，在无该二进制的线上环境会崩）；
// 远程走 '@libsql/client/http'（纯 HTTP，不加载原生），仅本地 file: 模式才动态加载原生 '@libsql/client/sqlite3'。
const DATA_DIR = path.resolve(process.cwd(), 'data');
const DEFAULT_FILE = path.join(DATA_DIR, 'knowledge.db');

// 用户在 UI 里保存的 DB 配置（优先级最高，高于环境变量）。路径优先 IK_DB_CONFIG_PATH（桌面端指向 userData），
// 否则 server/data/db-config.json。null/不存在表示未覆盖，回退到环境变量。mode 仅作展示，不参与解析。
export interface DbConfig { mode?: 'local' | 'remote'; url?: string; token?: string; dbPath?: string }

export function dbConfigFilePath(): string {
  return process.env.IK_DB_CONFIG_PATH || path.join(DATA_DIR, 'db-config.json');
}

export function readDbConfigFile(): DbConfig | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(dbConfigFilePath(), 'utf8')) as DbConfig;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch { return null; }
}

function writeDbConfigFile(cfg: DbConfig | null): void {
  const file = dbConfigFilePath();
  if (!cfg || !Object.keys(cfg).length) {
    try { fs.unlinkSync(file); } catch { /* 不存在则忽略 */ }
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

export interface ResolvedDb { url: string; token?: string; source: 'user' | 'env' | 'default' }

// 纯函数：按优先级解析连接来源（用户配置 > 环境变量 > 默认）。抽出便于单测，无副作用。
export function resolveDbConfig(cfg: DbConfig | null, env: NodeJS.ProcessEnv, defaultFile = DEFAULT_FILE): ResolvedDb {
  if (cfg?.url) return { url: cfg.url, token: cfg.token, source: 'user' };
  if (cfg?.dbPath) return { url: 'file:' + cfg.dbPath, source: 'user' };
  if (env.TURSO_DATABASE_URL) return { url: env.TURSO_DATABASE_URL, token: env.TURSO_AUTH_TOKEN, source: 'env' };
  if (env.DB_PATH) return { url: 'file:' + env.DB_PATH, source: 'env' }; // 兼容旧 DB_PATH
  return { url: 'file:' + defaultFile, source: 'default' };
}

// 解析当前应使用的数据库连接：用户配置文件 > 环境变量 > 默认本地文件。
function resolveDb(): ResolvedDb {
  return resolveDbConfig(readDbConfigFile(), process.env);
}

function defaultMaxConcurrency(url: string): number {
  return url.startsWith('file:') ? 1 : 4;
}
function resolveMaxConcurrency(url: string): number {
  return Math.max(1, Math.min(24, Number(process.env.DB_MAX_CONCURRENCY ?? defaultMaxConcurrency(url)) || defaultMaxConcurrency(url)));
}

// 创建底层 libSQL client：file: 动态加载原生 sqlite3，远程走 HTTP（不加载原生二进制）。
async function createClientFor(url: string, token?: string): Promise<Client> {
  if (url.startsWith('file:')) {
    const { createClient: createSqlite3Client } = await import('@libsql/client/sqlite3');
    return createSqlite3Client({ url });
  }
  return createHttpClient({ url, authToken: token });
}

function ensureFileDir(url: string): void {
  if (!url.startsWith('file:')) return;
  const dir = path.dirname(url.replace(/^file:/, ''));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// 首次启动：解析 + 建目录 + 建 client（与原行为一致）。client/resolved/dbMaxConcurrency 为可重赋值的模块状态，
// 供 reconfigureDb() 在进程内热切换。
let resolved: ResolvedDb = resolveDb();
ensureFileDir(resolved.url);
let client: Client = await createClientFor(resolved.url, resolved.token);
let dbMaxConcurrency: number = resolveMaxConcurrency(resolved.url);

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

let activeDbOps = 0;
const dbWaitQueue: Array<() => void> = [];
// 热切换期间置 true：新 ops 入队等待，避免命中正在被替换的 client。
let reconfiguring = false;

async function withDbSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (reconfiguring || activeDbOps >= dbMaxConcurrency || dbWaitQueue.length > 0) {
    await new Promise<void>((resolve) => dbWaitQueue.push(resolve));
  }
  activeDbOps += 1;
  try {
    return await fn();
  } finally {
    activeDbOps -= 1;
    // 切换期间不释放队列：被阻塞的 op 必须等切换完成（reconfigureDb 末尾统一释放首个，其余由各 op 的 finally 顺序释放）。
    if (!reconfiguring) dbWaitQueue.shift()?.();
  }
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
  _exec: (sql) => withDbSlot(() => client.executeMultiple(sql)),
  _run: (s) => withDbSlot(() => client.execute(s)),
};
const txStorage = new AsyncLocalStorage<AdapterCore>();

function currentCore(): AdapterCore {
  return txStorage.getStore() ?? rootCore;
}

export const db: Db = {
  exec: (sql) => currentCore()._exec(sql),
  prepare: (sql) => makePreparedStatement(sql),
  tx: async <T>(fn: () => Promise<T>): Promise<T> => {
    return withDbSlot(async () => {
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
    });
  },
};

// ───────────────────────── 热切换 ─────────────────────────
// 在进程内切换数据库连接：先建候选 client 并 SELECT 1 探活，成功才落盘 + 排空在途 op + 关旧 client + 交换。
// 失败则丢弃候选、旧状态不变、抛错给调用方（API 返回错误，DB 不变）。
// 调用方在交换成功后需自行重跑 initDb / seedBuiltins / 清缓存 / 重置 AI 任务（见 routes/config.ts）。
export async function reconfigureDb(cfg: DbConfig | null): Promise<ResolvedDb> {
  // 1. 计算候选连接。clear（cfg 为 null 或既无 url 也无 dbPath）→ 删配置文件后回退到环境变量/默认。
  const clearing = !cfg || (!cfg.url && !cfg.dbPath);
  let candidate: ResolvedDb;
  if (clearing) {
    writeDbConfigFile(null);
    candidate = resolveDb();
  } else if (cfg!.url) {
    const url = String(cfg!.url).trim();
    if (!/^(libsql|https?):\/\//i.test(url)) throw new Error('远程地址需为 libsql:// 或 http(s):// 开头');
    candidate = { url, token: cfg!.token?.trim() || undefined, source: 'user' };
  } else {
    const dbPath = String(cfg!.dbPath!).trim();
    if (!dbPath) throw new Error('本地数据库文件路径不能为空');
    candidate = { url: 'file:' + dbPath, source: 'user' };
  }

  // 2. 建候选 client + 探活（不关旧 client，失败可丢弃候选、旧状态不变）。
  ensureFileDir(candidate.url);
  const probe = await createClientFor(candidate.url, candidate.token);
  try {
    await probe.execute('SELECT 1');
  } catch (e) {
    try { await probe.close(); } catch { /* ignore */ }
    throw new Error(`无法连接到目标数据库：${(e as Error).message}`);
  }

  // 3. 落盘用户配置（clear 分支已在上面删除；本地 file: 存 dbPath，远程存 url+token）。
  if (!clearing) {
    const isFile = candidate.url.startsWith('file:');
    writeDbConfigFile({
      mode: isFile ? 'local' : 'remote',
      url: isFile ? undefined : candidate.url,
      token: isFile ? undefined : candidate.token,
      dbPath: isFile ? candidate.url.replace(/^file:/, '') : undefined,
    });
  }

  // 4. 排他：置 reconfiguring，等在途 op 排空（其 finally 因 reconfiguring=true 不会释放队列）。
  reconfiguring = true;
  try {
    while (activeDbOps > 0) await new Promise((r) => setTimeout(r, 5));
    // 5. 关旧 client，交换为新。
    const old = client;
    client = probe;
    resolved = candidate;
    dbMaxConcurrency = resolveMaxConcurrency(candidate.url);
    try { await old.close(); } catch { /* ignore */ }
  } finally {
    reconfiguring = false;
  }
  // 释放切换期间入队的首个 op（后续 op 由各自 finally 顺序释放）。
  dbWaitQueue.shift()?.();
  return resolved;
}

export interface DbInfo { mode: 'local' | 'remote'; label: string; source: 'user' | 'env' | 'default' }

// 纯函数：由已解析连接推导可显示信息（不泄露 token）。抽出便于单测。
export function dbInfoFor(r: ResolvedDb): DbInfo {
  if (r.url.startsWith('file:')) {
    const file = r.url.replace(/^file:/, '');
    return { mode: 'local', label: path.basename(file) || file, source: r.source };
  }
  let label = r.url;
  try { label = new URL(r.url).host; } catch { /* 保留原值 */ }
  return { mode: 'remote', label, source: r.source };
}

// 当前连接的可显示信息（不泄露 token）。供 /api/config 给管理员查看。
export function getDbInfo(): DbInfo {
  return dbInfoFor(resolved);
}

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
	      favorite  INTEGER NOT NULL DEFAULT 0,
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
  await tryAlter('ALTER TABLE knowledge_bases ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0');
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
  return {
    id: r.id,
    name: r.name,
    categoryId: r.categoryId ?? null,
    favorite: Boolean(r.favorite),
    sort: r.sort,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
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
