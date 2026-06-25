import type { Entry } from './types.js';
import { buildNeedles, matchesQuery, toSearchText } from './pinyin-search.js';
import { indexText } from './index-tree.js';
import { docText } from './doc.js';

// 打分逻辑：标题前缀 > 拼音词前缀 > 标题包含 > 拼音包含 > 全文(含索引)包含
export function score(e: Entry, q: string): number {
  const needles = buildNeedles(q);
  if (!needles.length) return -1;
  const t = toSearchText(e.title);
  const py = toSearchText(e.py);
  const idxText = indexText({ intro: e.intro, nodes: e.nodes });
  const richText = docText(e.doc ?? []);
  const h = [
    toSearchText(e.title, e.py, (e.tags || []).join(' '), e.cat, e.summary, idxText, richText),
  ].join(' ');
  if (needles.some((needle) => t.startsWith(needle))) return 100;
  if (needles.some((needle) => py.split(/\s+/).some((w) => w.startsWith(needle)))) return 90;
  if (needles.some((needle) => t.includes(needle))) return 80;
  if (needles.some((needle) => py.includes(needle))) return 70;
  if (matchesQuery(h, q)) return 50;
  return -1;
}

export function searchEntries(all: Entry[], rawQuery: string): Entry[] {
  const q = (rawQuery || '').trim();
  if (!q) return all;
  return all
    .map((e) => ({ e, s: score(e, q) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s || a.e.title.localeCompare(b.e.title))
    .map((x) => x.e);
}
