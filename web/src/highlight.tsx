import React from 'react';
import { pinyin } from 'pinyin-pro';

interface Range {
  start: number;
  end: number;
}

interface CharacterMeta {
  value: string;
  start: number;
  end: number;
}

const HAN_RE = /[\u3400-\u9fff]/u;

const markStyle: React.CSSProperties = {
  background: 'color-mix(in srgb, var(--accent) 26%, transparent)',
  color: 'inherit',
  borderRadius: 5,
  padding: '0 3px',
  fontWeight: 720,
  boxDecorationBreak: 'clone',
  WebkitBoxDecorationBreak: 'clone',
};

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function compact(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '');
}

function terms(rawQuery: string): string[] {
  const q = normalize(rawQuery);
  if (!q) return [];
  const parts = q.split(/\s+/).filter(Boolean);
  return Array.from(new Set([q, compact(q), ...parts]));
}

function characterMeta(text: string): CharacterMeta[] {
  const out: CharacterMeta[] = [];
  let cursor = 0;
  for (const value of Array.from(text)) {
    const start = cursor;
    cursor += value.length;
    out.push({ value, start, end: cursor });
  }
  return out;
}

function addDirectRanges(text: string, term: string, ranges: Range[]): void {
  if (!term) return;
  const lower = text.toLowerCase();
  let index = lower.indexOf(term);
  while (index >= 0) {
    ranges.push({ start: index, end: index + term.length });
    index = lower.indexOf(term, index + Math.max(1, term.length));
  }
}

function buildPinyinStream(chars: CharacterMeta[], mode: 'initial' | 'full'): { value: string; charAt: number[] } {
  let value = '';
  const charAt: number[] = [];

  chars.forEach((ch, index) => {
    if (!HAN_RE.test(ch.value)) return;
    const py = pinyin(ch.value, {
      pattern: mode === 'initial' ? 'first' : 'pinyin',
      toneType: 'none',
    }).toLowerCase();
    const normalized = compact(py);
    for (const letter of normalized) {
      value += letter;
      charAt.push(index);
    }
  });

  return { value, charAt };
}

function addPinyinRanges(text: string, term: string, ranges: Range[]): void {
  if (term.length < 2 || !HAN_RE.test(text)) return;
  const chars = characterMeta(text);
  const streams = [
    buildPinyinStream(chars, 'initial'),
    buildPinyinStream(chars, 'full'),
  ];

  for (const stream of streams) {
    if (!stream.value) continue;
    let index = stream.value.indexOf(term);
    while (index >= 0) {
      const startChar = stream.charAt[index];
      const endChar = stream.charAt[index + term.length - 1];
      if (startChar != null && endChar != null) {
        ranges.push({ start: chars[startChar].start, end: chars[endChar].end });
      }
      index = stream.value.indexOf(term, index + Math.max(1, term.length));
    }
  }
}

function mergeRanges(ranges: Range[]): Range[] {
  if (!ranges.length) return [];
  const sorted = ranges
    .filter((range) => range.start < range.end)
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: Range[] = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || range.start > previous.end) {
      merged.push({ ...range });
    } else {
      previous.end = Math.max(previous.end, range.end);
    }
  }
  return merged;
}

export function highlightRanges(text: string, rawQuery: string): Range[] {
  if (!text || !rawQuery.trim()) return [];
  const ranges: Range[] = [];
  for (const term of terms(rawQuery)) {
    addDirectRanges(text, term, ranges);
    addPinyinRanges(text, term, ranges);
  }
  return mergeRanges(ranges);
}

export function highlightText(text: string, rawQuery: string): React.ReactNode {
  const ranges = highlightRanges(text, rawQuery);
  if (!ranges.length) return text;

  const out: React.ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((range, index) => {
    if (range.start > cursor) out.push(text.slice(cursor, range.start));
    out.push(
      <mark key={`hit-${index}-${range.start}`} style={markStyle}>
        {text.slice(range.start, range.end)}
      </mark>
    );
    cursor = range.end;
  });
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}
