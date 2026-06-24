import type { Entry } from './types.js';
import { toSearchText } from './pinyin-search.js';
import { indexText } from './index-tree.js';

// 打分逻辑：标题前缀 > 拼音词前缀 > 标题包含 > 拼音包含 > 全文(含索引)包含
export function score(e: Entry, q: string): number {
  const t = toSearchText(e.title);
  const py = toSearchText(e.py);
  const idxText = indexText({ intro: e.intro, nodes: e.nodes });
  const h = [
    toSearchText(e.title, e.py, (e.tags || []).join(' '), e.cat, idxText),
    (e.summary || '').toLowerCase(),
    idxText.toLowerCase(),
  ].join(' ');
  if (t.startsWith(q)) return 100;
  if (py.split(' ').some((w) => w.startsWith(q))) return 90;
  if (t.includes(q)) return 80;
  if (py.includes(q)) return 70;
  if (h.includes(q)) return 50;
  return -1;
}

export function searchEntries(all: Entry[], rawQuery: string): Entry[] {
  const q = (rawQuery || '').trim().toLowerCase();
  if (!q) return all;
  return all
    .map((e) => ({ e, s: score(e, q) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s || a.e.title.localeCompare(b.e.title))
    .map((x) => x.e);
}
