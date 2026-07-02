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

registerJobRunner('analyze', (job) => runAnalyzeJob(job.id));
