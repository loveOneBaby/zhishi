import { randomUUID } from 'node:crypto';
import { getKb, listEntries, listFolders, listStoredAiJobs, markInterruptedAiJobs, pruneStoredAiJobs, saveAiJob } from '../db.js';
import {
  generateEntryInputStream,
  generateFolderTreeDraftStream,
  generateKnowledgeBasePlanStream,
  type GenerateEntryEvent,
  type GenerateKnowledgeBaseEvent,
  type GenerateFolderTreeEvent,
  type GeneratedKbDraft,
} from '../ai-generate.js';
import { appendAiIllustration } from '../ai-image.js';
import { kbDraftFromModelOutput } from '../ai/parse.js';
import { createFoldersFromDraft, createKnowledgeBaseWriterFromDraft, createKnowledgeBaseWriterFromExisting, type GeneratedKnowledgeBaseResult } from './kb-draft-writer.js';
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
  plan?: GeneratedKbDraft;
  result?: GeneratedKnowledgeBaseResult;
  resumable?: boolean;
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
    resumable: job.kind === 'folder-init'
      ? Boolean(job.kbId && job.kbName)
      : canResumeKnowledgeBaseJob(job),
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

function scheduleJob(job: AiKnowledgeBaseJob): void {
  setTimeout(() => {
    if (job.kind === 'folder-init') void runFolderInitJob(job.id, job.questionCount || 18);
    else void runKnowledgeBaseJob(job.id);
  }, 0);
}

function hydrateKnowledgeBaseResult(job: AiKnowledgeBaseJob): GeneratedKnowledgeBaseResult | null {
  const kbId = job.result?.kb?.id ?? job.kbId;
  if (!kbId) return job.result ?? null;
  const kb = getKb(kbId) ?? job.result?.kb;
  if (!kb) return job.result ?? null;
  return {
    kb,
    folders: listFolders().filter((folder) => folder.kbId === kb.id),
    entries: listEntries().filter((entry) => entry.kbId === kb.id),
  };
}

function extractPlanFromOutput(job: AiKnowledgeBaseJob): GeneratedKbDraft | null {
  const raw = job.modelOutput.split(/\n---ENTRY\s+\d+\//)[0]?.trim();
  if (!raw) return null;
  try {
    return kbDraftFromModelOutput(raw, job.domain);
  } catch {
    return null;
  }
}

function canResumeKnowledgeBaseJob(job: AiKnowledgeBaseJob): boolean {
  return Boolean(job.plan || extractPlanFromOutput(job));
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
  scheduleJob(job);
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
  scheduleJob(job);
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
  if (job.status === 'queued' || job.status === 'running') return jobSnapshot(job);
  if (job.kind === 'folder-init') {
    if (!job.kbId || !job.kbName) return null;
    job.status = 'queued';
    job.error = undefined;
    job.abortRequested = false;
    pushJobLog(job, '重新提交目录初始化任务');
    scheduleJob(job);
    return jobSnapshot(job);
  }
  if (canResumeKnowledgeBaseJob(job)) {
    job.status = 'queued';
    job.error = undefined;
    job.abortRequested = false;
    pushJobLog(job, '重新提交任务，将从已有进度继续');
    scheduleJob(job);
    return jobSnapshot(job);
  }
  return startKnowledgeBaseJob(job.domain, job.questionCount || 18);
}

for (const job of aiJobs.values()) {
  if (job.status === 'queued') {
    pushJobLog(job, job.kind === 'folder-init' ? '服务已恢复，继续目录初始化任务' : '服务已恢复，继续 AI 建库任务');
    scheduleJob(job);
  }
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || /abort|cancel/i.test(err.message));
}

function isJobCancelled(jobId: string): boolean {
  return aiJobs.get(jobId)?.status === 'cancelled';
}

function updateJobResult(job: AiKnowledgeBaseJob, result: GeneratedKnowledgeBaseResult): void {
  job.result = {
    kb: result.kb,
    folders: [...result.folders],
    entries: [...result.entries],
  };
  touchJob(job);
}

function mergedTags(primary: string[] | undefined, fallback: string[] | undefined): string[] {
  const out: string[] = [];
  for (const tag of [...(primary ?? []), ...(fallback ?? [])]) {
    const next = String(tag ?? '').trim();
    if (next && !out.some((item) => item.toLowerCase() === next.toLowerCase())) out.push(next);
    if (out.length >= 8) break;
  }
  return out;
}

