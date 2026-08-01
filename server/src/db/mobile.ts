import { db } from './client.js';

export async function recordEntryView(entryId: string): Promise<number | null> {
  const exists = await db.prepare('SELECT 1 FROM entries WHERE id = ?').get(entryId);
  if (!exists) return null;
  const now = Date.now();
  await db.prepare(`
    INSERT INTO entry_view_stats (entryId, views, updatedAt) VALUES (?, 1, ?)
    ON CONFLICT(entryId) DO UPDATE SET views = entry_view_stats.views + 1, updatedAt = excluded.updatedAt
  `).run(entryId, now);
  const row = await db.prepare('SELECT views FROM entry_view_stats WHERE entryId = ?').get(entryId) as { views: number } | undefined;
  return Number(row?.views ?? 0);
}

export async function listKbViewCounts(): Promise<Record<string, number>> {
  const rows = await db.prepare(`
    SELECT e.kbId AS kbId, COALESCE(SUM(v.views), 0) AS views
    FROM entries e
    LEFT JOIN entry_view_stats v ON v.entryId = e.id
    GROUP BY e.kbId
  `).all() as Array<{ kbId: string; views: number }>;
  return Object.fromEntries(rows.map((row) => [row.kbId, Number(row.views)]));
}
