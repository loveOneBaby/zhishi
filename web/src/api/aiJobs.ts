import type { Entry, Folder, KnowledgeBase } from '../types';
import { apiDelJson, apiGetKey, apiPostKey } from './client';

// AI 建库/初始化目录的保存结果(与 AiKnowledgeBaseJob.result 同构,故同放此处避免循环依赖)
export interface GenerateKnowledgeBaseResult {
  kb: KnowledgeBase;
  folders: Folder[];
  entries: Entry[];
}

export type AiJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

// AI 分析(诊断 + 建议)类型,与 AiKnowledgeBaseJob.analysis 同放,避免循环依赖
export type KbSuggestionKind = 'create-folder' | 'rename-folder' | 'create-entry' | 'rewrite-entry' | 'refine-entry' | 'note';

export interface KbSuggestion {
  id: string;
  kind: KbSuggestionKind;
  title: string;
  detail: string;
  folderId?: string | null;
  entryId?: string;
  name?: string;
}

export interface KbAnalysis {
  overview: string;
  scores: { structure: number; coverage: number; depth: number };
  scoreLabels?: [string, string, string];
  suggestions: KbSuggestion[];
}

export interface AiKnowledgeBaseJob {
  id: string;
  kind: 'kb-generate' | 'folder-init' | 'folder-entries' | 'analyze';
  domain: string;
  questionCount: number;
  kbId?: string;
  kbName?: string;
  entryId?: string;
  parentId?: string | null;
  targetPath?: string;
  status: AiJobStatus;
  logs: string[];
  modelOutput: string;
  parsed?: { kbName: string; folders: number; questions: number };
  result?: GenerateKnowledgeBaseResult;
  analysis?: KbAnalysis;
  resumable?: boolean;
  error?: string;
  createdAt: number;
  updatedAt: number;
  startedAt: number;
  durationMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
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

export async function clearAiJobHistory(): Promise<AiKnowledgeBaseJob[]> {
  const data = await apiDelJson<{ jobs: AiKnowledgeBaseJob[] }>('/ai/jobs/history');
  return data.jobs;
}