async function runKnowledgeBaseJob(jobId: string): Promise<void> {
  const job = aiJobs.get(jobId);
  if (!job || job.status === 'cancelled') return;
  if (runningControllers.has(jobId)) return;
  const controller = new AbortController();
  runningControllers.set(jobId, controller);
  job.status = 'running';
  job.abortRequested = false;
  pushJobLog(job, '后台任务已启动');
  try {
    let plan = job.plan ?? extractPlanFromOutput(job);
    const recoveredPlan = Boolean(plan);
    if (plan) {
      job.plan = plan;
      job.questionCount = plan.questions.length;
      job.parsed = { kbName: plan.kbName, folders: plan.folders.length, questions: plan.questions.length };
      pushJobLog(job, `已恢复规划：${plan.kbName} · ${plan.folders.length} 个目录 · ${plan.questions.length} 道题`);
    } else {
      plan = await generateKnowledgeBasePlanStream({
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
      job.plan = plan;
      job.questionCount = plan.questions.length;
      touchJob(job);
    }
    if (isJobCancelled(jobId)) return;

    pushJobLog(job, recoveredPlan ? 'LangChain Agent 第 2 步：恢复知识库和目录骨架' : 'LangChain Agent 第 2 步：创建知识库和目录骨架');
    const existingResult = recoveredPlan ? hydrateKnowledgeBaseResult(job) : null;
    const writer = existingResult
      ? createKnowledgeBaseWriterFromExisting(existingResult)
      : createKnowledgeBaseWriterFromDraft(plan);
    for (const folder of plan.folders) writer.ensurePath(folder.path);
    job.kbId = writer.kb.id;
    job.kbName = writer.kb.name;
    job.parsed = { kbName: writer.kb.name, folders: writer.folders.length, questions: writer.entries.length };
    updateJobResult(job, writer);
    pushJobLog(job, existingResult
      ? `已恢复写入进度：${writer.entries.length}/${plan.questions.length} 条知识点`
      : `目录骨架已写入：${writer.folders.length} 个目录`);

    const total = plan.questions.length;
    const startIndex = Math.min(writer.entries.length, total);
    if (startIndex >= total) {
      job.status = 'succeeded';
      job.abortRequested = false;
      pushJobLog(job, `已完成：${writer.kb.name} · ${writer.folders.length} 个目录 · ${writer.entries.length} 条知识点`);
      touchJob(job);
      return;
    }
    if (startIndex > 0) pushJobLog(job, `从第 ${startIndex + 1}/${total} 个知识点继续生成`);
    for (let index = startIndex; index < plan.questions.length; index += 1) {
      if (isJobCancelled(jobId)) return;
      const question = plan.questions[index];
      const targetPath = question.folderPath.join(' / ') || '根层级';
      pushJobLog(job, `LangChain Agent 第 3 步：生成知识点 ${index + 1}/${total} · ${question.title}`);
      job.modelOutput = trimJobOutput(`${job.modelOutput}\n\n---ENTRY ${index + 1}/${total}: ${question.title}---\n`);
      touchJob(job);
      const input = await generateEntryInputStream({
        topic: `${question.title}\n${question.question || question.summary}`,
        kbName: writer.kb.name,
        folderPath: targetPath,
        context: [],
        signal: controller.signal,
      }, (event: GenerateEntryEvent) => {
        const current = aiJobs.get(jobId);
        if (!current || current.status === 'cancelled') return;
        if (event.type === 'stage') pushJobLog(current, `知识点 ${index + 1}/${total}：${event.message}`);
        if (event.type === 'model-delta') {
          current.modelOutput = trimJobOutput(`${current.modelOutput}${event.content}`);
          touchJob(current);
        }
        if (event.type === 'model-output') {
          touchJob(current);
        }
        if (event.type === 'parsed') {
          pushJobLog(current, `知识点 ${index + 1}/${total} 解析完成：${event.title}`);
        }
      });
      if (isJobCancelled(jobId)) return;
      const illustrated = await appendAiIllustration({
        ...input,
        title: input.title || question.title,
        summary: input.summary || question.summary,
        tags: mergedTags(input.tags, question.tags),
      }, {
        title: input.title || question.title,
        summary: input.summary || question.summary,
        tags: mergedTags(input.tags, question.tags),
        kbName: writer.kb.name,
        folderPath: targetPath,
      }, controller.signal, (event) => {
        const current = aiJobs.get(jobId);
        if (!current || current.status === 'cancelled') return;
        if (event.type === 'image-stage') pushJobLog(current, `知识点 ${index + 1}/${total}：${event.message}`);
        if (event.type === 'image') pushJobLog(current, `知识点 ${index + 1}/${total} 图解已生成`);
      });
      const entry = writer.addEntry(illustrated, question.folderPath);
      job.parsed = { kbName: writer.kb.name, folders: writer.folders.length, questions: writer.entries.length };
      updateJobResult(job, writer);
      pushJobLog(job, `已新增知识点 ${index + 1}/${total}：${entry.title}`);
    }

    job.status = 'succeeded';
    job.abortRequested = false;
    pushJobLog(job, `已完成：${writer.kb.name} · ${writer.folders.length} 个目录 · ${writer.entries.length} 条知识点`);
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
