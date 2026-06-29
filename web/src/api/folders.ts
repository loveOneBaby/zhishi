import type { Folder } from '../types';
import { apiDelJson, apiGetKey, apiPostKey, apiPutKey } from './client';
import type { AiKnowledgeBaseJob } from './aiJobs';

// ───────────── 文件夹 CRUD ─────────────

export async function fetchFolders(): Promise<Folder[]> {
  return apiGetKey<Folder[]>('/folders', 'folders');
}
export async function createFolder(input: { kbId: string; parentId?: string | null; name: string }): Promise<Folder> {
  return apiPostKey<Folder>('/folders', input, 'folder');
}
export async function renameFolder(id: string, name: string): Promise<Folder> {
  return apiPutKey<Folder>(`/folders/${encodeURIComponent(id)}`, { name }, 'folder');
}
export async function moveFolder(id: string, opts: { parentId?: string | null; kbId?: string }): Promise<Folder[]> {
  return apiPostKey<Folder[]>('/folders/move', { id, ...opts }, 'folders');
}
export interface DeleteFolderResult {
  ok: true;
  folderIds: string[];
  entryIds: string[];
}

export async function deleteFolder(id: string): Promise<DeleteFolderResult> {
  return apiDelJson(`/folders/${encodeURIComponent(id)}`);
}
export async function reorderFolders(ids: string[]): Promise<Folder[]> {
  return apiPostKey<Folder[]>('/folders/reorder', { ids }, 'folders');
}

// ───────────── AI 初始化目录 ─────────────

export interface InitKnowledgeBaseFoldersInput {
  kbId: string;
  parentId?: string | null;
  domain?: string;
  folderCount?: number;
}

export async function startInitKnowledgeBaseFoldersJob(input: InitKnowledgeBaseFoldersInput): Promise<AiKnowledgeBaseJob> {
  return apiPostKey<AiKnowledgeBaseJob>(
    `/kbs/${encodeURIComponent(input.kbId)}/folders/init/jobs`,
    { parentId: input.parentId ?? null, domain: input.domain, folderCount: input.folderCount },
    'job',
  );
}

// ───────────── AI 按目录生成知识点 ─────────────

export interface GenerateKnowledgePointsFromFoldersInput {
  kbId: string;
  parentId?: string | null;
  domain?: string;
}

export async function startGenerateKnowledgePointsFromFoldersJob(input: GenerateKnowledgePointsFromFoldersInput): Promise<AiKnowledgeBaseJob> {
  return apiPostKey<AiKnowledgeBaseJob>(
    `/kbs/${encodeURIComponent(input.kbId)}/folders/entries/jobs`,
    { parentId: input.parentId ?? null, domain: input.domain },
    'job',
  );
}

// ───────────── AI 一键生成目录和知识点 ─────────────

export interface GenerateFoldersAndKnowledgePointsInput {
  kbId: string;
  parentId?: string | null;
  domain?: string;
  folderCount?: number;
}

export async function startGenerateFoldersAndKnowledgePointsJob(input: GenerateFoldersAndKnowledgePointsInput): Promise<AiKnowledgeBaseJob> {
  return apiPostKey<AiKnowledgeBaseJob>(
    `/kbs/${encodeURIComponent(input.kbId)}/folders/full/jobs`,
    { parentId: input.parentId ?? null, domain: input.domain, folderCount: input.folderCount },
    'job',
  );
}
