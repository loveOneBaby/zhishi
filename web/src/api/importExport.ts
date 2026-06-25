import type { Entry, Folder, IndexNode, KnowledgeBase } from '../types';
import { apiGetJson, apiPostJson, apiPostKey } from './client';

export interface ExportPayload {
  version: string;
  exportedAt: number;
  kbs: KnowledgeBase[];
  folders: Folder[];
  entries: Entry[];
}

export async function exportAll(): Promise<ExportPayload> {
  return apiGetJson<ExportPayload>('/export');
}

// 导入载荷:新格式 = entries(BlockNote 块文档);兼容旧 knowledge-tree-v1(meta + tree)
export interface ImportPayload {
  version?: string;
  meta?: unknown;
  package?: unknown;
  schema?: unknown;
  containers?: unknown[];
  extensions?: unknown;
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
