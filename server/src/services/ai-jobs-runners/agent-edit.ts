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

registerJobRunner('agent-edit', (job) => runAgentEditJob(job.id));
