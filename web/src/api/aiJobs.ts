import type { Entry, Folder, KnowledgeBase } from '../types';
import { apiGetKey, apiPostKey } from './client';

// AI 建库/初始化目录的保存结果(与 AiKnowledgeBaseJob.result 同构,故同放此处避免循环依赖)
export interface GenerateKnowledgeBaseResult {
  kb: KnowledgeBase;
  folders: Folder[];
  entries: Entry[];
}

export type AiJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface AiKnowledgeBaseJob {
  id: string;
  kind: 'kb-generate' | 'folder-init';
  domain: string;
  questionCount: number;
  kbId?: string;
  kbName?: string;
  parentId?: string | null;
  targetPath?: string;
  status: AiJobStatus;
  logs: string[];
  modelOutput: string;
  parsed?: { kbName: string; folders: number; questions: number };
  result?: GenerateKnowledgeBaseResult;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export async function fetchAiJobs(): Promise<AiKnowledgeBaseJob[]> {
  return apiGetKey<AiKnowledgeBaseJob[]>('/ai/jobs', 'jobs');
}

export async function fetchAiJob(id: string): Promise<AiKnowledgeBaseJob> {
  return apiGetKey<AiKnowledgeBaseJob>(`/ai/jobs/${encodeURIComponent(id)}`, 'job');
}

export async function cancelAiJob(id: string): Promise<AiKnowledgeBaseJob> {
  return apiPostKey<AiKnowledgeBaseJob>(`/ai/jobs/${encodeURIComponent(id)}/cancel`, {}, 'job');
}

export async function retryAiJob(id: string): Promise<AiKnowledgeBaseJob> {
  return apiPostKey<AiKnowledgeBaseJob>(`/ai/jobs/${encodeURIComponent(id)}/retry`, {}, 'job');
}
