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
} from '../../db.js';
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
} from '../../ai-generate.js';
import { appendAiIllustration } from '../../ai-image.js';
import type { AiTokenUsage } from '../../ai/types.js';
import { kbDraftFromModelOutput } from '../../ai/parse.js';
import { createFoldersFromDraft, createKnowledgeBaseWriterFromDraft, createKnowledgeBaseWriterFromExisting, type GeneratedKnowledgeBaseResult } from '../kb-draft-writer.js';
import { folderPathLabel } from '../utils.js';
import { searchEntries } from '../../search.js';
import { analyzeKnowledgeBase, analyzeEntry, type KbAnalysis } from '../../ai-analyze.js';
import { planKnowledgeBaseEdit, type AgentEditAction, type AgentEditPlan } from '../../ai-agent-edit.js';
import type { Entry, Folder } from '../../types.js';
import {
  type AiKnowledgeBaseJob,
  type AgentEditRollback,
  aiJobs,
  runningControllers,
  registerJobRunner,
  pushJobLog,
  touchJob,
  persistJob,
  recordUsage,
  resetJobStats,
  finishJobTimer,
  isJobCancelled,
  isAbortError,
  updateJobResult,
  refreshAgentEditResult,
  planFromJob,
  cloneJson,
  resolveAgentActionFolder,
  agentEditCounts,
  findExistingFolder,
  hydrateKnowledgeBaseResult,
  stopJobForDeletedKb,
  mergedTags,
  extractPlanFromOutput,
  isGeneratedKbDraft,
  trimJobOutput,
  folderPathLabelFromSnapshot,
} from '../ai-jobs-core.js';
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

registerJobRunner('folder-init', (job) => runFolderInitJob(job.id, job.questionCount || 18));
registerJobRunner('folder-entries', (job) => runFolderEntriesJob(job.id));
registerJobRunner('folder-full', (job) => runFolderFullJob(job.id, job.questionCount || 18));
