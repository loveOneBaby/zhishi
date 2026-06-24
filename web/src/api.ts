import type { Entry, EntryInput, IndexNode, KnowledgeBase, Folder } from './types';

const BASE = '/api';

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `请求失败 ${res.status}`;
    try { const d = await res.json(); if (d?.error) msg = d.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

// ───────────── 知识库 ─────────────

export async function fetchKbs(): Promise<KnowledgeBase[]> {
  const data = await j<{ kbs: KnowledgeBase[] }>(await fetch(`${BASE}/kbs`));
  return data.kbs;
}

export async function createKb(name: string): Promise<KnowledgeBase> {
  const res = await fetch(`${BASE}/kbs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return j<{ kb: KnowledgeBase }>(res).then((d) => d.kb);
}

export async function renameKb(id: string, name: string): Promise<KnowledgeBase> {
  const res = await fetch(`${BASE}/kbs/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return j<{ kb: KnowledgeBase }>(res).then((d) => d.kb);
}

export async function deleteKb(id: string): Promise<{ kbs: KnowledgeBase[]; folders: Folder[]; entries: Entry[] }> {
  const res = await fetch(`${BASE}/kbs/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return j(res);
}

export async function reorderKbs(ids: string[]): Promise<KnowledgeBase[]> {
  const res = await fetch(`${BASE}/kbs/reorder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  return j<{ kbs: KnowledgeBase[] }>(res).then((d) => d.kbs);
}

// ───────────── 文件夹 ─────────────

export async function fetchFolders(): Promise<Folder[]> {
  const data = await j<{ folders: Folder[] }>(await fetch(`${BASE}/folders`));
  return data.folders;
}

export async function createFolder(input: { kbId: string; parentId?: string | null; name: string }): Promise<Folder> {
  const res = await fetch(`${BASE}/folders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return j<{ folder: Folder }>(res).then((d) => d.folder);
}

export async function renameFolder(id: string, name: string): Promise<Folder> {
  const res = await fetch(`${BASE}/folders/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return j<{ folder: Folder }>(res).then((d) => d.folder);
}

export async function moveFolder(id: string, opts: { parentId?: string | null; kbId?: string }): Promise<Folder[]> {
  const res = await fetch(`${BASE}/folders/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...opts }),
  });
  return j<{ folders: Folder[] }>(res).then((d) => d.folders);
}

export async function deleteFolder(id: string): Promise<{ folders: Folder[]; entries: Entry[] }> {
  const res = await fetch(`${BASE}/folders/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return j(res);
}

export async function reorderFolders(ids: string[]): Promise<Folder[]> {
  const res = await fetch(`${BASE}/folders/reorder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  return j<{ folders: Folder[] }>(res).then((d) => d.folders);
}

// ───────────── 知识点 ─────────────

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

export interface ExportPayload {
  version: string;
  exportedAt: number;
  kbs: KnowledgeBase[];
  folders: Folder[];
  entries: Entry[];
}

export async function exportAll(): Promise<ExportPayload> {
  return j<ExportPayload>(await fetch(`${BASE}/export`));
}

// 导入载荷：新格式 = entries（BlockNote 块文档）；兼容旧 knowledge-tree-v1（meta + tree）
export interface ImportPayload {
  version?: string;
  meta?: unknown;
  tree?: unknown[];
  entries?: unknown[];
  assets?: unknown[];
  targetKbId?: string;
  targetKbName?: string;
}

export interface ImportResult {
  ok: boolean;
  imported: number;
  kbs: KnowledgeBase[];
  folders: Folder[];
  entries: Entry[];
}

export async function importAll(payload: ImportPayload, replace: boolean): Promise<ImportResult> {
  const res = await fetch(`${BASE}/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, replace }),
  });
  return j<ImportResult>(res);
}

// 导入预览：解析载荷但不写库，返回将导入的条目与统计。与 importAll 同构输入。
export interface PreviewEntry {
  id?: string;
  cat: string;
  kbId?: string;
  folderId?: string | null;
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

// 上传图片(转 dataURL → /api/assets 落库去重),返回站内可用 url
export async function uploadAsset(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
  const res = await fetch(`${BASE}/assets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataUrl, alt: file.name }),
  });
  const data = await j<{ asset: { url: string } }>(res);
  return data.asset.url;
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
