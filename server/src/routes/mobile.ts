import type { Router } from 'express';
import { asyncHandler } from '../app.js';
import { listEntrySummaries, listKbCategories, listKbs } from '../db.js';
import { buildNeedles, matchesQuery, toSearchText } from '../pinyin-search.js';

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 60;

type NavigationTarget = {
  id: string;
  title: string;
  cat: string;
  kbId: string;
};

function toNavigationTarget(entry: { id: string; title: string; cat: string; kbId: string }): NavigationTarget {
  return {
    id: entry.id,
    title: entry.title,
    cat: entry.cat,
    kbId: entry.kbId,
  };
}

function buildEntryNavigation(
  allEntries: Array<{ id: string; title: string; cat: string; kbId: string }>,
  entryId: string,
): { previous: NavigationTarget | null; next: NavigationTarget | null } {
  const current = allEntries.find((entry) => entry.id === entryId);
  if (!current) return { previous: null, next: null };

  const sameKbEntries = allEntries.filter((entry) => entry.kbId === current.kbId);
  const index = sameKbEntries.findIndex((entry) => entry.id === entryId);
  if (index < 0) return { previous: null, next: null };

  return {
    previous: index > 0 ? toNavigationTarget(sameKbEntries[index - 1]) : null,
    next: index + 1 < sameKbEntries.length ? toNavigationTarget(sameKbEntries[index + 1]) : null,
  };
}

export function mobilePageParams(query: Record<string, unknown>): { limit: number; offset: number } {
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(query.limit) || DEFAULT_LIMIT));
  const offset = Math.max(0, Number(query.offset) || 0);
  return { limit: Math.floor(limit), offset: Math.floor(offset) };
}

export function registerMobileRoutes(api: Router): void {
  api.get('/mobile/bootstrap', asyncHandler(async (_req, res) => {
    const [entries, kbs, kbCategories] = await Promise.all([listEntrySummaries(), listKbs(), listKbCategories()]);
    const counts = entries.reduce<Record<string, number>>((result, entry) => {
      result[entry.kbId] = (result[entry.kbId] ?? 0) + 1;
      return result;
    }, {});
    res.json({ kbs, kbCategories, counts, recommendations: entries.slice(0, 12), totalEntries: entries.length });
  }));

  api.get('/mobile/entries', asyncHandler(async (req, res) => {
    const { limit, offset } = mobilePageParams(req.query as Record<string, unknown>);
    const kbId = String(req.query.kbId ?? '').trim();
    const kbIds = String(req.query.kbIds ?? '').split(',').map((id) => id.trim()).filter(Boolean);
    const allowed = new Set(kbIds);
    const all = await listEntrySummaries();
    const filtered = all.filter((entry) => (!kbId || entry.kbId === kbId) && (allowed.size === 0 || allowed.has(entry.kbId)));
    res.json({ entries: filtered.slice(offset, offset + limit), total: filtered.length, offset, limit });
  }));

  api.get('/mobile/search', asyncHandler(async (req, res) => {
    const { limit, offset } = mobilePageParams(req.query as Record<string, unknown>);
    const q = String(req.query.q ?? '').trim();
    if (!q) return res.json({ entries: [], total: 0, offset, limit });
    const needles = buildNeedles(q);
    const results = (await listEntrySummaries()).map((entry) => {
      const title = toSearchText(entry.title);
      const py = toSearchText(entry.py);
      const haystack = toSearchText(entry.title, entry.py, entry.tags.join(' '), entry.cat, entry.summary);
      const score = needles.some((needle) => title.startsWith(needle)) ? 100
        : needles.some((needle) => py.split(/\s+/).some((word) => word.startsWith(needle))) ? 90
          : needles.some((needle) => title.includes(needle)) ? 80
            : needles.some((needle) => py.includes(needle)) ? 70
              : matchesQuery(haystack, q) ? 50 : -1;
      return { entry, score };
    }).filter((item) => item.score >= 0)
      .sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title))
      .map((item) => item.entry);
    res.json({
      entries: results.slice(offset, offset + limit),
      total: results.length,
      offset,
      limit,
    });
  }));

  api.get('/mobile/entry/:id/navigation', asyncHandler(async (req, res) => {
    const entryId = String(req.params.id ?? '').trim();
    if (!entryId) return res.json({ previous: null, next: null });
    const all = await listEntrySummaries();
    const navigation = buildEntryNavigation(all, entryId);
    res.json({ previous: navigation.previous, next: navigation.next });
  }));
}
