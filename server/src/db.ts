import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { SEED_LIBRARIES } from './seed-data/index.js';
import type { Entry, EntryRow, IndexNode, KnowledgeBase, Folder, KbRow, FolderRow } from './types.js';
import { parseBodyToIndex, normalizeIndex, type IndexTree } from './index-tree.js';
import { parseDataUrl, sha256, sniffImageSize, classifyImageSrc } from './assets.js';
import { normalizeDocBlocks, splitDocToIndex, markdownToDocBlocks, treeToDoc } from './doc.js';
import type { Block } from './blocks.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'knowledge.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// 使用 Node 内置 SQLite（node:sqlite，Node 22.5+ / 24 可用），无需原生编译
export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
  CREATE TABLE IF NOT EXISTS knowledge_bases (
    id        TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
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

// 迁移旧库：补 sort / idx / kbId / folderId 列
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
function genId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}`;
}

// 一次性数据迁移：把旧的「按 cat 平铺」结构升级为「知识库 → 文件夹 → 知识点」
function migrateKbFolder(): void {
  const applied = new Set(
    (db.prepare('SELECT version FROM seed_migrations').all() as { version: string }[]).map((r) => r.version)
  );
  if (applied.has('kb-folder-v1')) return;

  let defaultKbId: string;
  const kbCount = (db.prepare('SELECT COUNT(*) AS n FROM knowledge_bases').get() as { n: number }).n;
  if (kbCount === 0) {
    defaultKbId = createKb(DEFAULT_KB_NAME).id;
  } else {
    const first = db.prepare('SELECT id FROM knowledge_bases ORDER BY sort ASC, createdAt ASC LIMIT 1').get() as { id: string };
    defaultKbId = first.id;
  }

  // 为每个 distinct cat 在默认知识库下建根文件夹
  const cats = db.prepare(
    "SELECT DISTINCT COALESCE(NULLIF(cat,''),'未分类') AS cat FROM entries WHERE COALESCE(kbId,'')=''"
  ).all() as { cat: string }[];
  const catToFolder = new Map<string, string>();
  for (const { cat } of cats) catToFolder.set(cat, ensureFolder(defaultKbId, cat, null).id);

  const entriesToMigrate = db.prepare(
    "SELECT id, COALESCE(NULLIF(cat,''),'未分类') AS cat FROM entries WHERE COALESCE(kbId,'')=''"
  ).all() as { id: string; cat: string }[];
  const updateEntry = db.prepare('UPDATE entries SET kbId = :kbId, folderId = :folderId WHERE id = :id');
  db.exec('BEGIN');
  try {
    for (const e of entriesToMigrate) {
      updateEntry.run({ kbId: defaultKbId, folderId: catToFolder.get(e.cat) ?? null, id: e.id });
    }
    db.prepare('INSERT INTO seed_migrations (version, appliedAt) VALUES (?, ?)').run('kb-folder-v1', Date.now());
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  if (entriesToMigrate.length) {
    console.log(`[db] 已将 ${entriesToMigrate.length} 条知识点归入知识库 / 文件夹结构`);
  }
}
migrateKbFolder();

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

// 把图片块里的 data:base64 落库为 asset,只留站内 url(去重,避免 JSON 膨胀)
function rewriteDocImages(doc: Block[]): Block[] {
  const walk = (blocks: Block[]): void => {
    for (const b of blocks) {
      if (b.type === 'image') {
        const props = (b.props ?? {}) as Record<string, unknown>;
        const url = String(props.url ?? '');
        if (/^data:/i.test(url)) {
          const asset = createDataAsset(url, String(props.caption ?? ''));
          if (asset) props.url = asset.url;
        }
        b.props = props;
      }
      if (Array.isArray(b.children)) walk(b.children);
    }
  };
  walk(doc);
  return doc;
}

function rowToKb(r: KbRow): KnowledgeBase {
  return { id: r.id, name: r.name, sort: r.sort, createdAt: r.createdAt, updatedAt: r.updatedAt };
}

function rowToFolder(r: FolderRow): Folder {
  return { id: r.id, kbId: r.kbId, parentId: r.parentId, name: r.name, sort: r.sort, createdAt: r.createdAt, updatedAt: r.updatedAt };
}

function kbNameOf(kbId: string): string {
  if (!kbId) return '未分类';
  const row = db.prepare('SELECT name FROM knowledge_bases WHERE id = ?').get(kbId) as { name: string } | undefined;
  return row?.name ?? '未分类';
}

function rowToEntry(r: EntryRow, kbName?: string): Entry {
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
function deriveDoc(input: { doc?: unknown; intro?: unknown; nodes?: unknown; body?: string }): Block[] {
  if (Array.isArray(input.doc)) return normalizeDocBlocks(input.doc);
  if (input.nodes !== undefined || input.intro !== undefined) return treeToDoc(normalizeIndex({ intro: input.intro ?? '', nodes: input.nodes ?? [] }));
  return treeToDoc(parseBodyToIndex(input.body ?? ''));
}

// 统一得到 canonical 块文档 + 派生索引,并落 idx(写入路径:含图片落库)
function buildDocIdx(input: { doc?: unknown; intro?: unknown; nodes?: unknown; body?: string }): { doc: Block[]; tree: IndexTree; idx: string } {
  const doc = rewriteDocImages(deriveDoc(input));
  const tree = splitDocToIndex(doc);
  return { doc, tree, idx: JSON.stringify({ doc }) };
}

// 取首个知识库 id；无则创建默认库（用于兜底归属）
function defaultKbId(): string {
  const first = db.prepare('SELECT id FROM knowledge_bases ORDER BY sort ASC, createdAt ASC LIMIT 1').get() as { id: string } | undefined;
  if (first) return first.id;
  return createKb(DEFAULT_KB_NAME).id;
}

// 解析知识点归属的知识库：优先用 kbId，其次按 cat 名查找/创建，最后落默认库
function resolveKbId(kbId?: string, cat?: string): string {
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

export function createKb(name: string): KnowledgeBase {
  const now = Date.now();
  const id = genId('kb');
  const maxRow = db.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM knowledge_bases').get() as { m: number };
  const kb: KnowledgeBase = { id, name: name.trim() || '未命名知识库', sort: Number(maxRow.m) + 1, createdAt: now, updatedAt: now };
  db.prepare('INSERT INTO knowledge_bases (id, name, sort, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)').run(id, kb.name, kb.sort, now, now);
  return kb;
}

export function renameKb(id: string, name: string): KnowledgeBase | null {
  if (!name.trim()) return null;
  const now = Date.now();
  db.prepare('UPDATE knowledge_bases SET name = ?, updatedAt = ? WHERE id = ?').run(name.trim(), now, id);
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

// ───────────────────────── 知识点 CRUD ─────────────────────────

export function listEntries(): Entry[] {
  const kbs = new Map(listKbs().map((k) => [k.id, k.name]));
  const rows = db.prepare('SELECT * FROM entries ORDER BY sort ASC, createdAt ASC').all() as unknown as EntryRow[];
  return rows.map((r) => rowToEntry(r, kbs.get(r.kbId ?? '')));
}

export function getEntry(id: string): Entry | null {
  const row = db.prepare('SELECT * FROM entries WHERE id = ?').get(id) as unknown as EntryRow | undefined;
  return row ? rowToEntry(row) : null;
}

export interface EntryInput {
  kbId?: string;
  folderId?: string | null;
  cat?: string;          // 兼容旧调用 / 旧导入：无 kbId 时按此名查找/创建知识库
  title: string;
  py?: string;
  tags?: string[];
  summary?: string;
  intro?: string;
  nodes?: IndexNode[];
  doc?: Block[];         // BlockNote 块文档(canonical;优先于 intro/nodes)
}

function deriveSummary(input: { summary?: string }, tree: IndexTree): string {
  if (input.summary && input.summary.trim()) return input.summary.trim();
  const firstIntro = tree.intro.split('\n').map((l) => l.trim()).find(Boolean);
  return firstIntro || tree.nodes[0]?.title || '自建知识点';
}

export function createEntry(input: EntryInput): Entry {
  const now = Date.now();
  const id = 'u' + now + Math.floor(Math.random() * 1000);
  const { doc, tree, idx } = buildDocIdx(input);
  const maxRow = db.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM entries').get() as { m: number };
  const kbId = resolveKbId(input.kbId, input.cat);
  const folderId = input.folderId ?? null;
  const entry: Entry = {
    id,
    cat: kbNameOf(kbId),
    kbId,
    folderId,
    title: input.title.trim(),
    py: (input.py || input.title).toLowerCase(),
    tags: input.tags || [],
    summary: deriveSummary(input, tree),
    intro: tree.intro,
    nodes: tree.nodes,
    doc,
    sort: Number(maxRow.m) + 1,
    createdAt: now,
    updatedAt: now,
  };
  db.prepare(
    `INSERT INTO entries (id, cat, kbId, folderId, title, py, tags, summary, body, idx, sort, createdAt, updatedAt)
     VALUES (:id, :cat, :kbId, :folderId, :title, :py, :tags, :summary, '', :idx, :sort, :createdAt, :updatedAt)`
  ).run({
    id: entry.id, cat: entry.cat, kbId: entry.kbId, folderId: entry.folderId,
    title: entry.title, py: entry.py,
    tags: JSON.stringify(entry.tags), summary: entry.summary,
    idx, sort: entry.sort, createdAt: now, updatedAt: now,
  });
  return entry;
}

// 按给定顺序重排（管理模块拖拽）。ids 为某作用域内的知识点 id 序列。
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
  // 内容来源优先级:显式 doc > 显式 intro/nodes > 保持原内容(仅改元数据时)
  const docSource = input.doc !== undefined
    ? { doc: input.doc }
    : (input.intro !== undefined || input.nodes !== undefined)
      ? { intro: input.intro ?? cur.intro, nodes: input.nodes ?? cur.nodes }
      : { doc: cur.doc };
  const { doc, tree, idx } = buildDocIdx(docSource);
  const nextTitle = input.title?.trim() ?? cur.title;
  // 标题变更且未显式给 py 时，按新标题重算拼音源，避免检索过期
  const nextPy = input.py != null
    ? input.py.toLowerCase()
    : (input.title != null ? nextTitle.toLowerCase() : cur.py);
  let nextSummary = input.summary ?? cur.summary;
  if (!nextSummary || !nextSummary.trim()) nextSummary = deriveSummary({}, tree);
  // 归属变更（仅当显式传入 kbId / folderId 时才改）
  const kbId = input.kbId !== undefined ? resolveKbId(input.kbId, input.cat) : cur.kbId;
  const folderId = input.folderId !== undefined ? (input.folderId ?? null) : cur.folderId;
  const next: Entry = {
    ...cur,
    cat: kbNameOf(kbId),
    kbId,
    folderId,
    title: nextTitle,
    py: nextPy,
    tags: input.tags ?? cur.tags,
    summary: nextSummary,
    intro: tree.intro,
    nodes: tree.nodes,
    doc,
    updatedAt: Date.now(),
  };
  db.prepare(
    `UPDATE entries SET cat=:cat, kbId=:kbId, folderId=:folderId, title=:title, py=:py, tags=:tags,
       summary=:summary, idx=:idx, updatedAt=:updatedAt WHERE id=:id`
  ).run({
    id: next.id, cat: next.cat, kbId: next.kbId, folderId: next.folderId,
    title: next.title, py: next.py,
    tags: JSON.stringify(next.tags), summary: next.summary,
    idx, updatedAt: next.updatedAt,
  });
  return next;
}

export function deleteEntry(id: string): boolean {
  const info = db.prepare('DELETE FROM entries WHERE id = ?').run(id);
  return Number(info.changes) > 0;
}

// ───────────── 资源(图片) ─────────────

export interface AssetMeta {
  id: string;
  kind: 'data' | 'external';
  mime: string;
  url: string;            // 统一对外可用地址(data → /api/assets/:id/raw；external → 原 url)
  width: number | null;
  height: number | null;
  alt: string;
  size: number;
  createdAt: number;
}

function assetRowToMeta(r: Record<string, unknown>): AssetMeta {
  const kind = r.kind === 'external' ? 'external' : 'data';
  return {
    id: String(r.id),
    kind,
    mime: String(r.mime ?? ''),
    url: kind === 'external' ? String(r.url ?? '') : `/api/assets/${String(r.id)}/raw`,
    width: r.width == null ? null : Number(r.width),
    height: r.height == null ? null : Number(r.height),
    alt: String(r.alt ?? ''),
    size: Number(r.size ?? 0),
    createdAt: Number(r.createdAt ?? 0),
  };
}

// 落库一张 data:base64 图片(按内容哈希去重),返回元信息(含站内 url)
export function createDataAsset(dataUrl: string, alt = ''): AssetMeta | null {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return null;
  const hash = sha256(parsed.bytes);
  const existing = db.prepare('SELECT * FROM assets WHERE hash = ? AND kind = \'data\' LIMIT 1').get(hash) as Record<string, unknown> | undefined;
  if (existing) return assetRowToMeta(existing);
  const size = sniffImageSize(parsed.bytes);
  const id = 'as_' + hash.slice(0, 16);
  db.prepare(
    `INSERT OR IGNORE INTO assets (id, kind, mime, hash, data, url, width, height, alt, size, createdAt)
     VALUES (:id, 'data', :mime, :hash, :data, NULL, :width, :height, :alt, :size, :createdAt)`
  ).run({
    id, mime: parsed.mime, hash, data: parsed.bytes,
    width: size?.width ?? null, height: size?.height ?? null,
    alt, size: parsed.bytes.length, createdAt: Date.now(),
  });
  const row = db.prepare('SELECT * FROM assets WHERE id = ?').get(id) as Record<string, unknown>;
  return assetRowToMeta(row);
}

// 登记一个外链图片(不下载,仅存引用)
export function registerExternalAsset(url: string, alt = ''): AssetMeta {
  const id = 'ax_' + sha256(Buffer.from(url)).slice(0, 16);
  db.prepare(
    `INSERT OR IGNORE INTO assets (id, kind, mime, hash, data, url, width, height, alt, size, createdAt)
     VALUES (:id, 'external', '', NULL, NULL, :url, NULL, NULL, :alt, 0, :createdAt)`
  ).run({ id, url, alt, createdAt: Date.now() });
  const row = db.prepare('SELECT * FROM assets WHERE id = ?').get(id) as Record<string, unknown>;
  return assetRowToMeta(row);
}

// 统一入口:把任意图片地址(data: / 外链)收敛成站内可用的稳定 url
export function ingestImageSrc(src: string, alt = ''): AssetMeta | null {
  const ref = classifyImageSrc(src);
  if (!ref) return null;
  if (ref.kind === 'data' && ref.dataUrl) return createDataAsset(ref.dataUrl, alt);
  if (ref.kind === 'external' && ref.url) return registerExternalAsset(ref.url, alt);
  return null;
}

export function getAsset(id: string): AssetMeta | null {
  const row = db.prepare('SELECT * FROM assets WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? assetRowToMeta(row) : null;
}

export function getAssetBytes(id: string): { mime: string; bytes: Buffer } | null {
  const row = db.prepare('SELECT mime, data FROM assets WHERE id = ? AND kind = \'data\'').get(id) as { mime: string; data: Buffer } | undefined;
  if (!row || !row.data) return null;
  return { mime: row.mime, bytes: Buffer.from(row.data) };
}

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

export interface ImportKb { id?: string; name: string; sort?: number; }
export interface ImportFolder { id?: string; kbId?: string; parentId?: string | null; name: string; sort?: number; }
export interface ImportPayload {
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
  kbs: KnowledgeBase[];
  folders: Folder[];
  entries: Entry[];
}

export function exportData(): ExportPayload {
  return {
    version: 'kb-export-2',
    exportedAt: Date.now(),
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

// 把 markdown 里内联的 data:base64 图片落库为 assets,内容只保留站内引用 url(去重,避免 JSON 膨胀)
function rewriteDataImages(md: string): string {
  if (!md || !md.includes('data:')) return md;
  return md.replace(/!\[([^\]]*)\]\((data:[^)]+)\)/g, (full, alt: string, src: string) => {
    const asset = createDataAsset(src, alt);
    return asset ? `![${alt}](${asset.url})` : full;
  });
}
function rewriteTreeImages(tree: IndexTree): IndexTree {
  const walk = (nodes: IndexNode[]): void => {
    for (const n of nodes) { n.content = rewriteDataImages(n.content); walk(n.children); }
  };
  tree.intro = rewriteDataImages(tree.intro);
  walk(tree.nodes);
  return tree;
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
    'INSERT OR IGNORE INTO knowledge_bases (id, name, sort, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)'
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
    }

    // 1) 知识库
    const kbIdMap = new Map<string, string>();   // 载荷原 id → 实际入库 id
    for (const k of payload.kbs ?? []) {
      const now = Date.now();
      if (k.id) {
        insertKb.run(k.id, k.name, k.sort ?? 0, now, now);
        kbIdMap.set(k.id, k.id);
      } else {
        const kb = ensureKb(k.name);
        kbIdMap.set(k.name, kb.id);
      }
    }
    // 兜底知识库：在导入的知识库就绪后再取，避免 replace 清空后凭空多建一个默认库
    const fallbackKbId = defaultKbId();

    // 2) 文件夹：按依赖多趟建入（先建父、再建子），未就绪的父降级为根
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

    // 3) 知识点
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

// ───────────────────────── 种子数据 ─────────────────────────

// 按版本导入知识库；旧种子的 markdown 正文在写入时转换为结构化索引。
// 种子统一归入「面试知识库」，并按 cat 自动建立根文件夹（与一次性迁移保持一致）。
export function seedBuiltins(): void {
  const applied = new Set(
    (db.prepare('SELECT version FROM seed_migrations').all() as { version: string }[]).map((row) => row.version)
  );
  const count = db.prepare('SELECT COUNT(*) AS n FROM entries').get() as { n: number };
  const defaultKb = ensureKb(DEFAULT_KB_NAME);
  const insert = db.prepare(
    `INSERT INTO entries (id, cat, kbId, folderId, title, py, tags, summary, body, idx, sort, createdAt, updatedAt)
     VALUES (:id, :cat, :kbId, :folderId, :title, :py, :tags, :summary, :body, :idx, :sort, :createdAt, :updatedAt)`
  );
  const updateBuiltin = db.prepare(
    `UPDATE entries SET cat=:cat, kbId=:kbId, folderId=:folderId, py=:py, tags=:tags,
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
          const catName = (e.cat && e.cat.trim()) || '未分类';
          const folder = ensureFolder(defaultKb.id, catName, null);
          const kbId = defaultKb.id;
          const folderId = folder.id;
          const values = {
            id: e.id, cat: defaultKb.name, kbId, folderId, title: e.title, py: e.py,
            tags: JSON.stringify(e.tags), summary: e.summary, body: e.body, idx,
            sort: now, createdAt: now, updatedAt: now,
          };
          if (library.overwrite) {
            const info = updateBuiltin.run({
              id: e.id, cat: defaultKb.name, kbId, folderId, py: e.py,
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
