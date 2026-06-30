import type { Entry, Folder, IndexNode, KnowledgeBase, KbCategory } from '../types';
import { apiFetch, apiGetJson, apiPostJson, apiPostKey, j } from './client';

export interface ExportPayload {
  version: string;
  exportedAt: number;
  kbCategories?: KbCategory[];
  kbs: KnowledgeBase[];
  folders: Folder[];
  entries: Entry[];
}

export async function exportAll(): Promise<ExportPayload> {
  return apiGetJson<ExportPayload>('/export');
}

export interface ExportProgressEvent {
  phase: 'request' | 'download' | 'parse';
  loaded: number;
  total?: number;
  percent: number;
  label: string;
}

export async function exportAllWithProgress(onProgress?: (event: ExportProgressEvent) => void): Promise<ExportPayload> {
  onProgress?.({ phase: 'request', loaded: 0, percent: 8, label: '准备导出' });
  const res = await apiFetch('/export');
  if (!res.ok) return j<ExportPayload>(res);

  const total = Number(res.headers.get('content-length') ?? 0) || undefined;
  const reader = res.body?.getReader();
  if (!reader) {
    onProgress?.({ phase: 'download', loaded: 0, total, percent: 65, label: '接收数据' });
    const payload = await res.json() as ExportPayload;
    onProgress?.({ phase: 'parse', loaded: total ?? 0, total, percent: 82, label: '解析导出数据' });
    return payload;
  }

  const chunks: Uint8Array[] = [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.byteLength;
      const downloadPercent = total ? Math.min(76, 18 + Math.round((loaded / total) * 58)) : Math.min(72, 18 + chunks.length * 4);
      onProgress?.({ phase: 'download', loaded, total, percent: downloadPercent, label: total ? '下载导出数据' : `下载导出数据 ${Math.round(loaded / 1024)} KB` });
    }
  }

  onProgress?.({ phase: 'parse', loaded, total, percent: 82, label: '解析导出数据' });
  const text = new TextDecoder().decode(concatChunks(chunks, loaded));
  return JSON.parse(text) as ExportPayload;
}

function concatChunks(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

// 导入载荷:新格式 = entries(BlockNote 块文档);兼容旧 knowledge-tree-v1(meta + tree)
export interface ImportPayload {
  version?: string;
  meta?: unknown;
  package?: unknown;
  schema?: unknown;
  containers?: unknown[];
  extensions?: unknown;
  kbCategories?: unknown[];
  kbs?: unknown[];
  folders?: unknown[];
  tree?: unknown[];
  entries?: unknown[];
  assets?: unknown[];
  targetKbId?: string;
  targetKbName?: string;
  targetFolderId?: string | null;
  importBatchId?: string;
}

export interface ImportResult {
  ok: boolean;
  imported: number;
  kbCategories?: KbCategory[];
  kbs: KnowledgeBase[];
  folders: Folder[];
  entries: Entry[];
}

export async function importAll(payload: ImportPayload, replace: boolean): Promise<ImportResult> {
  return apiPostJson<ImportResult>('/import', { ...payload, replace });
}

// 导入预览:解析载荷但不写库,返回将导入的条目与统计。与 importAll 同构输入。
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
  exists: boolean;   // id 命中已有 → 将更新;否则新增
  valid: boolean;    // 标题非空 → 有效;否则导入时会被跳过
}

export interface ImportPreview {
  total: number;
  valid: number;
  skipped: number;
  newCount: number;
  updateCount: number;
  byCat: { cat: string; count: number }[];
  folders: {
    id?: string;
    kbId?: string;
    parentId?: string | null;
    name: string;
    path: string;
  }[];
  entries: PreviewEntry[];
}

export async function previewImport(payload: ImportPayload): Promise<ImportPreview> {
  return apiPostKey<ImportPreview>('/import/preview', payload, 'preview');
}
