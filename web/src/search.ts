import type { Entry } from './types';
import { toSearchText } from './pinyin-search';

export interface SearchSuggestion {
  value: string;
  label: string;
  kind: string;
  hint: string;
  entryId?: string;
}

function headingTitles(body: string): string {
  return (body || '')
    .split('\n')
    .map((line) => plainText(/^(#{2,4})\s+(.+)$/.exec(line)?.[2] ?? ''))
    .filter(Boolean)
    .join(' ');
}

function plainText(value: string): string {
  return value
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/[*`]/g, '')
    .trim();
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

function headings(body: string): string[] {
  return (body || '')
    .split('\n')
    .map((line) => plainText(/^(#{2,4})\s+(.+)$/.exec(line)?.[2] ?? ''))
    .filter(Boolean);
}

export function suggestQueries(all: Entry[], rawQuery: string, limit = 8): SearchSuggestion[] {
  const input = (rawQuery || '').trim();
  if (!input) return [];

  const compactInput = input.toLowerCase().replace(/\s+/g, '');
  const needles = Array.from(new Set([
    input.toLowerCase(),
    compactInput,
    ...toSearchText(input).split(/\s+/),
  ].filter(Boolean)));

  const seen = new Map<string, SearchSuggestion & { rank: number }>();
  const matched = (value: string, extra = ''): boolean => {
    const haystack = toSearchText(value, extra);
    return needles.some((needle) => haystack.includes(needle));
  };
  const prefixBoost = (value: string): number => {
    const haystack = toSearchText(value);
    return needles.some((needle) => haystack.startsWith(needle) || haystack.split(/\s+/).some((word) => word.startsWith(needle))) ? 30 : 0;
  };
  const add = (value: string, kind: string, hint: string, entry: Entry | undefined, baseRank: number): void => {
    const label = value.trim();
    if (!label || !matched(label, entry ? `${entry.py} ${entry.tags.join(' ')} ${entry.cat}` : hint)) return;
    const key = `${kind}::${label}`;
    const candidate = {
      value: label,
      label,
      kind,
      hint,
      entryId: entry?.id,
      rank: baseRank + prefixBoost(label),
    };
    const previous = seen.get(key);
    if (!previous || candidate.rank > previous.rank) seen.set(key, candidate);
  };

  for (const entry of all) {
    add(entry.title, '知识点', `${entry.cat}${entry.tags[0] ? ` · ${entry.tags[0]}` : ''}`, entry, 90);
    add(entry.cat, '知识库', '分类', entry, 45);
    for (const tag of entry.tags) add(tag, '标签', entry.title, entry, 62);
    for (const title of headings(entry.body)) add(title, '面试点', entry.title, entry, 78);
  }

  return Array.from(seen.values())
    .sort((a, b) => b.rank - a.rank || a.label.localeCompare(b.label))
    .slice(0, limit)
    .map(({ rank: _rank, ...item }) => item);
}
