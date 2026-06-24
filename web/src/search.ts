import type { Entry } from './types';

// 客户端检索逻辑，与服务端保持一致：保证逐字输入时的即时响应。
function subseq(q: string, h: string): boolean {
  let i = 0;
  for (let j = 0; j < h.length && i < q.length; j++) {
    if (h[j] === q[i]) i++;
  }
  return i === q.length;
}

export function score(e: Entry, q: string): number {
  const t = (e.title || '').toLowerCase();
  const py = (e.py || '').toLowerCase();
  const h = (t + ' ' + py + ' ' + (e.tags || []).join(' ') + ' ' + e.cat + ' ' + (e.summary || '')).toLowerCase();
  if (t.startsWith(q)) return 100;
  if (py.split(' ').some((w) => w.startsWith(q))) return 90;
  if (t.includes(q)) return 80;
  if (py.includes(q)) return 70;
  if (h.includes(q)) return 50;
  if (subseq(q, h)) return 20;
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
