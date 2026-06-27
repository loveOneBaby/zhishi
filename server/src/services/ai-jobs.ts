import { randomUUID } from 'node:crypto';
import {
  clearStoredAiJobHistory,
  createEntry,
  createEntryVersion,
  ensureFolder,
  getEntry,
  getFolder,
  getKb,
  listEntries,
  listFolders,
  listStoredAiJobs,
  markInterruptedAiJobs,
  pruneStoredAiJobs,
  renameFolder,
  saveAiJob,
  updateEntry,
} from '../db.js';
import {
  generateEntryInputStream,
  generateFolderTreeDraftStream,
  generateKnowledgeBasePlanStream,
  rewriteEntryInputStream,
  type GenerateEntryEvent,
  type GenerateKnowledgeBaseEvent,
  type GenerateFolderTreeEvent,
  type GeneratedKbDraft,
} from '../ai-generate.js';
import { appendAiIllustration } from '../ai-image.js';
import type { AiTokenUsage } from '../ai/types.js';
import { kbDraftFromModelOutput } from '../ai/parse.js';
import { createFoldersFromDraft, createKnowledgeBaseWriterFromDraft, createKnowledgeBaseWriterFromExisting, type GeneratedKnowledgeBaseResult } from './kb-draft-writer.js';
import { folderPathLabel } from './utils.js';
import { searchEntries } from '../search.js';
import { analyzeKnowledgeBase, analyzeEntry, type KbAnalysis } from '../ai-analyze.js';
import { planKnowledgeBaseEdit, type AgentEditAction } from '../ai-agent-edit.js';
import type { Folder } from '../types.js';

