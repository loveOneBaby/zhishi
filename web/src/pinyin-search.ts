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

// 把查询拆成多个「针脚」：原文 / 去空格 / 拼音全拼 / 拼音首字母等。
// 命中任一即视为匹配（不能把 toSearchText(query) 整串当作单个子串去比对）。
export function buildNeedles(query: string): string[] {
  const input = (query || '').trim();
  if (!input) return [];
  const lower = input.toLowerCase();
  const compactInput = lower.replace(/\s+/g, '');
  const needles = new Set<string>([lower, compactInput]);
  // 仅用「整词」拼音形式：全拼连写(duolu) 与 首字母(dl)；
  // 不拆成单音节(duo/lu)，否则「多问题」「多跳推理」里的「多」也会误命中。
  if (HAN_RE.test(input)) {
    const initials = compact(
      pinyin(input, { pattern: 'first', toneType: 'none', type: 'array' }).map((s) => String(s).toLowerCase()).join('')
    );
    const full = compact(
      pinyin(input, { toneType: 'none', type: 'array' }).map((s) => String(s).toLowerCase()).join('')
    );
    if (full) needles.add(full);
    if (initials && initials.length > 1) needles.add(initials);
  }
  return Array.from(needles).filter(Boolean);
}

// haystack 应当是 toSearchText(...) 生成的可检索文本
export function matchesQuery(haystack: string, query: string): boolean {
  const needles = buildNeedles(query);
  if (!needles.length) return true;
  return needles.some((needle) => haystack.includes(needle));
}
