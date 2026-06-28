import { db, rowToEntry, kbNameOf } from './client.js';
import { resolveKbId, listKbs } from './kb.js';
import { buildDocIdx } from './doc-write.js';
import type { Entry, EntryRow, IndexNode } from '../types.js';
import type { Block } from '../blocks.js';
import type { IndexTree } from '../index-tree.js';

// ───────────────────────── 知识点 CRUD ─────────────────────────

// 内存缓存：避免短时间内重复查询 Turso（远程数据库有 100-200ms 延迟）
let entriesCache: { data: Entry[]; ts: number } | null = null;
const CACHE_TTL = 5000; // 5 秒缓存
const DETAIL_CACHE_TTL = 5 * 60_000; // 单条详情读多写少，写操作会主动清理
let entriesRefresh: Promise<Entry[]> | null = null;
let cacheVersion = 0;
const entryDetailCache = new Map<string, { data: Entry; ts: number; version: number }>();

async function refreshEntriesCache(): Promise<Entry[]> {
  const now = Date.now();
  const version = cacheVersion;
  const kbs = new Map((await listKbs()).map((k) => [k.id, k.name]));
  const rows = await db.prepare('SELECT * FROM entries ORDER BY sort ASC, createdAt ASC').all() as unknown as EntryRow[];
  const entries = await Promise.all(rows.map((r) => rowToEntry(r, kbs.get(r.kbId ?? ''))));
  if (version === cacheVersion) {
    entriesCache = { data: entries, ts: now };
    entryDetailCache.clear();
    for (const entry of entries) entryDetailCache.set(entry.id, { data: entry, ts: now, version });
  }
  return entries;
}

export async function listEntries(): Promise<Entry[]> {
  const now = Date.now();
  if (entriesCache && now - entriesCache.ts < CACHE_TTL) return entriesCache.data;
  if (entriesCache) {
    scheduleEntriesRefresh();
    return entriesCache.data;
  }
  if (!entriesRefresh) entriesRefresh = refreshEntriesCache().finally(() => { entriesRefresh = null; });
  return entriesRefresh;
}

// 后台预热完整详情缓存：列表页仍返回轻量 summaries，但用户点击详情时尽量从内存命中。
export function warmEntriesCache(): Promise<Entry[]> {
  if (entriesCache && Date.now() - entriesCache.ts < CACHE_TTL) return Promise.resolve(entriesCache.data);
  if (!entriesRefresh) entriesRefresh = refreshEntriesCache().finally(() => { entriesRefresh = null; });
  return entriesRefresh;
}

function scheduleEntriesRefresh(): void {
  if (entriesRefresh) return;
  setTimeout(() => {
    if (entriesRefresh || !entriesCache) return;
    entriesRefresh = refreshEntriesCache()
      .catch((err) => {
        console.warn('[db] 后台刷新 entries 缓存失败:', err);
        return entriesCache?.data ?? [];
      })
      .finally(() => { entriesRefresh = null; });
  }, 0);
}

// 轻量列表：只返回列表页需要的字段（不含 doc/intro/nodes），响应体从 7MB 降到 ~100KB
export interface EntrySummary {
  id: string;
  cat: string;
  kbId: string;
  folderId: string | null;
  title: string;
  py: string;
  tags: string[];
  summary: string;
  sort: number;
  createdAt: number;
  updatedAt: number;
}

let summaryCache: { data: EntrySummary[]; ts: number } | null = null;
let summaryRefresh: Promise<EntrySummary[]> | null = null;

