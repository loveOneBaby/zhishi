import { db } from './client.js';
import { getEntry, updateEntry, type EntryInput } from './entry.js';
import type { Entry } from '../types.js';

export interface EntryVersion {
  id: string;
  entryId: string;
  source: string;
  title: string;
  summary: string;
  tags: string[];
  snapshot: EntryInput;
  createdAt: number;
}

db.exec(`
  CREATE TABLE IF NOT EXISTS entry_versions (
    id        TEXT PRIMARY KEY,
    entryId   TEXT NOT NULL,
    source    TEXT NOT NULL,
    title     TEXT NOT NULL,
    summary   TEXT NOT NULL DEFAULT '',
    tags      TEXT NOT NULL DEFAULT '[]',
    snapshot  TEXT NOT NULL,
    createdAt INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_entry_versions_entry ON entry_versions(entryId, createdAt DESC);
`);

function versionId(): string {
  return `ver_${Date.now().toString(36)}_${Math.floor(Math.random() * 100000).toString(36)}`;
}

function entryToSnapshot(entry: Entry): EntryInput {
  return {
    title: entry.title,
    kbId: entry.kbId,
    folderId: entry.folderId,
    cat: entry.cat,
    py: entry.py,
    tags: entry.tags,
    summary: entry.summary,
    doc: entry.doc,
  };
}

function parseTags(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function rowToVersion(row: Record<string, unknown>): EntryVersion {
  let snapshot: EntryInput;
  try {
    snapshot = JSON.parse(String(row.snapshot ?? '{}')) as EntryInput;
  } catch {
    snapshot = { title: String(row.title ?? ''), tags: [] };
  }
  return {
    id: String(row.id),
    entryId: String(row.entryId),
    source: String(row.source ?? 'manual'),
    title: String(row.title ?? snapshot.title ?? ''),
    summary: String(row.summary ?? snapshot.summary ?? ''),
    tags: parseTags(String(row.tags ?? '[]')),
    snapshot,
    createdAt: Number(row.createdAt ?? 0),
  };
}

export function createEntryVersion(entry: Entry, source = 'manual'): EntryVersion {
  const version: EntryVersion = {
    id: versionId(),
    entryId: entry.id,
    source,
    title: entry.title,
    summary: entry.summary,
    tags: entry.tags,
    snapshot: entryToSnapshot(entry),
    createdAt: Date.now(),
  };
  db.prepare(`
    INSERT INTO entry_versions (id, entryId, source, title, summary, tags, snapshot, createdAt)
    VALUES (:id, :entryId, :source, :title, :summary, :tags, :snapshot, :createdAt)
  `).run({
    id: version.id,
    entryId: version.entryId,
    source: version.source,
    title: version.title,
    summary: version.summary,
    tags: JSON.stringify(version.tags),
    snapshot: JSON.stringify(version.snapshot),
    createdAt: version.createdAt,
  });
  return version;
}

export function listEntryVersions(entryId: string): EntryVersion[] {
  const rows = db.prepare('SELECT * FROM entry_versions WHERE entryId = ? ORDER BY createdAt DESC').all(entryId) as Record<string, unknown>[];
  return rows.map(rowToVersion);
}

export function getEntryVersion(entryId: string, versionId: string): EntryVersion | null {
  const row = db.prepare('SELECT * FROM entry_versions WHERE entryId = ? AND id = ?').get(entryId, versionId) as Record<string, unknown> | undefined;
  return row ? rowToVersion(row) : null;
}

export function restoreEntryVersion(entryId: string, versionId: string): Entry | null {
  const current = getEntry(entryId);
  const version = getEntryVersion(entryId, versionId);
  if (!current || !version) return null;
  createEntryVersion(current, 'restore-backup');
  return updateEntry(entryId, version.snapshot);
}