export type AiJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface AiKnowledgeBaseJob {
  id: string;
  kind: 'kb-generate' | 'folder-init' | 'folder-entries' | 'analyze' | 'agent-edit';
  domain: string;
  questionCount: number;
  kbId?: string;
  kbName?: string;
  entryId?: string;
  parentId?: string | null;
  targetPath?: string;
  instruction?: string;
  status: AiJobStatus;
  logs: string[];
  modelOutput: string;
  parsed?: { kbName: string; folders: number; questions: number };
  plan?: GeneratedKbDraft;
  result?: GeneratedKnowledgeBaseResult;
  analysis?: KbAnalysis;
  resumable?: boolean;
  error?: string;
  abortRequested?: boolean;
  createdAt: number;
  updatedAt: number;
  startedAt: number;
  durationMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export const aiJobs = new Map<string, AiKnowledgeBaseJob>();

const MAX_JOB_OUTPUT = 160_000;
const MAX_JOBS = 30;
const runningControllers = new Map<string, AbortController>();

function trimJobOutput(value: string): string {
  return value.length > MAX_JOB_OUTPUT ? value.slice(-MAX_JOB_OUTPUT) : value;
}

async function persistJob(job: AiKnowledgeBaseJob): Promise<void> {
  await saveAiJob(job);
}

async function touchJob(job: AiKnowledgeBaseJob): Promise<void> {
  job.updatedAt = Date.now();
  await persistJob(job);
}

// 仅更新内存日志并异步落库（流式回调中无法 await，内存状态即时可见即可）
function pushJobLog(job: AiKnowledgeBaseJob, message: string): Promise<void> {
  const next = message.trim();
  if (!next) return Promise.resolve();
  if (job.logs[job.logs.length - 1] !== next) job.logs.push(next);
  if (job.logs.length > 60) job.logs = job.logs.slice(-60);
  return touchJob(job);
}

// 进入 running 时重置本次执行的计时与 token 累计(覆盖首次 / 重试 / 服务重启恢复)
function resetJobStats(job: AiKnowledgeBaseJob): void {
  job.startedAt = Date.now();
  job.durationMs = 0;
  job.promptTokens = 0;
  job.completionTokens = 0;
  job.totalTokens = 0;
}

// 累加单次 AI 调用的 token 消耗并异步落库(流式回调中以 void 调用，与 pushJobLog 一致)
function recordUsage(job: AiKnowledgeBaseJob, usage: AiTokenUsage): Promise<void> {
  job.promptTokens += usage.promptTokens;
  job.completionTokens += usage.completionTokens;
  job.totalTokens += usage.totalTokens;
  return touchJob(job);
}

// 记录本次执行耗时(从 startedAt 起；未进入过 running 则回退到 createdAt)
function finishJobTimer(job: AiKnowledgeBaseJob): void {
  job.durationMs = Math.max(0, Date.now() - (job.startedAt || job.createdAt));
}

export async function jobSnapshot(job: AiKnowledgeBaseJob): Promise<AiKnowledgeBaseJob> {
  // 分析任务不绑定知识库结果(否则会误显示「进入知识库 / 实时写入」)
  const result = job.kind === 'analyze' ? null : await hydrateKnowledgeBaseResult(job);
  const kbExists = job.kbId ? Boolean(await getKb(job.kbId)) : false;
  const resumable = job.kind === 'analyze'
    ? (Boolean(job.entryId) || (Boolean(job.kbId && job.kbName) && kbExists))
    : job.kind === 'agent-edit'
      ? Boolean(job.kbId && job.instruction && kbExists)
    : job.kind === 'folder-init' || job.kind === 'folder-entries'
      ? (Boolean(job.kbId && job.kbName) && kbExists)
      : await canResumeKnowledgeBaseJob(job);
  return {
    ...job,
    resumable,
    logs: [...job.logs],
    result: result ? {
      kb: result.kb,
      folders: [...result.folders],
      entries: [...result.entries],
    } : undefined,
  };
}

export async function listJobSnapshots(): Promise<AiKnowledgeBaseJob[]> {
  const jobs = [...aiJobs.values()].sort((a, b) => b.createdAt - a.createdAt);
  return Promise.all(jobs.map(jobSnapshot));
}

export async function clearAiJobHistory(): Promise<AiKnowledgeBaseJob[]> {
  for (const [id, job] of aiJobs) {
    if (job.status !== 'queued' && job.status !== 'running') aiJobs.delete(id);
  }
  await clearStoredAiJobHistory();
  return listJobSnapshots();
}

async function pruneJobs(): Promise<void> {
  const jobs = [...aiJobs.values()].sort((a, b) => b.createdAt - a.createdAt);
  const removable = jobs.slice(MAX_JOBS).filter((job) => job.status !== 'running' && job.status !== 'queued');
  for (const job of removable) aiJobs.delete(job.id);
  await pruneStoredAiJobs(MAX_JOBS);
}

function createBaseJob(input: {
  kind: AiKnowledgeBaseJob['kind'];
  domain: string;
  questionCount?: number;
  kbId?: string;
  kbName?: string;
  entryId?: string;
  parentId?: string | null;
  targetPath?: string;
  instruction?: string;
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
    entryId: input.entryId,
    parentId: input.parentId,
    targetPath: input.targetPath,
    instruction: input.instruction,
    status: 'queued',
    logs: input.logs,
    modelOutput: '',
    abortRequested: false,
    createdAt: now,
    updatedAt: now,
    startedAt: 0,
    durationMs: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };
}

function scheduleJob(job: AiKnowledgeBaseJob): void {
  setTimeout(() => {
    if (job.kind === 'folder-init') void runFolderInitJob(job.id, job.questionCount || 18);
    else if (job.kind === 'folder-entries') void runFolderEntriesJob(job.id);
    else if (job.kind === 'analyze') void runAnalyzeJob(job.id);
    else if (job.kind === 'agent-edit') void runAgentEditJob(job.id);
    else void runKnowledgeBaseJob(job.id);
  }, 0);
}

async function hydrateKnowledgeBaseResult(job: AiKnowledgeBaseJob): Promise<GeneratedKnowledgeBaseResult | null> {
  const kbId = job.result?.kb?.id ?? job.kbId;
  if (!kbId) return null;
  const kb = await getKb(kbId);
  if (!kb) return null;
  const folders = (await listFolders()).filter((folder) => folder.kbId === kb.id);
  const entries = (await listEntries()).filter((entry) => entry.kbId === kb.id);
  return { kb, folders, entries };
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

async function canResumeKnowledgeBaseJob(job: AiKnowledgeBaseJob): Promise<boolean> {
  if (job.kbId && !await getKb(job.kbId)) return false;
  return Boolean(job.plan || extractPlanFromOutput(job));
}

export async function discardAiJobResultsForKb(kbId: string): Promise<void> {
  for (const job of aiJobs.values()) {
    const matches = job.kbId === kbId || job.result?.kb?.id === kbId;
    if (!matches) continue;
    if (job.status === 'queued' || job.status === 'running') {
      runningControllers.get(job.id)?.abort();
      await stopJobForDeletedKb(job);
    }
    if (job.result?.kb?.id === kbId) {
      job.result = undefined;
      await touchJob(job);
    }
  }
}

export async function startKnowledgeBaseJob(domain: string, questionCount: number): Promise<AiKnowledgeBaseJob> {
  const job = createBaseJob({
    kind: 'kb-generate',
    domain,
    questionCount,
    logs: ['任务已创建，等待后台执行'],
  });
  aiJobs.set(job.id, job);
  await persistJob(job);
  await pruneJobs();
  scheduleJob(job);
  return job;
}

export async function startFolderInitJob(input: {
  kbId: string;
  kbName: string;
  parentId: string | null;
  targetPath: string;
  domain: string;
  folderCount: number;
}): Promise<AiKnowledgeBaseJob> {
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
  await persistJob(job);
  await pruneJobs();
  scheduleJob(job);
  return job;
}

export async function startFolderEntriesJob(input: {
  kbId: string;
  kbName: string;
  parentId: string | null;
  targetPath: string;
  domain: string;
}): Promise<AiKnowledgeBaseJob> {
  const job = createBaseJob({
    kind: 'folder-entries',
    domain: input.domain,
    questionCount: 0,
    kbId: input.kbId,
    kbName: input.kbName,
    parentId: input.parentId,
    targetPath: input.targetPath,
    logs: ['目录知识点生成任务已创建，等待后台执行'],
  });
  aiJobs.set(job.id, job);
  await persistJob(job);
  await pruneJobs();
  scheduleJob(job);
  return job;
}

export async function startAnalyzeJob(input: { kbId: string; kbName: string }): Promise<AiKnowledgeBaseJob> {
  const job = createBaseJob({
    kind: 'analyze',
    domain: input.kbName,
    kbId: input.kbId,
    kbName: input.kbName,
    logs: ['知识库分析任务已创建，等待后台执行'],
  });
  aiJobs.set(job.id, job);
  await persistJob(job);
  await pruneJobs();
  scheduleJob(job);
  return job;
}

export async function startAnalyzeEntryJob(input: { entryId: string; entryTitle: string; kbId?: string }): Promise<AiKnowledgeBaseJob> {
  const job = createBaseJob({
    kind: 'analyze',
    domain: input.entryTitle,
    kbId: input.kbId,
    entryId: input.entryId,
    logs: ['知识点分析任务已创建，等待后台执行'],
  });
  aiJobs.set(job.id, job);
  await persistJob(job);
  await pruneJobs();
  scheduleJob(job);
  return job;
}

export async function startAgentEditJob(input: {
  kbId: string;
  kbName: string;
  instruction: string;
  parentId?: string | null;
  entryId?: string;
  targetPath?: string;
}): Promise<AiKnowledgeBaseJob> {
  const title = input.instruction.replace(/\s+/g, ' ').trim().slice(0, 64);
  const job = createBaseJob({
    kind: 'agent-edit',
    domain: title ? `调整「${input.kbName}」：${title}` : `调整「${input.kbName}」`,
    kbId: input.kbId,
    kbName: input.kbName,
    parentId: input.parentId ?? null,
    entryId: input.entryId,
    targetPath: input.targetPath,
    instruction: input.instruction,
    logs: ['AI 调整任务已创建，等待后台执行'],
  });
  aiJobs.set(job.id, job);
  await persistJob(job);
  await pruneJobs();
  scheduleJob(job);
  return job;
}

// 启动时恢复：把上次中断的 queued/running 任务重置为 queued，重建内存表，并继续调度。
export async function initAiJobs(): Promise<void> {
  await markInterruptedAiJobs();
  const stored = await listStoredAiJobs();
  for (const job of stored) aiJobs.set(job.id, job as AiKnowledgeBaseJob);
  for (const job of aiJobs.values()) {
    if (job.status === 'queued') {
      await pushJobLog(job, job.kind === 'folder-init'
        ? '服务已恢复，继续目录初始化任务'
        : job.kind === 'folder-entries'
          ? '服务已恢复，继续目录知识点生成任务'
          : job.kind === 'analyze'
            ? '服务已恢复，继续 AI 分析任务'
            : job.kind === 'agent-edit'
              ? '服务已恢复，继续 AI 调整任务'
              : '服务已恢复，继续 AI 建库任务');
      scheduleJob(job);
    }
  }
}

async function runAnalyzeJob(jobId: string): Promise<void> {
  const job = aiJobs.get(jobId);
  if (!job || job.status === 'cancelled') return;
  if (runningControllers.has(jobId)) return;
  const controller = new AbortController();
  runningControllers.set(jobId, controller);
  job.status = 'running';
  job.abortRequested = false;
  resetJobStats(job);
  await pushJobLog(job, '后台分析已启动');
  try {
    let analysis: KbAnalysis;
    if (job.entryId) {
      await pushJobLog(job, '汇总知识点正文，提交大模型诊断结构 / 内容 / 排版');
      analysis = await analyzeEntry(job.entryId, controller.signal, (usage) => void recordUsage(job, usage));
    } else {
      if (!job.kbId) throw new Error('知识库不存在');
      if (!await getKb(job.kbId)) throw new Error('知识库不存在');
      await pushJobLog(job, '汇总目录与知识点，提交大模型诊断');
      analysis = await analyzeKnowledgeBase(job.kbId, controller.signal, (usage) => void recordUsage(job, usage));
    }
    if (isJobCancelled(jobId)) return;
    job.analysis = analysis;
    job.parsed = { kbName: job.kbName ?? job.domain, folders: 0, questions: analysis.suggestions.length };
    job.status = 'succeeded';
    job.abortRequested = false;
    await pushJobLog(job, `分析完成：${analysis.suggestions.length} 条建议`);
    await touchJob(job);
  } catch (err) {
    if (isJobCancelled(jobId) || isAbortError(err)) {
      job.status = 'cancelled';
      job.error = '用户已取消任务';
      await pushJobLog(job, '任务已取消');
    } else {
      job.status = 'failed';
      job.error = err instanceof Error ? err.message : String(err);
      await pushJobLog(job, job.error);
    }
    await touchJob(job);
  } finally {
    finishJobTimer(job);
    await touchJob(job);
    runningControllers.delete(jobId);
  }
}

export async function cancelAiJob(id: string): Promise<AiKnowledgeBaseJob | null> {
  const job = aiJobs.get(id);
  if (!job) return null;
  if (job.status !== 'queued' && job.status !== 'running') return jobSnapshot(job);
  job.status = 'cancelled';
  job.error = '用户已取消任务';
  job.abortRequested = true;
  finishJobTimer(job);
  await pushJobLog(job, '任务已取消');
  runningControllers.get(id)?.abort();
  return jobSnapshot(job);
}

export async function retryAiJob(id: string): Promise<AiKnowledgeBaseJob | null> {
  const job = aiJobs.get(id);
  if (!job) return null;
  if (job.status === 'queued' || job.status === 'running') return jobSnapshot(job);
  if (job.kind === 'analyze') {
    if (!job.entryId && !(job.kbId && job.kbName)) return null;
    job.status = 'queued';
    job.error = undefined;
    job.abortRequested = false;
    await pushJobLog(job, '重新提交分析任务');
    scheduleJob(job);
    return jobSnapshot(job);
  }
  if (job.kind === 'agent-edit') {
    if (!job.kbId || !job.kbName || !job.instruction) return null;
    job.status = 'queued';
    job.error = undefined;
    job.abortRequested = false;
    await pushJobLog(job, '重新提交 AI 调整任务，将基于当前知识库重新规划');
    scheduleJob(job);
    return jobSnapshot(job);
  }
  if (job.kind === 'folder-init' || job.kind === 'folder-entries') {
    if (!job.kbId || !job.kbName) return null;
    job.status = 'queued';
    job.error = undefined;
    job.abortRequested = false;
    await pushJobLog(job, job.kind === 'folder-init' ? '重新提交目录初始化任务' : '重新提交目录知识点生成任务');
    scheduleJob(job);
    return jobSnapshot(job);
  }
  if (await canResumeKnowledgeBaseJob(job)) {
    job.status = 'queued';
    job.error = undefined;
    job.abortRequested = false;
    await pushJobLog(job, '重新提交任务，将从已有进度继续');
    scheduleJob(job);
    return jobSnapshot(job);
  }
  return startKnowledgeBaseJob(job.domain, job.questionCount || 18);
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || /abort|cancel/i.test(err.message));
}

function isJobCancelled(jobId: string): boolean {
  return aiJobs.get(jobId)?.status === 'cancelled';
}

async function updateJobResult(job: AiKnowledgeBaseJob, result: GeneratedKnowledgeBaseResult): Promise<void> {
  job.result = {
    kb: result.kb,
    folders: [...result.folders],
    entries: [...result.entries],
  };
  await touchJob(job);
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

async function stopJobForDeletedKb(job: AiKnowledgeBaseJob): Promise<void> {
  job.status = 'cancelled';
  job.error = '知识库已删除';
  job.abortRequested = true;
  finishJobTimer(job);
  await pushJobLog(job, '知识库已删除，任务已停止');
}

function agentEditCounts(actions: AgentEditAction[]): { structure: number; content: number } {
  return {
    structure: actions.filter((action) => action.kind === 'create-folder' || action.kind === 'rename-folder' || action.kind === 'move-entry').length,
    content: actions.filter((action) => action.kind === 'create-entry' || action.kind === 'rewrite-entry').length,
  };
}

async function resolveAgentActionFolder(
  kbId: string,
  action: AgentEditAction,
  folderRefs: Map<string, string>,
  fallback: string | null,
): Promise<string | null> {
  if (action.folderRef) {
    const refId = folderRefs.get(action.folderRef);
    if (!refId) throw new Error(`目录引用尚未创建：${action.folderRef}`);
    return refId;
  }
  if (action.folderId === undefined) return fallback;
  if (action.folderId === null) return null;
  const folder = await getFolder(action.folderId);
  if (!folder || folder.kbId !== kbId) throw new Error(`目标目录不存在或不属于当前知识库：${action.folderId}`);
  return folder.id;
}

async function refreshAgentEditResult(job: AiKnowledgeBaseJob): Promise<void> {
  const result = await hydrateKnowledgeBaseResult(job);
  if (result) await updateJobResult(job, result);
  else await touchJob(job);
}

async function runAgentEditJob(jobId: string): Promise<void> {
  const job = aiJobs.get(jobId);
  if (!job || job.status === 'cancelled') return;
  if (runningControllers.has(jobId)) return;
  const controller = new AbortController();
  runningControllers.set(jobId, controller);
  job.status = 'running';
  job.abortRequested = false;
  resetJobStats(job);
  await pushJobLog(job, 'AI 调整任务已启动');
  try {
    if (!job.kbId || !job.instruction) throw new Error('缺少知识库或调整指令');
    const kb = await getKb(job.kbId);
    if (!kb) throw new Error('知识库不存在');
    await refreshAgentEditResult(job);

    await pushJobLog(job, 'Agent 第 1 步：读取当前目录和知识点，生成调整计划');
    const planned = await planKnowledgeBaseEdit({
      kbId: kb.id,
      kbName: kb.name,
      instruction: job.instruction,
      folderId: job.parentId ?? null,
      entryId: job.entryId,
      signal: controller.signal,
      onUsage: (usage) => void recordUsage(job, usage),
    });
    if (isJobCancelled(jobId)) return;

    const counts = agentEditCounts(planned.plan.actions);
    job.modelOutput = trimJobOutput([
      `用户想法：${job.instruction}`,
      '',
      `执行摘要：${planned.plan.summary}`,
      '',
      '---JSON---',
      JSON.stringify(planned.plan, null, 2),
    ].join('\n'));
    job.parsed = { kbName: kb.name, folders: counts.structure, questions: counts.content };
    await pushJobLog(job, `计划完成：${counts.structure} 个结构动作 · ${counts.content} 个内容动作`);
    await touchJob(job);

    const folderRefs = new Map<string, string>();
    const actions = planned.plan.actions;
    for (let index = 0; index < actions.length; index += 1) {
      if (isJobCancelled(jobId)) return;
      if (!await getKb(kb.id)) {
        await stopJobForDeletedKb(job);
        return;
      }
      const action = actions[index];
      const label = `${index + 1}/${actions.length}`;
      if (action.kind === 'note') {
        await pushJobLog(job, `动作 ${label}：${action.title}`);
        continue;
      }

      if (action.kind === 'create-folder') {
        const parentId = await resolveAgentActionFolder(kb.id, action, folderRefs, job.parentId ?? null);
        const folder = await ensureFolder(kb.id, action.name ?? action.title, parentId);
        if (action.ref) folderRefs.set(action.ref, folder.id);
        if (action.name) folderRefs.set(action.name, folder.id);
        await pushJobLog(job, `动作 ${label}：已创建/复用目录「${folder.name}」`);
        await refreshAgentEditResult(job);
        continue;
      }

      if (action.kind === 'rename-folder') {
        if (!action.folderId || !action.name) throw new Error('目录改名动作缺少目录或新名称');
        const folder = await getFolder(action.folderId);
        if (!folder || folder.kbId !== kb.id) throw new Error('目录不存在或不属于当前知识库');
        const renamed = await renameFolder(folder.id, action.name);
        await pushJobLog(job, `动作 ${label}：已重命名目录为「${renamed?.name ?? action.name}」`);
        await refreshAgentEditResult(job);
        continue;
      }

      if (action.kind === 'move-entry') {
        if (!action.entryId) throw new Error('移动知识点动作缺少 entryId');
        const current = await getEntry(action.entryId);
        if (!current || current.kbId !== kb.id) throw new Error('知识点不存在或不属于当前知识库');
        const targetFolderId = await resolveAgentActionFolder(kb.id, action, folderRefs, job.parentId ?? null);
        const moved = await updateEntry(current.id, { kbId: current.kbId, folderId: targetFolderId });
        await pushJobLog(job, `动作 ${label}：已移动知识点「${moved?.title ?? current.title}」`);
        await refreshAgentEditResult(job);
        continue;
      }

      if (action.kind === 'create-entry') {
        const targetFolderId = await resolveAgentActionFolder(kb.id, action, folderRefs, job.parentId ?? null);
        const topic = [action.topic || action.name || action.title, action.detail].filter(Boolean).join('\n');
        const pathLabel = await folderPathLabel(targetFolderId);
        await pushJobLog(job, `动作 ${label}：生成知识点「${action.topic || action.name || action.title}」`);
        job.modelOutput = trimJobOutput(`${job.modelOutput}\n\n---AGENT CREATE ${label}: ${action.title}---\n`);
        await touchJob(job);
        const context = searchEntries((await listEntries()).filter((entry) => entry.kbId === kb.id), topic);
        const input = await generateEntryInputStream({
          topic,
          kbName: kb.name,
          folderPath: pathLabel,
          context,
          signal: controller.signal,
        }, (event: GenerateEntryEvent) => {
          const current = aiJobs.get(jobId);
          if (!current || current.status === 'cancelled') return;
          if (event.type === 'stage') void pushJobLog(current, `动作 ${label}：${event.message}`);
          if (event.type === 'model-delta') {
            current.modelOutput = trimJobOutput(`${current.modelOutput}${event.content}`);
            void touchJob(current);
          }
          if (event.type === 'parsed') void pushJobLog(current, `动作 ${label}：解析完成「${event.title}」`);
          if (event.type === 'usage') void recordUsage(current, event.usage);
        });
        if (isJobCancelled(jobId)) return;
        const entry = await createEntry({ ...input, kbId: kb.id, folderId: targetFolderId });
        await pushJobLog(job, `动作 ${label}：已新增知识点「${entry.title}」`);
        await refreshAgentEditResult(job);
        continue;
      }

      if (action.kind === 'rewrite-entry') {
        if (!action.entryId) throw new Error('改写知识点动作缺少 entryId');
        const current = await getEntry(action.entryId);
        if (!current || current.kbId !== kb.id) throw new Error('知识点不存在或不属于当前知识库');
        const instruction = action.instruction || action.detail || job.instruction;
        await pushJobLog(job, `动作 ${label}：改写知识点「${current.title}」`);
        job.modelOutput = trimJobOutput(`${job.modelOutput}\n\n---AGENT REWRITE ${label}: ${current.title}---\n`);
        await touchJob(job);
        const input = await rewriteEntryInputStream({
          entry: current,
          instruction,
          signal: controller.signal,
        }, (event: GenerateEntryEvent) => {
          const running = aiJobs.get(jobId);
          if (!running || running.status === 'cancelled') return;
          if (event.type === 'stage') void pushJobLog(running, `动作 ${label}：${event.message}`);
          if (event.type === 'model-delta') {
            running.modelOutput = trimJobOutput(`${running.modelOutput}${event.content}`);
            void touchJob(running);
          }
          if (event.type === 'parsed') void pushJobLog(running, `动作 ${label}：改写解析完成「${event.title}」`);
          if (event.type === 'usage') void recordUsage(running, event.usage);
        });
        if (isJobCancelled(jobId)) return;
        await createEntryVersion(current, 'ai-agent-edit');
        const rewritten = await updateEntry(current.id, {
          ...input,
          kbId: current.kbId,
          folderId: current.folderId,
        });
        await pushJobLog(job, `动作 ${label}：已改写知识点「${rewritten?.title ?? current.title}」`);
        await refreshAgentEditResult(job);
      }
    }

    job.status = 'succeeded';
    job.abortRequested = false;
    await pushJobLog(job, `AI 调整完成：${kb.name}`);
    await refreshAgentEditResult(job);
  } catch (err) {
    if (isJobCancelled(jobId) || isAbortError(err)) {
      job.status = 'cancelled';
      job.error = '用户已取消任务';
      await pushJobLog(job, '任务已取消');
    } else {
      job.status = 'failed';
      job.error = err instanceof Error ? err.message : String(err);
      await pushJobLog(job, job.error);
    }
    await touchJob(job);
  } finally {
    finishJobTimer(job);
    await touchJob(job);
    runningControllers.delete(jobId);
  }
}

async function runKnowledgeBaseJob(jobId: string): Promise<void> {
  const job = aiJobs.get(jobId);
  if (!job || job.status === 'cancelled') return;
  if (runningControllers.has(jobId)) return;
  const controller = new AbortController();
  runningControllers.set(jobId, controller);
  job.status = 'running';
  job.abortRequested = false;
  resetJobStats(job);
  await pushJobLog(job, '后台任务已启动');
  try {
    let plan = job.plan ?? extractPlanFromOutput(job);
    const recoveredPlan = Boolean(plan);
    if (plan) {
      job.plan = plan;
      job.questionCount = plan.questions.length;
      job.parsed = { kbName: plan.kbName, folders: plan.folders.length, questions: plan.questions.length };
      await pushJobLog(job, `已恢复规划：${plan.kbName} · ${plan.folders.length} 个目录 · ${plan.questions.length} 道题`);
    } else {
      plan = await generateKnowledgeBasePlanStream({
        domain: job.domain,
        questionCount: job.questionCount,
        signal: controller.signal,
      }, (event: GenerateKnowledgeBaseEvent) => {
        const current = aiJobs.get(jobId);
        if (!current || current.status === 'cancelled') return;
        if (event.type === 'stage') void pushJobLog(current, event.message);
        if (event.type === 'model-delta') {
          current.modelOutput = trimJobOutput(`${current.modelOutput}${event.content}`);
          void touchJob(current);
        }
        if (event.type === 'model-output') {
          current.modelOutput = trimJobOutput(event.content);
          void touchJob(current);
        }
        if (event.type === 'parsed-kb') {
          current.parsed = { kbName: event.kbName, folders: event.folders, questions: event.questions };
          void pushJobLog(current, `解析完成：${event.kbName} · ${event.folders} 个目录 · ${event.questions} 道题`);
        }
        if (event.type === 'usage') void recordUsage(current, event.usage);
      });
      job.plan = plan;
      job.questionCount = plan.questions.length;
      await touchJob(job);
    }
    if (isJobCancelled(jobId)) return;

    await pushJobLog(job, recoveredPlan ? 'LangChain Agent 第 2 步：恢复知识库和目录骨架' : 'LangChain Agent 第 2 步：创建知识库和目录骨架');
    const existingResult = recoveredPlan ? await hydrateKnowledgeBaseResult(job) : null;
    if (recoveredPlan && job.kbId && !existingResult) {
      await stopJobForDeletedKb(job);
      return;
    }
    const writer = existingResult
      ? await createKnowledgeBaseWriterFromExisting(existingResult)
      : await createKnowledgeBaseWriterFromDraft(plan);
    for (const folder of plan.folders) await writer.ensurePath(folder.path);
    job.kbId = writer.kb.id;
    job.kbName = writer.kb.name;
    job.parsed = { kbName: writer.kb.name, folders: writer.folders.length, questions: writer.entries.length };
    await updateJobResult(job, writer);
    await pushJobLog(job, existingResult
      ? `已恢复写入进度：${writer.entries.length}/${plan.questions.length} 条知识点`
      : `目录骨架已写入：${writer.folders.length} 个目录`);

    const total = plan.questions.length;
    const startIndex = Math.min(writer.entries.length, total);
    if (startIndex >= total) {
      job.status = 'succeeded';
      job.abortRequested = false;
      await pushJobLog(job, `已完成：${writer.kb.name} · ${writer.folders.length} 个目录 · ${writer.entries.length} 条知识点`);
      await touchJob(job);
      return;
    }
    if (startIndex > 0) await pushJobLog(job, `从第 ${startIndex + 1}/${total} 个知识点继续生成`);
    for (let index = startIndex; index < plan.questions.length; index += 1) {
      if (isJobCancelled(jobId)) return;
      if (!await getKb(writer.kb.id)) {
        await stopJobForDeletedKb(job);
        return;
      }
      const question = plan.questions[index];
      const targetPath = question.folderPath.join(' / ') || '根层级';
      await pushJobLog(job, `LangChain Agent 第 3 步：生成知识点 ${index + 1}/${total} · ${question.title}`);
      job.modelOutput = trimJobOutput(`${job.modelOutput}\n\n---ENTRY ${index + 1}/${total}: ${question.title}---\n`);
      await touchJob(job);
      const input = await generateEntryInputStream({
        topic: `${question.title}\n${question.question || question.summary}`,
        kbName: writer.kb.name,
        folderPath: targetPath,
        context: [],
        signal: controller.signal,
      }, (event: GenerateEntryEvent) => {
        const current = aiJobs.get(jobId);
        if (!current || current.status === 'cancelled') return;
        if (event.type === 'stage') void pushJobLog(current, `知识点 ${index + 1}/${total}：${event.message}`);
        if (event.type === 'model-delta') {
          current.modelOutput = trimJobOutput(`${current.modelOutput}${event.content}`);
          void touchJob(current);
        }
        if (event.type === 'model-output') {
          void touchJob(current);
        }
        if (event.type === 'parsed') {
          void pushJobLog(current, `知识点 ${index + 1}/${total} 解析完成：${event.title}`);
        }
        if (event.type === 'usage') void recordUsage(current, event.usage);
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
        if (event.type === 'image-stage') void pushJobLog(current, `知识点 ${index + 1}/${total}：${event.message}`);
        if (event.type === 'image') void pushJobLog(current, `知识点 ${index + 1}/${total} 图解已生成`);
      });
      if (!await getKb(writer.kb.id)) {
        await stopJobForDeletedKb(job);
        return;
      }
      const entry = await writer.addEntry(illustrated, question.folderPath);
      job.parsed = { kbName: writer.kb.name, folders: writer.folders.length, questions: writer.entries.length };
      await updateJobResult(job, writer);
      await pushJobLog(job, `已新增知识点 ${index + 1}/${total}：${entry.title}`);
    }

    job.status = 'succeeded';
    job.abortRequested = false;
    await pushJobLog(job, `已完成：${writer.kb.name} · ${writer.folders.length} 个目录 · ${writer.entries.length} 条知识点`);
    await touchJob(job);
  } catch (err) {
    if (isJobCancelled(jobId) || isAbortError(err)) {
      job.status = 'cancelled';
      job.error = '用户已取消任务';
      await pushJobLog(job, '任务已取消');
    } else {
      job.status = 'failed';
      job.error = err instanceof Error ? err.message : String(err);
      await pushJobLog(job, job.error);
    }
    await touchJob(job);
  } finally {
    finishJobTimer(job);
    await touchJob(job);
    runningControllers.delete(jobId);
  }
}

function folderPathParts(folder: Folder, byId: Map<string, Folder>): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  let cursor: Folder | undefined = folder;
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    names.unshift(cursor.name);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return names;
}

function folderDepth(folder: Folder, byId: Map<string, Folder>): number {
  return folderPathParts(folder, byId).length;
}

async function collectFolderEntryTargets(kbId: string, parentId: string | null): Promise<Array<{ folder: Folder; path: string[] }>> {
  const folders = (await listFolders()).filter((folder) => folder.kbId === kbId);
  const entries = (await listEntries()).filter((entry) => entry.kbId === kbId);
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const childrenByParent = new Map<string | null, Folder[]>();
  for (const folder of folders) {
    const key = folder.parentId ?? null;
    if (!childrenByParent.has(key)) childrenByParent.set(key, []);
    childrenByParent.get(key)!.push(folder);
  }

  const scopeIds = new Set<string>();
  const queue = parentId ? [parentId] : [...(childrenByParent.get(null) ?? []).map((folder) => folder.id)];
  while (queue.length) {
    const id = queue.shift()!;
    if (scopeIds.has(id)) continue;
    const folder = byId.get(id);
    if (!folder) continue;
    scopeIds.add(id);
    for (const child of childrenByParent.get(id) ?? []) queue.push(child.id);
  }

  const directEntryCounts = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.folderId) continue;
    directEntryCounts.set(entry.folderId, (directEntryCounts.get(entry.folderId) ?? 0) + 1);
  }

  const scoped = folders
    .filter((folder) => scopeIds.has(folder.id))
    .sort((a, b) => folderDepth(a, byId) - folderDepth(b, byId) || a.sort - b.sort || a.createdAt - b.createdAt);
  const leaves = scoped.filter((folder) => !(childrenByParent.get(folder.id) ?? []).some((child) => scopeIds.has(child.id)));
  const candidates = leaves.length ? leaves : scoped;
  return candidates
    .filter((folder) => (directEntryCounts.get(folder.id) ?? 0) === 0)
    .map((folder) => ({ folder, path: folderPathParts(folder, byId) }));
}

