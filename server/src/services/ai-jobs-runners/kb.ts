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

registerJobRunner('kb-generate', (job) => runKnowledgeBaseJob(job.id));