async function refreshSummaryCache(): Promise<EntrySummary[]> {
  const now = Date.now();
  const version = cacheVersion;
  const kbs = new Map((await listKbs()).map((k) => [k.id, k.name]));
  const rows = await db.prepare('SELECT id, cat, kbId, folderId, title, py, tags, summary, sort, createdAt, updatedAt FROM entries ORDER BY sort ASC, createdAt ASC').all() as unknown as EntryRow[];
  const summaries: EntrySummary[] = rows.map((r) => {
    let tags: string[] = [];
    try { tags = JSON.parse(r.tags); } catch { tags = []; }
    return {
      id: r.id,
      cat: kbs.get(r.kbId ?? '') ?? '未分类',
      kbId: r.kbId ?? '',
      folderId: r.folderId ?? null,
      title: r.title,
      py: r.py,
      tags,
      summary: r.summary,
      sort: r.sort ?? r.createdAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  });
  if (version === cacheVersion) summaryCache = { data: summaries, ts: now };
  return summaries;
}

export async function listEntrySummaries(): Promise<EntrySummary[]> {
  const now = Date.now();
  if (summaryCache && now - summaryCache.ts < CACHE_TTL) return summaryCache.data;
  if (summaryCache) {
    scheduleSummaryRefresh();
    return summaryCache.data;
  }
  if (!summaryRefresh) summaryRefresh = refreshSummaryCache().finally(() => { summaryRefresh = null; });
  return summaryRefresh;
}

function scheduleSummaryRefresh(): void {
  if (summaryRefresh) return;
  setTimeout(() => {
    if (summaryRefresh || !summaryCache) return;
    summaryRefresh = refreshSummaryCache()
      .catch((err) => {
        console.warn('[db] 后台刷新 entry summaries 缓存失败:', err);
        return summaryCache?.data ?? [];
      })
      .finally(() => { summaryRefresh = null; });
  }, 0);
}

function rememberEntryDetail(entry: Entry): void {
  entryDetailCache.set(entry.id, { data: entry, ts: Date.now(), version: cacheVersion });
}

function parseStoredTags(value: string): string[] {
  try {
    const tags = JSON.parse(value);
    return Array.isArray(tags) ? tags.map((tag) => String(tag).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

// 写操作后清除缓存
export function clearEntriesCache(): void {
  cacheVersion += 1;
  entriesCache = null;
  summaryCache = null;
  entriesRefresh = null;
  summaryRefresh = null;
  entryDetailCache.clear();
}

export async function getEntry(id: string): Promise<Entry | null> {
  const now = Date.now();
  const cached = entryDetailCache.get(id);
  if (cached && cached.version === cacheVersion && now - cached.ts < DETAIL_CACHE_TTL) return cached.data;

  const listCache = entriesCache;
  const listCached = listCache?.data.find((entry) => entry.id === id);
  if (listCached && listCache && now - listCache.ts < CACHE_TTL) {
    entryDetailCache.set(id, { data: listCached, ts: now, version: cacheVersion });
    return listCached;
  }

  if (entriesRefresh) {
    const fresh = (await entriesRefresh).find((entry) => entry.id === id) ?? null;
    if (fresh) {
      entryDetailCache.set(id, { data: fresh, ts: Date.now(), version: cacheVersion });
      return fresh;
    }
  }

  const row = await db.prepare(`
    SELECT entries.*, knowledge_bases.name AS kbName
    FROM entries
    LEFT JOIN knowledge_bases ON knowledge_bases.id = entries.kbId
    WHERE entries.id = ?
  `).get(id) as unknown as (EntryRow & { kbName?: string | null }) | undefined;
  if (!row) return null;
  const entry = await rowToEntry(row, row.kbName ?? '未分类');
  entryDetailCache.set(id, { data: entry, ts: Date.now(), version: cacheVersion });
  return entry;
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

export function deriveSummary(input: { summary?: string }, tree: IndexTree): string {
  if (input.summary && input.summary.trim()) return input.summary.trim();
  const firstIntro = tree.intro.split('\n').map((l) => l.trim()).find(Boolean);
  return firstIntro || tree.nodes[0]?.title || '自建知识点';
}

export async function createEntry(input: EntryInput): Promise<Entry> {
  const now = Date.now();
  const id = 'u' + now + Math.floor(Math.random() * 1000);
  const { doc, tree, idx } = await buildDocIdx(input);
  const maxRow = await db.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM entries').get() as { m: number };
  const kbId = await resolveKbId(input.kbId, input.cat);
  const folderId = input.folderId ?? null;
  const entry: Entry = {
    id,
    cat: await kbNameOf(kbId),
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
  await db.prepare(
    `INSERT INTO entries (id, cat, kbId, folderId, title, py, tags, summary, body, idx, sort, createdAt, updatedAt)
     VALUES (:id, :cat, :kbId, :folderId, :title, :py, :tags, :summary, '', :idx, :sort, :createdAt, :updatedAt)`
  ).run({
    id: entry.id, cat: entry.cat, kbId: entry.kbId, folderId: entry.folderId,
    title: entry.title, py: entry.py,
    tags: JSON.stringify(entry.tags), summary: entry.summary,
    idx, sort: entry.sort, createdAt: now, updatedAt: now,
  });
  clearEntriesCache();
  rememberEntryDetail(entry);
  return entry;
}

// 按给定顺序重排（管理模块拖拽）。ids 为某作用域内的知识点 id 序列。
export async function reorderEntries(ids: string[]): Promise<void> {
  const stmt = db.prepare('UPDATE entries SET sort = :sort WHERE id = :id');
  await db.tx(async () => {
    for (const [index, id] of ids.entries()) await stmt.run({ id, sort: index });
  });
  clearEntriesCache();
}

export async function updateEntry(id: string, input: Partial<EntryInput>): Promise<Entry | null> {
  const cur = await getEntry(id);
  if (!cur) return null;
  // 内容来源优先级:显式 doc > 显式 intro/nodes > 保持原内容(仅改元数据时)
  const docSource = input.doc !== undefined
    ? { doc: input.doc }
    : (input.intro !== undefined || input.nodes !== undefined)
      ? { intro: input.intro ?? cur.intro, nodes: input.nodes ?? cur.nodes }
      : { doc: cur.doc };
  const { doc, tree, idx } = await buildDocIdx(docSource);
  const nextTitle = input.title?.trim() ?? cur.title;
  // 标题变更且未显式给 py 时，按新标题重算拼音源，避免检索过期
  const nextPy = input.py != null
    ? input.py.toLowerCase()
    : (input.title != null ? nextTitle.toLowerCase() : cur.py);
  let nextSummary = input.summary ?? cur.summary;
  if (!nextSummary || !nextSummary.trim()) nextSummary = deriveSummary({}, tree);
  // 归属变更（仅当显式传入 kbId / folderId 时才改）
  const kbId = input.kbId !== undefined ? await resolveKbId(input.kbId, input.cat) : cur.kbId;
  const folderId = input.folderId !== undefined ? (input.folderId ?? null) : cur.folderId;
  const next: Entry = {
    ...cur,
    cat: await kbNameOf(kbId),
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
  await db.prepare(
    `UPDATE entries SET cat=:cat, kbId=:kbId, folderId=:folderId, title=:title, py=:py, tags=:tags,
       summary=:summary, idx=:idx, updatedAt=:updatedAt WHERE id=:id`
  ).run({
    id: next.id, cat: next.cat, kbId: next.kbId, folderId: next.folderId,
    title: next.title, py: next.py,
    tags: JSON.stringify(next.tags), summary: next.summary,
    idx, updatedAt: next.updatedAt,
  });
  clearEntriesCache();
  rememberEntryDetail(next);
  return next;
}

export async function deleteEntry(id: string): Promise<boolean> {
  const info = await db.prepare('DELETE FROM entries WHERE id = ?').run(id);
  clearEntriesCache();
  return Number(info.changes) > 0;
}

export async function deleteTagFromKb(kbId: string, tag: string): Promise<number> {
  const target = tag.trim();
  if (!target) return 0;

  const rows = await db.prepare('SELECT id, tags FROM entries WHERE kbId = ?').all(kbId) as Array<Pick<EntryRow, 'id' | 'tags'>>;
  const updates = rows
    .map((row) => {
      const tags = parseStoredTags(row.tags);
      const nextTags = tags.filter((item) => item !== target);
      return { id: row.id, tags: nextTags, changed: nextTags.length !== tags.length };
    })
    .filter((row) => row.changed);

  if (!updates.length) return 0;

  const now = Date.now();
  const stmt = db.prepare('UPDATE entries SET tags = :tags, updatedAt = :updatedAt WHERE id = :id');
  await db.tx(async () => {
    for (const row of updates) {
      await stmt.run({ id: row.id, tags: JSON.stringify(row.tags), updatedAt: now });
    }
  });
  clearEntriesCache();
  return updates.length;
}