async function runFolderEntriesJob(jobId: string): Promise<void> {
  const job = aiJobs.get(jobId);
  if (!job || job.status === 'cancelled') return;
  if (runningControllers.has(jobId)) return;
  const controller = new AbortController();
  runningControllers.set(jobId, controller);
  job.status = 'running';
  job.abortRequested = false;
  resetJobStats(job);
  await pushJobLog(job, '后台目录知识点生成已启动');
  try {
    if (!job.kbId) throw new Error('知识库不存在');
    const kb = await getKb(job.kbId);
    if (!kb) throw new Error('知识库不存在');
    const result = await hydrateKnowledgeBaseResult(job);
    if (!result) throw new Error('知识库不存在');

    const writer = await createKnowledgeBaseWriterFromExisting(result);
    let targets = await collectFolderEntryTargets(kb.id, job.parentId ?? null);
    job.questionCount = targets.length;
    job.parsed = { kbName: kb.name, folders: writer.folders.length, questions: writer.entries.length };
    await updateJobResult(job, writer);
    if (!targets.length) {
      job.status = 'succeeded';
      job.abortRequested = false;
      await pushJobLog(job, '当前目录范围没有需要补全的空叶子目录');
      await touchJob(job);
      return;
    }

    await pushJobLog(job, `准备按目录补全 ${targets.length} 条知识点`);
    const total = targets.length;
    let completed = 0;
    while (completed < total) {
      if (isJobCancelled(jobId)) return;
      if (!await getKb(kb.id)) {
        await stopJobForDeletedKb(job);
        return;
      }
      targets = await collectFolderEntryTargets(kb.id, job.parentId ?? null);
      const target = targets[0];
      if (!target) break;
      const pathLabel = target.path.join(' / ') || target.folder.name;
      const topic = [
        '请基于当前目录自动生成一个工程面试知识点，用户没有额外输入题目。',
        `目录路径：${pathLabel}`,
        `目标目录：${target.folder.name}`,
        '请从目录名推断最高频、最值得复习的核心知识点；标题要适合放入该目录，避免泛泛重复目录名。',
      ].join('\n');
      const currentIndex = completed + 1;
      await pushJobLog(job, `LangChain Agent：按目录生成知识点 ${currentIndex}/${total} · ${pathLabel}`);
      job.modelOutput = trimJobOutput(`${job.modelOutput}\n\n---FOLDER ENTRY ${currentIndex}/${total}: ${pathLabel}---\n`);
      await touchJob(job);

      const context = searchEntries((await listEntries()).filter((entry) => entry.kbId === kb.id), `${pathLabel} ${target.folder.name}`);
      const input = await generateEntryInputStream({
        topic,
        kbName: kb.name,
        folderPath: pathLabel,
        context,
        signal: controller.signal,
      }, (event: GenerateEntryEvent) => {
        const current = aiJobs.get(jobId);
        if (!current || current.status === 'cancelled') return;
        if (event.type === 'stage') void pushJobLog(current, `目录知识点 ${currentIndex}/${total}：${event.message}`);
        if (event.type === 'model-delta') {
          current.modelOutput = trimJobOutput(`${current.modelOutput}${event.content}`);
          void touchJob(current);
        }
        if (event.type === 'model-output') {
          void touchJob(current);
        }
        if (event.type === 'parsed') {
          void pushJobLog(current, `目录知识点 ${currentIndex}/${total} 解析完成：${event.title}`);
        }
        if (event.type === 'usage') void recordUsage(current, event.usage);
      });
      if (isJobCancelled(jobId)) return;

      const illustrated = await appendAiIllustration(input, {
        title: input.title,
        summary: input.summary,
        tags: input.tags,
        kbName: kb.name,
        folderPath: pathLabel,
      }, controller.signal, (event) => {
        const current = aiJobs.get(jobId);
        if (!current || current.status === 'cancelled') return;
        if (event.type === 'image-stage') void pushJobLog(current, `目录知识点 ${currentIndex}/${total}：${event.message}`);
        if (event.type === 'image') void pushJobLog(current, `目录知识点 ${currentIndex}/${total} 图解已生成`);
      });
      if (!await getKb(kb.id)) {
        await stopJobForDeletedKb(job);
        return;
      }

      const entry = await writer.addEntry(illustrated, target.path);
      job.parsed = { kbName: kb.name, folders: writer.folders.length, questions: writer.entries.length };
      await updateJobResult(job, writer);
      await pushJobLog(job, `已写入目录知识点 ${currentIndex}/${total}：${entry.title}`);
      completed += 1;
    }

    job.status = 'succeeded';
    job.abortRequested = false;
    await pushJobLog(job, `已完成：${kb.name} · ${writer.folders.length} 个目录 · ${writer.entries.length} 条知识点`);
    await touchJob(job);
  } catch (err) {
    if (isJobCancelled(jobId) || isAbortError(err)) {
      job.status = 'cancelled';
      job.error = '用户已取消任务';
      await pushJobLog(job, '任务已取消');
    } else {
      job.status = 'failed';
      job.error = err instanceof Error ? err.message : String(err);
      await pushJobLog(job, job.error);
    }
    await touchJob(job);
  } finally {
    finishJobTimer(job);
    await touchJob(job);
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
  resetJobStats(job);
  await pushJobLog(job, '后台目录初始化已启动');
  try {
    if (!job.kbId) throw new Error('知识库不存在');
    const kb = await getKb(job.kbId);
    if (!kb) throw new Error('知识库不存在');
    const existingFolders: string[] = [];
    for (const folder of (await listFolders()).filter((folder) => folder.kbId === kb.id)) {
      existingFolders.push(await folderPathLabel(folder.id));
    }
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
      if (event.type === 'stage') void pushJobLog(current, event.message);
      if (event.type === 'model-delta') {
        current.modelOutput = trimJobOutput(`${current.modelOutput}${event.content}`);
        void touchJob(current);
      }
      if (event.type === 'model-output') {
        current.modelOutput = trimJobOutput(event.content);
        void touchJob(current);
      }
      if (event.type === 'parsed-folders') {
        current.parsed = { kbName: kb.name, folders: event.folders, questions: 0 };
        void pushJobLog(current, `解析完成：${event.title} · ${event.folders} 个目录路径`);
      }
      if (event.type === 'usage') void recordUsage(current, event.usage);
    });
    if (isJobCancelled(jobId)) return;

    await pushJobLog(job, '开始写入文件目录');
    const result = await createFoldersFromDraft(kb, job.parentId ?? null, draft);
    job.result = result;
    job.status = 'succeeded';
    job.abortRequested = false;
    await pushJobLog(job, `已完成：${kb.name} · ${result.folders.length} 个目录`);
    await touchJob(job);
  } catch (err) {
    if (isJobCancelled(jobId) || isAbortError(err)) {
      job.status = 'cancelled';
      job.error = '用户已取消任务';
      await pushJobLog(job, '任务已取消');
    } else {
      job.status = 'failed';
      job.error = err instanceof Error ? err.message : String(err);
      await pushJobLog(job, job.error);
    }
    await touchJob(job);
  } finally {
    finishJobTimer(job);
    await touchJob(job);
    runningControllers.delete(jobId);
  }
}
