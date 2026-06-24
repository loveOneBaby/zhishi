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
