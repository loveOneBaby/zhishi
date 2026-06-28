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

export async function listEntries(): Promise<Entry[]> {
  const now = Date.now();
  if (entriesCache && now - entriesCache.ts < CACHE_TTL) {
    return entriesCache.data;
  }
  const kbs = new Map((await listKbs()).map((k) => [k.id, k.name]));
  const rows = await db.prepare('SELECT * FROM entries ORDER BY sort ASC, createdAt ASC').all() as unknown as EntryRow[];
  const entries = await Promise.all(rows.map((r) => rowToEntry(r, kbs.get(r.kbId ?? ''))));
  entriesCache = { data: entries, ts: now };
  return entries;
}

// 写操作后清除缓存
export function clearEntriesCache(): void {
  entriesCache = null;
}

export async function getEntry(id: string): Promise<Entry | null> {
  const row = await db.prepare('SELECT * FROM entries WHERE id = ?').get(id) as unknown as EntryRow | undefined;
  return row ? await rowToEntry(row) : null;
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
  return next;
}

export async function deleteEntry(id: string): Promise<boolean> {
  const info = await db.prepare('DELETE FROM entries WHERE id = ?').run(id);
  clearEntriesCache();
  return Number(info.changes) > 0;
}
