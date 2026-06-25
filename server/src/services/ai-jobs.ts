import { randomUUID } from 'node:crypto';
import { getKb, listFolders, listStoredAiJobs, markInterruptedAiJobs, pruneStoredAiJobs, saveAiJob } from '../db.js';
import {
  generateKnowledgeBaseDraftStream,
  generateFolderTreeDraftStream,
  type GenerateKnowledgeBaseEvent,
  type GenerateFolderTreeEvent,
} from '../ai-generate.js';
import { createKnowledgeBaseFromDraft, createFoldersFromDraft, type GeneratedKnowledgeBaseResult } from './kb-draft-writer.js';
import { folderPathLabel } from './utils.js';

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
  result?: GeneratedKnowledgeBaseResult;
  error?: string;
  abortRequested?: boolean;
  createdAt: number;
  updatedAt: number;
}

markInterruptedAiJobs();
export const aiJobs = new Map<string, AiKnowledgeBaseJob>(
  listStoredAiJobs().map((job) => [job.id, job as AiKnowledgeBaseJob]),
);

const MAX_JOB_OUTPUT = 160_000;
const MAX_JOBS = 30;
const runningControllers = new Map<string, AbortController>();

function trimJobOutput(value: string): string {
  return value.length > MAX_JOB_OUTPUT ? value.slice(-MAX_JOB_OUTPUT) : value;
}

function persistJob(job: AiKnowledgeBaseJob): void {
  saveAiJob(job);
}

function touchJob(job: AiKnowledgeBaseJob): void {
  job.updatedAt = Date.now();
  persistJob(job);
}

function pushJobLog(job: AiKnowledgeBaseJob, message: string): void {
  const next = message.trim();
  if (!next) return;
  if (job.logs[job.logs.length - 1] !== next) job.logs.push(next);
  if (job.logs.length > 60) job.logs = job.logs.slice(-60);
  touchJob(job);
}

export function jobSnapshot(job: AiKnowledgeBaseJob): AiKnowledgeBaseJob {
  return {
    ...job,
    logs: [...job.logs],
    result: job.result ? {
      kb: job.result.kb,
      folders: [...job.result.folders],
      entries: [...job.result.entries],
    } : undefined,
  };
}

