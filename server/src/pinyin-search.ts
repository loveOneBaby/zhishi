import { pinyin } from 'pinyin-pro';

const cache = new Map<string, string>();
const HAN_RE = /[\u3400-\u9fff]/;

function compact(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '');
}

export function toSearchText(...parts: Array<unknown>): string {
  const source = parts
    .filter((part) => part != null)
    .map((part) => String(part))
    .join(' ')
    .trim();
  if (!source) return '';

  const cached = cache.get(source);
  if (cached) return cached;

  const lower = source.toLowerCase();
  if (!HAN_RE.test(source)) {
    cache.set(source, lower);
    return lower;
  }

  const initialArray = pinyin(source, { pattern: 'first', toneType: 'none', type: 'array' })
    .map((item) => String(item).toLowerCase());
  const fullArray = pinyin(source, { toneType: 'none', type: 'array' })
    .map((item) => String(item).toLowerCase());
  const searchable = [
    lower,
    compact(initialArray.join('')),
    compact(fullArray.join('')),
    fullArray.join(' '),
  ].filter(Boolean).join(' ');

  cache.set(source, searchable);
  return searchable;
}

// 把查询拆成多个「针脚」：原文 / 去空格 / 拼音全拼 / 拼音首字母。
// 仅使用整词形式，避免「多路」被拆成「多」后误命中「多问题」。
export function buildNeedles(query: string): string[] {
  const input = (query || '').trim();
  if (!input) return [];
  const lower = input.toLowerCase();
  const compactInput = lower.replace(/\s+/g, '');
  const needles = new Set<string>([lower, compactInput]);
  if (HAN_RE.test(input)) {
    const initials = compact(
      pinyin(input, { pattern: 'first', toneType: 'none', type: 'array' })
        .map((s) => String(s).toLowerCase())
        .join('')
    );
    const full = compact(
      pinyin(input, { toneType: 'none', type: 'array' })
        .map((s) => String(s).toLowerCase())
        .join('')
    );
    if (full) needles.add(full);
    if (initials && initials.length > 1) needles.add(initials);
  }
  return Array.from(needles).filter(Boolean);
}

export function matchesQuery(haystack: string, query: string): boolean {
  const needles = buildNeedles(query);
  if (!needles.length) return true;
  return needles.some((needle) => haystack.includes(needle));
}
