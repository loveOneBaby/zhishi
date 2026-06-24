import type { Entry, IndexNode } from './types';
import { buildNeedles, matchesQuery, toSearchText } from './pinyin-search';

export interface SearchSuggestion {
  value: string;
  label: string;
  kind: string;
  hint: string;
  entryId?: string;
}

// 递归收集索引节点标题
function indexTitles(nodes: IndexNode[]): string[] {
  const out: string[] = [];
  const walk = (ns: IndexNode[]): void => { for (const n of ns) { out.push(n.title); walk(n.children); } };
  walk(nodes);
  return out;
}

// 索引全文（标题 + 内容，含引言）
function indexText(e: Entry): string {
  const parts: string[] = [e.intro];
  const walk = (ns: IndexNode[]): void => { for (const n of ns) { parts.push(n.title, n.content); walk(n.children); } };
  walk(e.nodes);
  return parts.filter(Boolean).join(' ');
}

export function score(e: Entry, q: string): number {
  const needles = buildNeedles(q);
  if (!needles.length) return -1;
  const t = toSearchText(e.title);
  const py = toSearchText(e.py);
  const idx = indexText(e);
  const h = [
    toSearchText(e.title, e.py, (e.tags || []).join(' '), e.cat, e.summary, indexTitles(e.nodes).join(' '), idx),
  ].join(' ');
  if (needles.some((needle) => t.startsWith(needle))) return 100;
  if (needles.some((needle) => py.split(/\s+/).some((w) => w.startsWith(needle)))) return 90;
  if (needles.some((needle) => t.includes(needle))) return 80;
  if (needles.some((needle) => py.includes(needle))) return 70;
  if (matchesQuery(h, q)) return 50;
  return -1;
}

export function filterEntries(all: Entry[], rawQuery: string): Entry[] {
  const q = (rawQuery || '').trim();
  if (!q) return all;
  return all
    .map((e) => ({ e, s: score(e, q) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s || a.e.title.localeCompare(b.e.title))
    .map((x) => x.e);
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
    for (const title of indexTitles(entry.nodes)) add(title, '索引', entry.title, entry, 78);
  }

  return Array.from(seen.values())
    .sort((a, b) => b.rank - a.rank || a.label.localeCompare(b.label))
    .slice(0, limit)
    .map(({ rank: _rank, ...item }) => item);
}
