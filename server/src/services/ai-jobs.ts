import { randomUUID } from 'node:crypto';
import {
  clearStoredAiJobHistory,
  createEntry,
  createEntryVersion,
  deleteStoredAiJob,
  deleteEntry,
  deleteFolder,
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
  type GeneratedFolderTreeDraft,
} from '../ai-generate.js';
import { appendAiIllustration } from '../ai-image.js';
import type { AiTokenUsage } from '../ai/types.js';
import { kbDraftFromModelOutput } from '../ai/parse.js';
import { createFoldersFromDraft, createKnowledgeBaseWriterFromDraft, createKnowledgeBaseWriterFromExisting, type GeneratedKnowledgeBaseResult } from './kb-draft-writer.js';
import { folderPathLabel } from './utils.js';
import { searchEntries } from '../search.js';
import { analyzeKnowledgeBase, analyzeEntry, type KbAnalysis } from '../ai-analyze.js';
import { planKnowledgeBaseEdit, type AgentEditAction, type AgentEditPlan } from '../ai-agent-edit.js';
import type { Entry, Folder } from '../types.js';

export type AiJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface AiKnowledgeBaseJob {
  id: string;
  kind: 'kb-generate' | 'folder-init' | 'folder-entries' | 'folder-full' | 'analyze' | 'agent-edit';
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
  plan?: GeneratedKbDraft | AgentEditPlan;
  result?: GeneratedKnowledgeBaseResult;
  analysis?: KbAnalysis;
  agentPhase?: 'draft' | 'applying' | 'applied' | 'reverted';
  rollback?: AgentEditRollback;
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

export interface AgentEditRollback {
  createdFolderIds: string[];
  createdEntryIds: string[];
  updatedEntries: Entry[];
  renamedFolders: Folder[];
  appliedAt: number;
  revertedAt?: number;
}

export const aiJobs = new Map<string, AiKnowledgeBaseJob>();

const MAX_JOB_OUTPUT = 160_000;
const MAX_JOB_LIST_OUTPUT = 12_000;
const MAX_JOBS = 30;
const AI_JOB_PERSIST_DEBOUNCE_MS = Math.max(100, Number(process.env.AI_JOB_PERSIST_DEBOUNCE_MS ?? 2000) || 2000);
const DEFAULT_AI_JOB_CONCURRENCY = 5;
const MAX_AI_JOB_CONCURRENCY = 20;
const AI_JOB_CONCURRENCY = Math.max(
  1,
  Math.min(MAX_AI_JOB_CONCURRENCY, Number(process.env.AI_JOB_CONCURRENCY ?? DEFAULT_AI_JOB_CONCURRENCY) || DEFAULT_AI_JOB_CONCURRENCY),
);
const runningControllers = new Map<string, AbortController>();
const queuedJobIds = new Set<string>();
let queuePumpScheduled = false;
const jobPersistTimers = new Map<string, ReturnType<typeof setTimeout>>();
const jobPersistChains = new Map<string, Promise<void>>();
const discardedJobIds = new Set<string>();

// 中断并清空所有在途 / 排队 / 持久化定时器。热切换数据库前调用，避免旧任务把数据写到新库；
// 切换后由 initAiJobs() 重新从新库水合任务表。旧库里残留的 running 状态会在下次启动被 markInterruptedAiJobs 清理。
export function teardownAiJobs(): void {
  for (const controller of runningControllers.values()) {
    try { controller.abort(); } catch { /* ignore */ }
  }
  for (const timer of jobPersistTimers.values()) clearTimeout(timer);
  runningControllers.clear();
  jobPersistTimers.clear();
  jobPersistChains.clear();
  queuedJobIds.clear();
  discardedJobIds.clear();
  aiJobs.clear();
  queuePumpScheduled = false;
}

function trimJobOutput(value: string): string {
  return value.length > MAX_JOB_OUTPUT ? value.slice(-MAX_JOB_OUTPUT) : value;
}

function trimJobListOutput(value: string): string {
  return value.length > MAX_JOB_LIST_OUTPUT ? value.slice(-MAX_JOB_LIST_OUTPUT) : value;
}

async function persistJobNow(job: AiKnowledgeBaseJob): Promise<void> {
  if (discardedJobIds.has(job.id)) return;
  const timer = jobPersistTimers.get(job.id);
  if (timer) {
    clearTimeout(timer);
    jobPersistTimers.delete(job.id);
  }
  const previous = jobPersistChains.get(job.id) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(() => saveAiJob(job));
  jobPersistChains.set(job.id, current);
  try {
    await current;
  } finally {
    if (jobPersistChains.get(job.id) === current) jobPersistChains.delete(job.id);
  }
}

function scheduleJobPersist(job: AiKnowledgeBaseJob): void {
  if (discardedJobIds.has(job.id)) return;
  if (jobPersistTimers.has(job.id)) return;
  jobPersistTimers.set(job.id, setTimeout(() => {
    jobPersistTimers.delete(job.id);
    void persistJobNow(job).catch((err) => {
      console.warn('[ai-jobs] 持久化任务状态失败:', err);
    });
  }, AI_JOB_PERSIST_DEBOUNCE_MS));
}

async function persistJob(job: AiKnowledgeBaseJob): Promise<void> {
  discardedJobIds.delete(job.id);
  await persistJobNow(job);
}

async function touchJob(job: AiKnowledgeBaseJob, options: { immediate?: boolean } = {}): Promise<void> {
  job.updatedAt = Date.now();
  const immediate = options.immediate ?? job.status !== 'running';
  if (immediate) await persistJobNow(job);
  else scheduleJobPersist(job);
}

function touchJobDeferred(job: AiKnowledgeBaseJob): void {
  job.updatedAt = Date.now();
  scheduleJobPersist(job);
}

function discardScheduledJobPersist(id: string): void {
  discardedJobIds.add(id);
  const timer = jobPersistTimers.get(id);
  if (timer) clearTimeout(timer);
  jobPersistTimers.delete(id);
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
    : job.kind === 'folder-init' || job.kind === 'folder-entries' || job.kind === 'folder-full'
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

function cheapResumable(job: AiKnowledgeBaseJob): boolean {
  if (job.status === 'queued' || job.status === 'running') return false;
  if (job.kind === 'analyze') return Boolean(job.entryId || (job.kbId && job.kbName));
  if (job.kind === 'agent-edit') return Boolean(job.kbId && job.instruction);
  if (job.kind === 'folder-init' || job.kind === 'folder-entries' || job.kind === 'folder-full') return Boolean(job.kbId && job.kbName);
  return Boolean(job.plan || job.kbId || job.modelOutput);
}

function compactRollback(rollback: AgentEditRollback | undefined): AgentEditRollback | undefined {
  if (!rollback) return undefined;
  // 列表接口只需要知道“可撤销”，不需要把所有旧知识点正文反复轮询下发。
  return {
    createdFolderIds: [],
    createdEntryIds: [],
    updatedEntries: [],
    renamedFolders: [],
    appliedAt: rollback.appliedAt,
    revertedAt: rollback.revertedAt,
  };
}

function compactJobEntry(entry: Entry): Entry {
  const { doc: _doc, intro: _intro, nodes: _nodes, ...rest } = entry;
  return { ...rest, intro: '', nodes: [], doc: [] };
}

export function compactJobSnapshot(job: AiKnowledgeBaseJob): AiKnowledgeBaseJob {
  return {
    ...job,
    resumable: cheapResumable(job),
    logs: [...job.logs],
    modelOutput: trimJobListOutput(job.modelOutput),
    rollback: compactRollback(job.rollback),
    result: job.result ? {
      kb: job.result.kb,
      folders: [...job.result.folders],
      entries: job.result.entries.map(compactJobEntry),
    } : undefined,
  };
}

export async function listJobSnapshots(): Promise<AiKnowledgeBaseJob[]> {
  const jobs = [...aiJobs.values()].sort((a, b) => b.createdAt - a.createdAt);
  return jobs.map(compactJobSnapshot);
}

export async function clearAiJobHistory(): Promise<AiKnowledgeBaseJob[]> {
  for (const [id, job] of aiJobs) {
    if (job.status !== 'queued' && job.status !== 'running') {
      discardScheduledJobPersist(id);
      aiJobs.delete(id);
    }
  }
  await clearStoredAiJobHistory();
  return listJobSnapshots();
}

export async function clearAiJob(id: string): Promise<AiKnowledgeBaseJob[] | null> {
  const job = aiJobs.get(id);
  if (job && (job.status === 'queued' || job.status === 'running')) return null;
  if (job) {
    discardScheduledJobPersist(id);
    aiJobs.delete(id);
  }
  const removed = await deleteStoredAiJob(id);
  if (!job && !removed) return null;
  return listJobSnapshots();
}

async function pruneJobs(): Promise<void> {
  const jobs = [...aiJobs.values()].sort((a, b) => b.createdAt - a.createdAt);
  const removable = jobs.slice(MAX_JOBS).filter((job) => job.status !== 'running' && job.status !== 'queued');
  for (const job of removable) {
    discardScheduledJobPersist(job.id);
    aiJobs.delete(job.id);
  }
  await pruneStoredAiJobs(MAX_JOBS);
}

function schedulePruneJobs(): void {
  setTimeout(() => {
    void pruneJobs().catch((err) => {
      console.warn('[ai-jobs] 清理历史任务失败:', err);
    });
  }, 0);
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

function runQueuedJob(job: AiKnowledgeBaseJob): Promise<void> {
  if (job.kind === 'folder-init') return runFolderInitJob(job.id, job.questionCount || 18);
  if (job.kind === 'folder-entries') return runFolderEntriesJob(job.id);
  if (job.kind === 'folder-full') return runFolderFullJob(job.id, job.questionCount || 18);
  if (job.kind === 'analyze') return runAnalyzeJob(job.id);
  if (job.kind === 'agent-edit') return runAgentEditJob(job.id);
  return runKnowledgeBaseJob(job.id);
}

function scheduleJobQueuePump(): void {
  if (queuePumpScheduled) return;
  queuePumpScheduled = true;
  setTimeout(() => {
    queuePumpScheduled = false;
    pumpJobQueue();
  }, 0);
}

function pumpJobQueue(): void {
  if (runningControllers.size >= AI_JOB_CONCURRENCY) return;
  for (const jobId of [...queuedJobIds]) {
    if (runningControllers.size >= AI_JOB_CONCURRENCY) break;
    queuedJobIds.delete(jobId);
    const job = aiJobs.get(jobId);
    if (!job || job.status !== 'queued') continue;
    void runQueuedJob(job).finally(() => {
      scheduleJobQueuePump();
    });
  }
}

function scheduleJob(job: AiKnowledgeBaseJob): void {
  queuedJobIds.add(job.id);
  scheduleJobQueuePump();
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

function isGeneratedKbDraft(value: unknown): value is GeneratedKbDraft {
  const draft = value as GeneratedKbDraft | undefined;
  return Boolean(draft && typeof draft === 'object' && typeof draft.kbName === 'string' && Array.isArray(draft.folders) && Array.isArray(draft.questions));
}

async function canResumeKnowledgeBaseJob(job: AiKnowledgeBaseJob): Promise<boolean> {
  if (job.kbId && !await getKb(job.kbId)) return false;
  return Boolean(isGeneratedKbDraft(job.plan) || extractPlanFromOutput(job));
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

export interface DiscardAiJobResultItemsResult {
  folderIds: string[];
  entryIds: string[];
}

function collectResultFolderSubtree(folders: Folder[], rootIds: Set<string>): Set<string> {
  const ids = new Set(rootIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) {
        ids.add(folder.id);
        changed = true;
      }
    }
  }
  return ids;
}

export async function discardAiJobResultItems(input: {
  folderIds?: string[];
  entryIds?: string[];
}): Promise<DiscardAiJobResultItemsResult> {
  const requestedFolderIds = new Set(input.folderIds ?? []);
  const requestedEntryIds = new Set(input.entryIds ?? []);
  const removedFolderIds = new Set<string>();
  const removedEntryIds = new Set<string>();

  for (const job of aiJobs.values()) {
    if (!job.result) continue;
    const folderIds = collectResultFolderSubtree(job.result.folders, requestedFolderIds);
    const beforeFolderCount = job.result.folders.length;
    const beforeEntryCount = job.result.entries.length;
    const folders = job.result.folders.filter((folder) => {
      const remove = folderIds.has(folder.id);
      if (remove) removedFolderIds.add(folder.id);
      return !remove;
    });
    const entries = job.result.entries.filter((entry) => {
      const remove = requestedEntryIds.has(entry.id) || Boolean(entry.folderId && folderIds.has(entry.folderId));
      if (remove) removedEntryIds.add(entry.id);
      return !remove;
    });
    if (folders.length === beforeFolderCount && entries.length === beforeEntryCount) continue;
    job.result = { ...job.result, folders, entries };
    await touchJob(job);
  }

  return {
    folderIds: [...removedFolderIds],
    entryIds: [...removedEntryIds],
  };
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
  schedulePruneJobs();
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
  schedulePruneJobs();
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
  schedulePruneJobs();
  scheduleJob(job);
  return job;
}

export async function startFolderFullJob(input: {
  kbId: string;
  kbName: string;
  parentId: string | null;
  targetPath: string;
  domain: string;
  folderCount: number;
}): Promise<AiKnowledgeBaseJob> {
  const job = createBaseJob({
    kind: 'folder-full',
    domain: input.domain,
    questionCount: input.folderCount,
    kbId: input.kbId,
    kbName: input.kbName,
    parentId: input.parentId,
    targetPath: input.targetPath,
    logs: ['目录和知识点一键生成任务已创建，等待后台执行'],
  });
  aiJobs.set(job.id, job);
  await persistJob(job);
  schedulePruneJobs();
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
  schedulePruneJobs();
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
  schedulePruneJobs();
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
  schedulePruneJobs();
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
          : job.kind === 'folder-full'
            ? '服务已恢复，继续目录和知识点一键生成任务'
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
  if (job.status !== 'queued' && job.status !== 'running') return compactJobSnapshot(job);
  job.status = 'cancelled';
  job.error = '用户已取消任务';
  job.abortRequested = true;
  finishJobTimer(job);
  queuedJobIds.delete(id);
  runningControllers.get(id)?.abort();
  await pushJobLog(job, '任务已取消');
  return compactJobSnapshot(job);
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
    job.agentPhase = undefined;
    job.rollback = undefined;
    job.plan = undefined;
    job.result = undefined;
    await pushJobLog(job, '重新提交 AI 调整任务，将基于当前知识库重新规划');
    scheduleJob(job);
    return jobSnapshot(job);
  }
  if (job.kind === 'folder-init' || job.kind === 'folder-entries' || job.kind === 'folder-full') {
    if (!job.kbId || !job.kbName) return null;
    job.status = 'queued';
    job.error = undefined;
    job.abortRequested = false;
    await pushJobLog(job, job.kind === 'folder-init'
      ? '重新提交目录初始化任务'
      : job.kind === 'folder-entries'
        ? '重新提交目录知识点生成任务'
        : '重新提交目录和知识点一键生成任务');
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

export async function applyAgentEditJob(id: string): Promise<AiKnowledgeBaseJob | null> {
  const job = aiJobs.get(id);
  if (!job || job.kind !== 'agent-edit') return null;
  if (job.status === 'queued' || job.status === 'running') return jobSnapshot(job);
  const plan = planFromJob(job);
  if (!plan) return null;
  if (!job.kbId || !job.kbName || !job.instruction || !await getKb(job.kbId)) return null;
  if (job.agentPhase === 'applied') return jobSnapshot(job);
  job.plan = plan;
  job.status = 'queued';
  job.error = undefined;
  job.abortRequested = false;
  job.agentPhase = 'applying';
  job.rollback = undefined;
  await pushJobLog(job, '用户已确认调整计划，等待后台应用');
  scheduleJob(job);
  return jobSnapshot(job);
}

function folderDepthById(folderId: string, folders: Folder[]): number {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  let depth = 0;
  let cursor = byId.get(folderId);
  const seen = new Set<string>();
  while (cursor?.parentId && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    depth += 1;
    cursor = byId.get(cursor.parentId);
  }
  return depth;
}

function folderSubtreeFromSnapshot(folderId: string, folders: Folder[]): Set<string> {
  const ids = new Set<string>([folderId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) {
        ids.add(folder.id);
        changed = true;
      }
    }
  }
  return ids;
}

function folderPathLabelFromSnapshot(folderId: string, foldersById: Map<string, Folder>): string {
  const names: string[] = [];
  const seen = new Set<string>();
  let current = foldersById.get(folderId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    current = current.parentId ? foldersById.get(current.parentId) : undefined;
  }
  return names.join(' / ') || '根层级';
}

async function revertAgentEditRollback(job: AiKnowledgeBaseJob): Promise<void> {
  if (!job.kbId || !job.rollback) throw new Error('缺少可撤销的 AI 调整记录');
  const rollback = job.rollback;
  const createdEntryIds = new Set(rollback.createdEntryIds);
  const createdFolderIds = new Set(rollback.createdFolderIds);

  for (const before of rollback.updatedEntries) {
    const current = await getEntry(before.id);
    if (!current) continue;
    await createEntryVersion(current, 'ai-agent-rollback');
    await updateEntry(before.id, entryToInput(before));
    await pushJobLog(job, `撤销：已恢复知识点「${before.title}」`);
  }

  for (const before of rollback.renamedFolders) {
    const current = await getFolder(before.id);
    if (!current) continue;
    await renameFolder(before.id, before.name);
    await pushJobLog(job, `撤销：已恢复目录名「${before.name}」`);
  }

  for (const entryId of [...createdEntryIds]) {
    const current = await getEntry(entryId);
    if (!current) continue;
    await deleteEntry(entryId);
    await pushJobLog(job, `撤销：已删除新增知识点「${current.title}」`);
  }

  const foldersForDepth = await listFolders();
  const folderIds = [...createdFolderIds].sort((a, b) => folderDepthById(b, foldersForDepth) - folderDepthById(a, foldersForDepth));
  for (const folderId of folderIds) {
    const folders = await listFolders();
    const current = folders.find((folder) => folder.id === folderId);
    if (!current) continue;
    const subtree = folderSubtreeFromSnapshot(folderId, folders);
    const hasForeignFolder = folders.some((folder) => subtree.has(folder.id) && !createdFolderIds.has(folder.id));
    const entries = await listEntries();
    const hasForeignEntry = entries.some((entry) => entry.folderId && subtree.has(entry.folderId) && !createdEntryIds.has(entry.id));
    if (hasForeignFolder || hasForeignEntry) {
      await pushJobLog(job, `撤销：跳过目录「${current.name}」，其中已有非本次 AI 新增内容`);
      continue;
    }
    await deleteFolder(folderId);
    await pushJobLog(job, `撤销：已删除新增目录「${current.name}」`);
  }

  rollback.revertedAt = Date.now();
  job.rollback = rollback;
}

export async function revertAgentEditJob(id: string): Promise<AiKnowledgeBaseJob | null> {
  const job = aiJobs.get(id);
  if (!job || job.kind !== 'agent-edit') return null;
  if (job.status === 'queued' || job.status === 'running') return jobSnapshot(job);
  if (job.agentPhase !== 'applied' || !job.rollback) return null;
  job.status = 'running';
  job.error = undefined;
  job.abortRequested = false;
  resetJobStats(job);
  await pushJobLog(job, '开始撤销本次 AI 调整');
  try {
    await revertAgentEditRollback(job);
    job.agentPhase = 'reverted';
    job.status = 'succeeded';
    job.abortRequested = false;
    await pushJobLog(job, 'AI 调整已撤销');
    await refreshAgentEditResult(job);
  } catch (err) {
    job.status = 'failed';
    job.error = err instanceof Error ? err.message : String(err);
    await pushJobLog(job, job.error);
    await touchJob(job);
  } finally {
    finishJobTimer(job);
    await touchJob(job);
  }
  return jobSnapshot(job);
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
  queuedJobIds.delete(job.id);
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

function isAgentEditPlan(value: unknown): value is AgentEditPlan {
  const plan = value as AgentEditPlan | undefined;
  return Boolean(plan && typeof plan === 'object' && typeof plan.summary === 'string' && Array.isArray(plan.actions));
}

function planFromJob(job: AiKnowledgeBaseJob): AgentEditPlan | null {
  if (isAgentEditPlan(job.plan)) return job.plan;
  const marker = job.modelOutput.indexOf('---JSON---');
  if (marker < 0) return null;
  try {
    const parsed = JSON.parse(job.modelOutput.slice(marker + '---JSON---'.length).trim()) as unknown;
    return isAgentEditPlan(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function entryToInput(entry: Entry) {
  return {
    title: entry.title,
    kbId: entry.kbId,
    folderId: entry.folderId,
    cat: entry.cat,
    py: entry.py,
    tags: [...entry.tags],
    summary: entry.summary,
    intro: entry.intro,
    nodes: cloneJson(entry.nodes),
    doc: entry.doc ? cloneJson(entry.doc) : undefined,
  };
}

async function findExistingFolder(kbId: string, name: string, parentId: string | null): Promise<Folder | null> {
  const target = name.trim();
  if (!target) return null;
  return (await listFolders()).find((folder) => folder.kbId === kbId && folder.parentId === parentId && folder.name === target) ?? null;
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

async function buildAgentEditDraft(job: AiKnowledgeBaseJob, controller: AbortController, jobId: string): Promise<void> {
  if (!job.kbId || !job.instruction) throw new Error('缺少知识库或调整指令');
  const kb = await getKb(job.kbId);
  if (!kb) throw new Error('知识库不存在');

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
  job.plan = planned.plan;
  job.agentPhase = 'draft';
  job.rollback = undefined;
  job.result = undefined;
  job.modelOutput = trimJobOutput([
    `用户想法：${job.instruction}`,
    '',
    `执行摘要：${planned.plan.summary}`,
    '',
    '---JSON---',
    JSON.stringify(planned.plan, null, 2),
  ].join('\n'));
  job.parsed = { kbName: kb.name, folders: counts.structure, questions: counts.content };
  job.status = 'succeeded';
  job.abortRequested = false;
  await pushJobLog(job, `计划已生成：${counts.structure} 个结构动作 · ${counts.content} 个内容动作，等待确认应用`);
  await touchJob(job);
}

async function applyAgentEditPlanToKb(job: AiKnowledgeBaseJob, controller: AbortController, jobId: string): Promise<void> {
  if (!job.kbId || !job.instruction) throw new Error('缺少知识库或调整指令');
  const kb = await getKb(job.kbId);
  if (!kb) throw new Error('知识库不存在');
  const plan = planFromJob(job);
  if (!plan) throw new Error('缺少待应用的 AI 调整计划');
  job.plan = plan;
  job.agentPhase = 'applying';
  await refreshAgentEditResult(job);

  const rollback: AgentEditRollback = {
    createdFolderIds: [],
    createdEntryIds: [],
    updatedEntries: [],
    renamedFolders: [],
    appliedAt: Date.now(),
  };
  const recordEntry = (entry: Entry): void => {
    if (!rollback.updatedEntries.some((item) => item.id === entry.id)) rollback.updatedEntries.push(cloneJson(entry));
  };
  const recordFolder = (folder: Folder): void => {
    if (!rollback.renamedFolders.some((item) => item.id === folder.id)) rollback.renamedFolders.push(cloneJson(folder));
  };

  const folderRefs = new Map<string, string>();
  const actions = plan.actions;
  await pushJobLog(job, `开始应用调整计划：${actions.length} 个动作`);
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
      const existed = await findExistingFolder(kb.id, action.name ?? action.title, parentId);
      const folder = await ensureFolder(kb.id, action.name ?? action.title, parentId);
      if (!existed && !rollback.createdFolderIds.includes(folder.id)) rollback.createdFolderIds.push(folder.id);
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
      recordFolder(folder);
      const renamed = await renameFolder(folder.id, action.name);
      await pushJobLog(job, `动作 ${label}：已重命名目录为「${renamed?.name ?? action.name}」`);
      await refreshAgentEditResult(job);
      continue;
    }

    if (action.kind === 'move-entry') {
      if (!action.entryId) throw new Error('移动知识点动作缺少 entryId');
      const current = await getEntry(action.entryId);
      if (!current || current.kbId !== kb.id) throw new Error('知识点不存在或不属于当前知识库');
      recordEntry(current);
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
      rollback.createdEntryIds.push(entry.id);
      await pushJobLog(job, `动作 ${label}：已新增知识点「${entry.title}」`);
      await refreshAgentEditResult(job);
      continue;
    }

    if (action.kind === 'rewrite-entry') {
      if (!action.entryId) throw new Error('改写知识点动作缺少 entryId');
      const current = await getEntry(action.entryId);
      if (!current || current.kbId !== kb.id) throw new Error('知识点不存在或不属于当前知识库');
      recordEntry(current);
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

  job.rollback = rollback;
  job.agentPhase = 'applied';
  job.status = 'succeeded';
  job.abortRequested = false;
  await pushJobLog(job, `AI 调整已应用：${kb.name}`);
  await refreshAgentEditResult(job);
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
  await pushJobLog(job, job.agentPhase === 'applying' ? '开始应用 AI 调整计划' : 'AI 调整任务已启动');
  try {
    if (job.agentPhase === 'applying') await applyAgentEditPlanToKb(job, controller, jobId);
    else await buildAgentEditDraft(job, controller, jobId);
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
    let plan = isGeneratedKbDraft(job.plan) ? job.plan : extractPlanFromOutput(job);
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

type FolderEntryTargetMode = 'empty-leaves' | 'coverage';

interface FolderEntryTarget {
  folder: Folder;
  path: string[];
  focusHint: string;
}

interface FolderEntryTargetOptions {
  mode?: FolderEntryTargetMode;
  requestedFolderCount?: number;
  targetFolderIds?: string[];
}

const AUTO_ENTRY_FOCUS_HINTS = [
  '基础要点：先把定义、边界和常见问法讲清楚',
  '核心流程：围绕一次完整执行链路展开',
  '关键机制：解释底层原理、触发条件和实现细节',
  '对比辨析：拆清相近概念的差异和适用场景',
  '工程排障：围绕线上问题定位和证据链展开',
  '性能优化：说明指标、参数和取舍',
  '高频追问：整理常被追问的问题和答题抓手',
  '项目表达：说明在真实项目中如何落地和描述',
];

function folderFullTargetLimit(requestedFolderCount: number | undefined, scopedFolderCount: number): number {
  const basis = Math.max(1, requestedFolderCount ?? scopedFolderCount, scopedFolderCount);
  return Math.min(10, Math.max(3, basis));
}

function folderFullFallbackTargetCount(requestedFolderCount: number | undefined, uniqueTargetCount: number): number {
  if (uniqueTargetCount === 0) return 0;
  if (uniqueTargetCount <= 2) return Math.min(6, Math.max(uniqueTargetCount * 2, requestedFolderCount ?? uniqueTargetCount));
  if (uniqueTargetCount <= 4) return Math.min(8, Math.max(uniqueTargetCount, requestedFolderCount ?? uniqueTargetCount));
  return uniqueTargetCount;
}

async function collectFolderEntryTargets(kbId: string, parentId: string | null, options: FolderEntryTargetOptions = {}): Promise<FolderEntryTarget[]> {
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
  const targetFolderIds = options.targetFolderIds?.length ? new Set(options.targetFolderIds) : null;
  const targetScoped = targetFolderIds ? scoped.filter((folder) => targetFolderIds.has(folder.id)) : scoped;
  const childScope = targetFolderIds ?? scopeIds;
  const leaves = targetScoped.filter((folder) => !(childrenByParent.get(folder.id) ?? []).some((child) => childScope.has(child.id)));
  const candidates = leaves.length ? leaves : targetScoped;
  const mode = options.mode ?? 'empty-leaves';
  if (mode === 'empty-leaves') {
    return candidates
      .filter((folder) => (directEntryCounts.get(folder.id) ?? 0) === 0)
      .map((folder, index) => ({ folder, path: folderPathParts(folder, byId), focusHint: AUTO_ENTRY_FOCUS_HINTS[index % AUTO_ENTRY_FOCUS_HINTS.length] }));
  }

  const ordered: Folder[] = [];
  const seen = new Set<string>();
  const add = (folder: Folder): void => {
    if (seen.has(folder.id)) return;
    seen.add(folder.id);
    ordered.push(folder);
  };

  for (const folder of candidates) if ((directEntryCounts.get(folder.id) ?? 0) === 0) add(folder);
  for (const folder of targetScoped) if ((directEntryCounts.get(folder.id) ?? 0) === 0) add(folder);
  for (const folder of candidates) add(folder);
  for (const folder of targetScoped) add(folder);

  const uniqueLimit = Math.min(ordered.length, folderFullTargetLimit(options.requestedFolderCount, targetScoped.length));
  const targets = ordered.slice(0, uniqueLimit).map((folder, index) => ({
    folder,
    path: folderPathParts(folder, byId),
    focusHint: AUTO_ENTRY_FOCUS_HINTS[index % AUTO_ENTRY_FOCUS_HINTS.length],
  }));
  const fallbackCount = folderFullFallbackTargetCount(options.requestedFolderCount, targets.length);
  const baseTargets = [...targets];
  for (let index = targets.length; index < fallbackCount; index += 1) {
    const target = baseTargets[index % baseTargets.length];
    targets.push({
      ...target,
      focusHint: AUTO_ENTRY_FOCUS_HINTS[index % AUTO_ENTRY_FOCUS_HINTS.length],
    });
  }
  return targets;
}

function folderEntryTopic(target: FolderEntryTarget, currentIndex: number, total: number, mode: FolderEntryTargetMode): string {
  const pathLabel = target.path.join(' / ') || target.folder.name;
  const coverageMode = mode === 'coverage';
  return [
    '请基于当前目录自动生成一个工程面试知识点，用户没有额外输入题目。',
    coverageMode
      ? '当前是一键目录和知识点模式：目录已经是分类容器，知识点要比目录更具体，但内容要完整覆盖该目录最核心的基础要点、机制细节、高频追问和易错点。'
      : '当前是按目录补全模式：如果目录很具体，生成一个聚焦知识点；如果目录本身是宽主题，可以生成目录级综合复习知识点，不要强行缩成一个很小的考点。',
    `目录路径：${pathLabel}`,
    `目标目录：${target.folder.name}`,
    `本次序号：${currentIndex}/${total}`,
    `建议切入角度：${target.focusHint}`,
    '内容要求：先写基本概念和必背结论，再补充原理、对比、工程场景、排查或性能取舍；不要只写摘要。',
    '结构要求：使用 6-12 个领域内自然小节；每节 3-8 条短要点；适合对比的内容用表格或“方案：差异/场景/边界”表达。',
    '边界要求：不要把整个知识库的所有同级目录塞进一篇；也不要为了“单一”而只产出一两个零散点。',
  ].join('\n');
}

async function generateFolderEntriesForJob(
  job: AiKnowledgeBaseJob,
  controller: AbortController,
  jobId: string,
  options: FolderEntryTargetOptions = {},
): Promise<void> {
  if (!job.kbId) throw new Error('知识库不存在');
  const kb = await getKb(job.kbId);
  if (!kb) throw new Error('知识库不存在');
  const result = await hydrateKnowledgeBaseResult(job);
  if (!result) throw new Error('知识库不存在');

  const writer = await createKnowledgeBaseWriterFromExisting(result);
  let targets = await collectFolderEntryTargets(kb.id, job.parentId ?? null, options);
  if ((options.mode ?? 'empty-leaves') === 'empty-leaves') job.questionCount = targets.length;
  job.parsed = { kbName: kb.name, folders: writer.folders.length, questions: writer.entries.length };
  await updateJobResult(job, writer);
  if (!targets.length) {
    await pushJobLog(job, (options.mode ?? 'empty-leaves') === 'coverage'
      ? '当前目录范围没有可生成知识点的目录'
      : '当前目录范围没有需要补全的空叶子目录');
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
    const target = (options.mode ?? 'empty-leaves') === 'coverage'
      ? targets[completed]
      : (await collectFolderEntryTargets(kb.id, job.parentId ?? null, options))[0];
    if (!target) break;
    const pathLabel = target.path.join(' / ') || target.folder.name;
    const currentIndex = completed + 1;
    if (!await getFolder(target.folder.id)) {
      await pushJobLog(job, `目录已不存在，跳过 ${currentIndex}/${total}：${pathLabel}`);
      completed += 1;
      continue;
    }
    const topic = folderEntryTopic(target, currentIndex, total, options.mode ?? 'empty-leaves');
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
    const liveTargetFolder = await getFolder(target.folder.id);
    if (!liveTargetFolder) {
      await pushJobLog(job, `目录已删除，跳过写入 ${currentIndex}/${total}：${pathLabel}`);
      completed += 1;
      continue;
    }

    const entry = await createEntry({ ...illustrated, kbId: kb.id, folderId: liveTargetFolder.id });
    writer.entries.push(entry);
    job.parsed = { kbName: kb.name, folders: writer.folders.length, questions: writer.entries.length };
    await updateJobResult(job, writer);
    await pushJobLog(job, `已写入目录知识点 ${currentIndex}/${total}：${entry.title}`);
    completed += 1;
  }

  await pushJobLog(job, `已完成：${kb.name} · ${writer.folders.length} 个目录 · ${writer.entries.length} 条知识点`);
  await touchJob(job);
}

function oneClickFolderPathLimit(folderCount: number): number {
  const requested = Number.isFinite(folderCount) ? Math.floor(folderCount) : 6;
  return Math.min(6, Math.max(4, requested));
}

function compactFolderDraftForOneClick(draft: GeneratedFolderTreeDraft, folderCount: number): GeneratedFolderTreeDraft {
  const limit = oneClickFolderPathLimit(folderCount);
  if (draft.folders.length <= limit) return draft;
  const folders: GeneratedFolderTreeDraft['folders'] = [];
  const seen = new Set<string>();
  for (const folder of draft.folders) {
    const path = folder.path.map((part) => String(part ?? '').trim()).filter(Boolean);
    if (!path.length) continue;
    const key = path.map((part) => part.toLowerCase()).join('\u0000');
    if (seen.has(key)) continue;
    seen.add(key);
    folders.push({ ...folder, path });
    if (folders.length >= limit) break;
  }
  return folders.length ? { ...draft, folders } : draft;
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
    await generateFolderEntriesForJob(job, controller, jobId);
    if (isJobCancelled(jobId)) return;
    job.status = 'succeeded';
    job.abortRequested = false;
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

async function initializeFoldersForJob(
  job: AiKnowledgeBaseJob,
  controller: AbortController,
  jobId: string,
  folderCount: number,
): Promise<GeneratedKnowledgeBaseResult> {
  if (!job.kbId) throw new Error('知识库不存在');
  const kb = await getKb(job.kbId);
  if (!kb) throw new Error('知识库不存在');
  const allFolders = await listFolders();
  const existingFoldersInKb = allFolders.filter((folder) => folder.kbId === kb.id);
  const foldersById = new Map(existingFoldersInKb.map((folder) => [folder.id, folder]));
  const existingFolders = existingFoldersInKb.map((folder) => folderPathLabelFromSnapshot(folder.id, foldersById));
  const draft = await generateFolderTreeDraftStream({
    domain: job.domain,
    kbName: kb.name,
    targetPath: job.targetPath,
    existingFolders,
    folderCount,
    compact: job.kind === 'folder-full',
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
  if (isJobCancelled(jobId)) {
    const err = new Error('aborted');
    err.name = 'AbortError';
    throw err;
  }

  await pushJobLog(job, '开始写入文件目录');
  const draftToWrite = job.kind === 'folder-full' ? compactFolderDraftForOneClick(draft, folderCount) : draft;
  if (draftToWrite.folders.length < draft.folders.length) {
    await pushJobLog(job, `目录规划过细，已压缩为 ${draftToWrite.folders.length} 个分类目录`);
  }
  const result = await createFoldersFromDraft(kb, job.parentId ?? null, draftToWrite, {
    reuseExisting: job.kind !== 'folder-full',
  });
  job.result = result;
  await pushJobLog(job, `目录已写入：${kb.name} · ${result.folders.length} 个目录`);
  await touchJob(job);
  return result;
}

async function runFolderInitJob(jobId: string, folderCount: number): Promise<void> {
  const job = aiJobs.get(jobId);
  if (!job || job.status === 'cancelled') return;
  if (runningControllers.has(jobId)) return;
  const controller = new AbortController();
  runningControllers.set(jobId, controller);
  job.status = 'running';
  job.abortRequested = false;
  resetJobStats(job);
  await pushJobLog(job, '后台目录初始化已启动');
  try {
    const result = await initializeFoldersForJob(job, controller, jobId, folderCount);
    if (isJobCancelled(jobId)) return;
    job.status = 'succeeded';
    job.abortRequested = false;
    await pushJobLog(job, `已完成：${result.kb.name} · ${result.folders.length} 个目录`);
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

async function runFolderFullJob(jobId: string, folderCount: number): Promise<void> {
  const job = aiJobs.get(jobId);
  if (!job || job.status === 'cancelled') return;
  if (runningControllers.has(jobId)) return;
  const controller = new AbortController();
  runningControllers.set(jobId, controller);
  job.status = 'running';
  job.abortRequested = false;
  resetJobStats(job);
  await pushJobLog(job, '后台目录和知识点一键生成已启动');
  try {
    const result = await initializeFoldersForJob(job, controller, jobId, folderCount);
    if (isJobCancelled(jobId)) return;
    job.parsed = { kbName: result.kb.name, folders: result.folders.length, questions: 0 };
    await updateJobResult(job, result);
    await pushJobLog(job, '目录阶段完成，开始按新目录补全知识点');
    await generateFolderEntriesForJob(job, controller, jobId, {
      mode: 'coverage',
      requestedFolderCount: folderCount,
      targetFolderIds: result.folders.map((folder) => folder.id),
    });
    if (isJobCancelled(jobId)) return;
    job.status = 'succeeded';
    job.abortRequested = false;
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
