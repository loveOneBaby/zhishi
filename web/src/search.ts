import type { Entry } from './types';
import { toSearchText } from './pinyin-search';

function headingTitles(body: string): string {
  return (body || '')
    .split('\n')
    .map((line) => /^(#{2,4})\s+(.+)$/.exec(line)?.[2] ?? '')
    .filter(Boolean)
    .join(' ');
}

export function score(e: Entry, q: string): number {
  const t = toSearchText(e.title);
  const py = toSearchText(e.py);
  const h = [
    toSearchText(e.title, e.py, (e.tags || []).join(' '), e.cat, headingTitles(e.body)),
    (e.summary || '').toLowerCase(),
    (e.body || '').toLowerCase(),
  ].join(' ');
  if (t.startsWith(q)) return 100;
  if (py.split(' ').some((w) => w.startsWith(q))) return 90;
  if (t.includes(q)) return 80;
  if (py.includes(q)) return 70;
  if (h.includes(q)) return 50;
  return -1;
}

export function filterEntries(all: Entry[], rawQuery: string): Entry[] {
  const q = (rawQuery || '').trim().toLowerCase();
  if (!q) return all;
  return all
    .map((e) => ({ e, s: score(e, q) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s || a.e.title.localeCompare(b.e.title))
    .map((x) => x.e);
}
