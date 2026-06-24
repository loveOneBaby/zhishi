import type { Entry, IndexNode } from './types';

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

// 知识点录入 / 编辑的输入。summary、py 可留空，服务端会自动推导。
export interface EntryInput {
  title: string;
  cat: string;
  tags: string[];
  summary?: string;
  py?: string;
  intro?: string;
  nodes?: IndexNode[];
}

// 兼容旧引用
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
