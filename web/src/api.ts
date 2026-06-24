import type { Entry, EntryInput, IndexNode } from './types';

const BASE = '/api';

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `请求失败 ${res.status}`;
    try { const d = await res.json(); if (d?.error) msg = d.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export async function fetchEntries(): Promise<Entry[]> {
  const data = await j<{ entries: Entry[] }>(await fetch(`${BASE}/entries`));
  return data.entries;
}

// 兼容旧引用
export type { EntryInput };
export type NewEntryInput = EntryInput;

export async function createEntry(input: EntryInput): Promise<Entry> {
  const res = await fetch(`${BASE}/entries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await j<{ entry: Entry }>(res);
  return data.entry;
}

export async function updateEntry(id: string, input: EntryInput): Promise<Entry> {
  const res = await fetch(`${BASE}/entries/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await j<{ entry: Entry }>(res);
  return data.entry;
}

export async function deleteEntry(id: string): Promise<void> {
  const res = await fetch(`${BASE}/entries/${encodeURIComponent(id)}`, { method: 'DELETE' });
  await j<{ ok: boolean }>(res);
}

// 按给定顺序重排，返回重排后的全量列表
export async function reorderEntries(ids: string[]): Promise<Entry[]> {
  const res = await fetch(`${BASE}/entries/reorder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  const data = await j<{ entries: Entry[] }>(res);
  return data.entries;
}

// 重命名知识库，返回更新后的全量列表
export async function renameCategory(from: string, to: string): Promise<Entry[]> {
  const res = await fetch(`${BASE}/categories/rename`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to }),
  });
  const data = await j<{ entries: Entry[] }>(res);
  return data.entries;
}

// 删除知识库（及其下全部知识点），返回更新后的全量列表
export async function deleteCategory(name: string): Promise<Entry[]> {
  const res = await fetch(`${BASE}/categories/${encodeURIComponent(name)}`, { method: 'DELETE' });
  const data = await j<{ entries: Entry[] }>(res);
  return data.entries;
}

export interface ExportPayload {
  version: string;
  exportedAt: number;
  entries: Entry[];
}

export async function exportAll(): Promise<ExportPayload> {
  return j<ExportPayload>(await fetch(`${BASE}/export`));
}

// 导入载荷：兼容 kb-import-2（带 version / assets）与旧的纯 entries 数组
export interface ImportPayload {
  version?: string;
  assets?: unknown[];
  entries: unknown[];
}

export async function importAll(payload: ImportPayload, replace: boolean): Promise<Entry[]> {
  const res = await fetch(`${BASE}/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, replace }),
  });
  const data = await j<{ entries: Entry[] }>(res);
  return data.entries;
}

// 导入预览：解析载荷但不写库，返回将导入的条目与统计。与 importAll 同构输入。
export interface PreviewEntry {
  id?: string;
  cat: string;
  title: string;
  tags: string[];
  summary: string;
  intro: string;
  nodes: IndexNode[];
  exists: boolean;   // id 命中已有 → 将更新；否则新增
  valid: boolean;    // 标题非空 → 有效；否则导入时会被跳过
}

export interface ImportPreview {
  total: number;
  valid: number;
  skipped: number;
  newCount: number;
  updateCount: number;
  byCat: { cat: string; count: number }[];
  entries: PreviewEntry[];
}

export async function previewImport(payload: ImportPayload): Promise<ImportPreview> {
  const res = await fetch(`${BASE}/import/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await j<{ preview: ImportPreview }>(res);
  return data.preview;
}

export interface AskResponse {
  configured: boolean;
  answer: string;
}

export async function askAI(query: string): Promise<AskResponse> {
  const res = await fetch(`${BASE}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  return j<AskResponse>(res);
}
