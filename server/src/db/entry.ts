import { db, rowToEntry, kbNameOf } from './client.js';
import { resolveKbId, listKbs } from './kb.js';
import { buildDocIdx } from './doc-write.js';
import type { Entry, EntryRow, IndexNode } from '../types.js';
import type { Block } from '../blocks.js';
import type { IndexTree } from '../index-tree.js';

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

export function deriveSummary(input: { summary?: string }, tree: IndexTree): string {
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