export function listJobSnapshots(): AiKnowledgeBaseJob[] {
  return [...aiJobs.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(jobSnapshot);
}

function pruneJobs(): void {
  const jobs = [...aiJobs.values()].sort((a, b) => b.createdAt - a.createdAt);
  const removable = jobs.slice(MAX_JOBS).filter((job) => job.status !== 'running' && job.status !== 'queued');
  for (const job of removable) aiJobs.delete(job.id);
  pruneStoredAiJobs(MAX_JOBS);
}

function createBaseJob(input: {
  kind: AiKnowledgeBaseJob['kind'];
  domain: string;
  questionCount?: number;
  kbId?: string;
  kbName?: string;
  parentId?: string | null;
  targetPath?: string;
  logs: string[];
}): AiKnowledgeBaseJob {
  const now = Date.now();
  return {
    id: `job_${now.toString(36)}_${randomUUID().slice(0, 8)}`,
    kind: input.kind,
    domain: input.domain,
    questionCount: input.questionCount ?? 0,
    kbId: input.kbId,
    kbName: input.kbName,
    parentId: input.parentId,
    targetPath: input.targetPath,
    status: 'queued',
    logs: input.logs,
    modelOutput: '',
    abortRequested: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function startKnowledgeBaseJob(domain: string, questionCount: number): AiKnowledgeBaseJob {
  const job = createBaseJob({
    kind: 'kb-generate',
    domain,
    questionCount,
    logs: ['任务已创建，等待后台执行'],
  });
  aiJobs.set(job.id, job);
  persistJob(job);
  pruneJobs();
  setTimeout(() => { void runKnowledgeBaseJob(job.id); }, 0);
  return job;
}

export function startFolderInitJob(input: {
  kbId: string;
  kbName: string;
  parentId: string | null;
  targetPath: string;
  domain: string;
  folderCount: number;
}): AiKnowledgeBaseJob {
  const job = createBaseJob({
    kind: 'folder-init',
    domain: input.domain,
    questionCount: input.folderCount,
    kbId: input.kbId,
    kbName: input.kbName,
    parentId: input.parentId,
    targetPath: input.targetPath,
    logs: ['目录初始化任务已创建，等待后台执行'],
  });
  aiJobs.set(job.id, job);
  persistJob(job);
  pruneJobs();
  setTimeout(() => { void runFolderInitJob(job.id, input.folderCount); }, 0);
  return job;
}

export function cancelAiJob(id: string): AiKnowledgeBaseJob | null {
  const job = aiJobs.get(id);
  if (!job) return null;
  if (job.status !== 'queued' && job.status !== 'running') return jobSnapshot(job);
  job.status = 'cancelled';
  job.error = '用户已取消任务';
  job.abortRequested = true;
  pushJobLog(job, '任务已取消');
  runningControllers.get(id)?.abort();
  return jobSnapshot(job);
}

export function retryAiJob(id: string): AiKnowledgeBaseJob | null {
  const job = aiJobs.get(id);
  if (!job) return null;
  if (job.kind === 'folder-init') {
    if (!job.kbId || !job.kbName) return null;
    return startFolderInitJob({
      kbId: job.kbId,
      kbName: job.kbName,
      parentId: job.parentId ?? null,
      targetPath: job.targetPath ?? folderPathLabel(job.parentId ?? null),
      domain: job.domain,
      folderCount: job.questionCount || 18,
    });
  }
  return startKnowledgeBaseJob(job.domain, job.questionCount || 18);
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || /abort|cancel/i.test(err.message));
}

function isJobCancelled(jobId: string): boolean {
  return aiJobs.get(jobId)?.status === 'cancelled';
}

async function runKnowledgeBaseJob(jobId: string): Promise<void> {
  const job = aiJobs.get(jobId);
  if (!job || job.status === 'cancelled') return;
  const controller = new AbortController();
  runningControllers.set(jobId, controller);
  job.status = 'running';
  job.abortRequested = false;
  pushJobLog(job, '后台任务已启动');
  try {
    const draft = await generateKnowledgeBaseDraftStream({
      domain: job.domain,
      questionCount: job.questionCount,
      signal: controller.signal,
    }, (event: GenerateKnowledgeBaseEvent) => {
      const current = aiJobs.get(jobId);
      if (!current || current.status === 'cancelled') return;
      if (event.type === 'stage') pushJobLog(current, event.message);
      if (event.type === 'model-delta') {
        current.modelOutput = trimJobOutput(`${current.modelOutput}${event.content}`);
        touchJob(current);
      }
      if (event.type === 'model-output') {
        current.modelOutput = trimJobOutput(event.content);
        touchJob(current);
      }
      if (event.type === 'parsed-kb') {
        current.parsed = { kbName: event.kbName, folders: event.folders, questions: event.questions };
        pushJobLog(current, `解析完成：${event.kbName} · ${event.folders} 个目录 · ${event.questions} 道题`);
      }
    });
    if (isJobCancelled(jobId)) return;

    pushJobLog(job, '开始写入知识库');
    const result = createKnowledgeBaseFromDraft(job.domain, draft);
    job.result = result;
    job.status = 'succeeded';
    job.abortRequested = false;
    pushJobLog(job, `已完成：${result.kb.name} · ${result.folders.length} 个目录 · ${result.entries.length} 条知识点`);
    touchJob(job);
  } catch (err) {
    if (isJobCancelled(jobId) || isAbortError(err)) {
      job.status = 'cancelled';
      job.error = '用户已取消任务';
      pushJobLog(job, '任务已取消');
    } else {
      job.status = 'failed';
      job.error = err instanceof Error ? err.message : String(err);
      pushJobLog(job, job.error);
    }
    touchJob(job);
  } finally {
    runningControllers.delete(jobId);
  }
}

async function runFolderInitJob(jobId: string, folderCount: number): Promise<void> {
  const job = aiJobs.get(jobId);
  if (!job || job.status === 'cancelled') return;
  const controller = new AbortController();
  runningControllers.set(jobId, controller);
  job.status = 'running';
  job.abortRequested = false;
  pushJobLog(job, '后台目录初始化已启动');
  try {
    if (!job.kbId) throw new Error('知识库不存在');
    const kb = getKb(job.kbId);
    if (!kb) throw new Error('知识库不存在');
    const existingFolders = listFolders()
      .filter((folder) => folder.kbId === kb.id)
      .map((folder) => folderPathLabel(folder.id));
    const draft = await generateFolderTreeDraftStream({
      domain: job.domain,
      kbName: kb.name,
      targetPath: job.targetPath,
      existingFolders,
      folderCount,
      signal: controller.signal,
    }, (event: GenerateFolderTreeEvent) => {
      const current = aiJobs.get(jobId);
      if (!current || current.status === 'cancelled') return;
      if (event.type === 'stage') pushJobLog(current, event.message);
      if (event.type === 'model-delta') {
        current.modelOutput = trimJobOutput(`${current.modelOutput}${event.content}`);
        touchJob(current);
      }
      if (event.type === 'model-output') {
        current.modelOutput = trimJobOutput(event.content);
        touchJob(current);
      }
      if (event.type === 'parsed-folders') {
        current.parsed = { kbName: kb.name, folders: event.folders, questions: 0 };
        pushJobLog(current, `解析完成：${event.title} · ${event.folders} 个目录路径`);
      }
    });
    if (isJobCancelled(jobId)) return;

    pushJobLog(job, '开始写入文件目录');
    const result = createFoldersFromDraft(kb, job.parentId ?? null, draft);
    job.result = result;
    job.status = 'succeeded';
    job.abortRequested = false;
    pushJobLog(job, `已完成：${kb.name} · ${result.folders.length} 个目录`);
    touchJob(job);
  } catch (err) {
    if (isJobCancelled(jobId) || isAbortError(err)) {
      job.status = 'cancelled';
      job.error = '用户已取消任务';
      pushJobLog(job, '任务已取消');
    } else {
      job.status = 'failed';
      job.error = err instanceof Error ? err.message : String(err);
      pushJobLog(job, job.error);
    }
    touchJob(job);
  } finally {
    runningControllers.delete(jobId);
  }
}
