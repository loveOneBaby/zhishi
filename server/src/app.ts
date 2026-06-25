import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import {
  seedBuiltins,
  listEntries,
  getEntry,
  createEntry,
  updateEntry,
  deleteEntry,
  reorderEntries,
  importEntries,
  exportData,
  buildImportPreview,
  listKbs,
  getKb,
  createKb,
  renameKb,
  deleteKb,
  reorderKbs,
  listFolders,
  getFolder,
  createFolder,
  ensureFolder,
  renameFolder,
  moveFolder,
  deleteFolder,
  reorderFolders,
  createDataAsset,
  registerExternalAsset,
  getAsset,
  getAssetBytes,
  type EntryInput,
  type ImportPayload,
  type ImportKb,
  type ImportFolder,
} from './db.js';
import { convertEntry } from './blocks-import.js';
import { knowledgeTreeToImportPayload } from './knowledge-tree-import.js';
import { isKbPackage2, kbPackage2ToImportPayload } from './kb-package-2.js';
import { searchEntries } from './search.js';
import { askAI } from './ask.js';
import { AiConfigError } from './ai-client.js';
import {
  generateEntryInput,
  generateEntryInputStream,
  generateFolderTreeDraftStream,
  generateKnowledgeBaseDraftStream,
  type GeneratedFolderTreeDraft,
  type GeneratedKbDraft,
  kbQuestionToEntryInput,
  rewriteEntryInputStream,
  type GenerateEntryEvent,
  type GenerateFolderTreeEvent,
  type GenerateKnowledgeBaseEvent,
} from './ai-generate.js';

function stableImportId(prefix: string, seed: string): string {
  return `${prefix}_${createHash('sha1').update(seed).digest('hex').slice(0, 18)}`;
}

function folderPathLabel(folderId: string | null): string {
  if (!folderId) return '根层级';
  const folders = listFolders();
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const names: string[] = [];
  const seen = new Set<string>();
  let current = byId.get(folderId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return names.join(' / ') || '根层级';
}

function sendSse(res: express.Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function pathKey(parts: string[]): string {
  return parts.join('\u0000');
}

type AiJobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

interface GeneratedKnowledgeBaseResult {
  kb: ReturnType<typeof createKb>;
  folders: NonNullable<ReturnType<typeof createFolder>>[];
  entries: ReturnType<typeof createEntry>[];
}

interface AiKnowledgeBaseJob {
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
  createdAt: number;
  updatedAt: number;
}

const aiJobs = new Map<string, AiKnowledgeBaseJob>();
const MAX_JOB_OUTPUT = 160_000;
const MAX_JOBS = 30;

function trimJobOutput(value: string): string {
  return value.length > MAX_JOB_OUTPUT ? value.slice(-MAX_JOB_OUTPUT) : value;
}

function touchJob(job: AiKnowledgeBaseJob): void {
  job.updatedAt = Date.now();
}

function pushJobLog(job: AiKnowledgeBaseJob, message: string): void {
  const next = message.trim();
  if (!next) return;
  if (job.logs[job.logs.length - 1] !== next) job.logs.push(next);
  if (job.logs.length > 60) job.logs = job.logs.slice(-60);
  touchJob(job);
}

function jobSnapshot(job: AiKnowledgeBaseJob): AiKnowledgeBaseJob {
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

function listJobSnapshots(): AiKnowledgeBaseJob[] {
  return [...aiJobs.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(jobSnapshot);
}

function pruneJobs(): void {
  const jobs = [...aiJobs.values()].sort((a, b) => b.createdAt - a.createdAt);
  const removable = jobs.slice(MAX_JOBS).filter((job) => job.status !== 'running' && job.status !== 'queued');
  for (const job of removable) aiJobs.delete(job.id);
}

function createKnowledgeBaseFromDraft(domain: string, draft: GeneratedKbDraft): GeneratedKnowledgeBaseResult {
  const kb = createKb(draft.kbName);
  const folderByPath = new Map<string, NonNullable<ReturnType<typeof createFolder>>>();
  const createdFolders: NonNullable<ReturnType<typeof createFolder>>[] = [];

  const ensurePath = (parts: string[]): string | null => {
    let parentId: string | null = null;
    const current: string[] = [];
    for (const raw of parts) {
      const name = raw.trim();
      if (!name) continue;
      current.push(name);
      const key = pathKey(current);
      const existing = folderByPath.get(key);
      if (existing) {
        parentId = existing.id;
        continue;
      }
      const folder = createFolder({ kbId: kb.id, parentId, name });
      if (!folder) throw new Error('目录创建失败');
      folderByPath.set(key, folder);
      createdFolders.push(folder);
      parentId = folder.id;
    }
    return parentId;
  };

  for (const folder of draft.folders) ensurePath(folder.path);
  const entries = draft.questions.map((question) => {
    const folderId = ensurePath(question.folderPath);
    return createEntry({
      ...kbQuestionToEntryInput(question, domain),
      kbId: kb.id,
      folderId,
    });
  });

  return { kb, folders: createdFolders, entries };
}

function createFoldersFromDraft(
  kb: ReturnType<typeof createKb>,
  parentId: string | null,
  draft: GeneratedFolderTreeDraft,
): GeneratedKnowledgeBaseResult {
  const folderByPath = new Map<string, NonNullable<ReturnType<typeof createFolder>>>();
  const touchedFolders: NonNullable<ReturnType<typeof createFolder>>[] = [];
  const touchedIds = new Set<string>();

  const ensurePath = (parts: string[]): void => {
    let currentParentId = parentId;
    const current: string[] = [];
    for (const raw of parts) {
      const name = raw.trim();
      if (!name) continue;
      current.push(name);
      const key = pathKey([parentId ?? 'root', ...current]);
      const existing = folderByPath.get(key);
      if (existing) {
        currentParentId = existing.id;
        continue;
      }
      const folder = ensureFolder(kb.id, name, currentParentId);
      folderByPath.set(key, folder);
      if (!touchedIds.has(folder.id)) {
        touchedIds.add(folder.id);
        touchedFolders.push(folder);
      }
      currentParentId = folder.id;
    }
  };

  for (const folder of draft.folders) ensurePath(folder.path);
  return { kb, folders: touchedFolders, entries: [] };
}

function startKnowledgeBaseJob(domain: string, questionCount: number): AiKnowledgeBaseJob {
  const now = Date.now();
  const job: AiKnowledgeBaseJob = {
    id: `job_${now.toString(36)}_${randomUUID().slice(0, 8)}`,
    kind: 'kb-generate',
    domain,
    questionCount,
    status: 'queued',
    logs: ['任务已创建，等待后台执行'],
    modelOutput: '',
    createdAt: now,
    updatedAt: now,
  };
  aiJobs.set(job.id, job);
  pruneJobs();
  setTimeout(() => { void runKnowledgeBaseJob(job.id); }, 0);
  return job;
}

function startFolderInitJob(input: {
  kbId: string;
  kbName: string;
  parentId: string | null;
  targetPath: string;
  domain: string;
  folderCount: number;
}): AiKnowledgeBaseJob {
  const now = Date.now();
  const job: AiKnowledgeBaseJob = {
    id: `job_${now.toString(36)}_${randomUUID().slice(0, 8)}`,
    kind: 'folder-init',
    domain: input.domain,
    questionCount: 0,
    kbId: input.kbId,
    kbName: input.kbName,
    parentId: input.parentId,
    targetPath: input.targetPath,
    status: 'queued',
    logs: ['目录初始化任务已创建，等待后台执行'],
    modelOutput: '',
    createdAt: now,
    updatedAt: now,
  };
  aiJobs.set(job.id, job);
  pruneJobs();
  setTimeout(() => { void runFolderInitJob(job.id, input.folderCount); }, 0);
  return job;
}

async function runKnowledgeBaseJob(jobId: string): Promise<void> {
  const job = aiJobs.get(jobId);
  if (!job) return;
  job.status = 'running';
  pushJobLog(job, '后台任务已启动');
  try {
    const draft = await generateKnowledgeBaseDraftStream({
      domain: job.domain,
      questionCount: job.questionCount,
    }, (event: GenerateKnowledgeBaseEvent) => {
      const current = aiJobs.get(jobId);
      if (!current) return;
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

    pushJobLog(job, '开始写入知识库');
    const result = createKnowledgeBaseFromDraft(job.domain, draft);
    job.result = result;
    job.status = 'succeeded';
    pushJobLog(job, `已完成：${result.kb.name} · ${result.folders.length} 个目录 · ${result.entries.length} 条知识点`);
    touchJob(job);
  } catch (err) {
    job.status = 'failed';
    job.error = err instanceof Error ? err.message : String(err);
    pushJobLog(job, job.error);
    touchJob(job);
  }
}

async function runFolderInitJob(jobId: string, folderCount: number): Promise<void> {
  const job = aiJobs.get(jobId);
  if (!job) return;
  job.status = 'running';
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
    }, (event: GenerateFolderTreeEvent) => {
      const current = aiJobs.get(jobId);
      if (!current) return;
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

    pushJobLog(job, '开始写入文件目录');
    const result = createFoldersFromDraft(kb, job.parentId ?? null, draft);
    job.result = result;
    job.status = 'succeeded';
    pushJobLog(job, `已完成：${kb.name} · ${result.folders.length} 个目录`);
    touchJob(job);
  } catch (err) {
    job.status = 'failed';
    job.error = err instanceof Error ? err.message : String(err);
    pushJobLog(job, job.error);
    touchJob(job);
  }
}

export function createApp() {
  seedBuiltins();

  const app = express();
  // 1mb 对常规接口足够；导入（kb-import-2，可能含大量条目）放宽到 5mb
  app.use(express.json({ limit: '5mb' }));

  const api = express.Router();

  // 健康检查
  api.get('/health', (_req, res) => res.json({ ok: true }));

  api.get('/ai/jobs', (_req, res) => {
    res.json({ jobs: listJobSnapshots() });
  });

  api.get('/ai/jobs/:id', (req, res) => {
    const job = aiJobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: '任务不存在' });
    res.json({ job: jobSnapshot(job) });
  });

  // ───────────── 知识库 ─────────────
  api.get('/kbs', (_req, res) => {
    res.json({ kbs: listKbs() });
  });

  api.post('/kbs', (req, res) => {
    const name = String(req.body?.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'name 不能为空' });
    const kb = createKb(name);
    res.status(201).json({ kb });
  });

  // AI 新建知识库后台任务：提交后立即返回 jobId，生成过程由服务端继续执行。
  api.post('/kbs/generate/jobs', (req, res) => {
    const domain = String(req.body?.domain ?? '').trim();
    const questionCount = Number(req.body?.questionCount ?? 14);
    if (!domain) return res.status(400).json({ error: 'domain 不能为空' });
    const job = startKnowledgeBaseJob(domain, Number.isFinite(questionCount) ? questionCount : 14);
    res.status(202).json({ job: jobSnapshot(job) });
  });

  // AI 初始化当前知识库文件目录：只创建文件夹，不生成知识点。
  api.post('/kbs/:id/folders/init/jobs', (req, res) => {
    const kb = getKb(req.params.id);
    if (!kb) return res.status(404).json({ error: '知识库不存在' });
    const requestedParentId = req.body?.parentId == null ? '' : String(req.body.parentId).trim();
    const parentId = requestedParentId || null;
    const parent = parentId ? getFolder(parentId) : null;
    if (parentId && !parent) return res.status(404).json({ error: '目标文件夹不存在' });
    if (parent && parent.kbId !== kb.id) return res.status(400).json({ error: '目标文件夹不属于当前知识库' });
    const domain = String(req.body?.domain ?? '').trim() || kb.name;
    const folderCount = Number(req.body?.folderCount ?? 18);
    const job = startFolderInitJob({
      kbId: kb.id,
      kbName: kb.name,
      parentId,
      targetPath: folderPathLabel(parentId),
      domain,
      folderCount: Number.isFinite(folderCount) ? folderCount : 18,
    });
    res.status(202).json({ job: jobSnapshot(job) });
  });

  // AI 新建知识库：按领域自动规划目录，并生成一批 Q&A 面试知识点。
  api.post('/kbs/generate/stream', async (req, res) => {
    const domain = String(req.body?.domain ?? '').trim();
    const questionCount = Number(req.body?.questionCount ?? 14);
    if (!domain) return res.status(400).json({ error: 'domain 不能为空' });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    sendSse(res, 'stage', { message: '准备创建知识库生成请求' });

    try {
      const draft = await generateKnowledgeBaseDraftStream({
        domain,
        questionCount: Number.isFinite(questionCount) ? questionCount : 14,
      }, (event: GenerateKnowledgeBaseEvent) => sendSse(res, event.type, event));

      sendSse(res, 'stage', { message: '写入新知识库、目录和 Q&A 知识点' });
      const payload = createKnowledgeBaseFromDraft(domain, draft);
      sendSse(res, 'saved-kb', payload);
      sendSse(res, 'done', payload);
      res.end();
    } catch (err) {
      sendSse(res, 'error', {
        configured: !(err instanceof AiConfigError),
        error: err instanceof Error ? err.message : String(err),
      });
      res.end();
    }
  });

  api.put('/kbs/:id', (req, res) => {
    const name = String(req.body?.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'name 不能为空' });
    const kb = renameKb(req.params.id, name);
    if (!kb) return res.status(404).json({ error: 'not found' });
    res.json({ kb });
  });

  api.delete('/kbs/:id', (req, res) => {
    const ok = deleteKb(req.params.id);
    if (!ok) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true, kbs: listKbs(), folders: listFolders(), entries: listEntries() });
  });

  api.post('/kbs/reorder', (req, res) => {
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.some((i: unknown) => typeof i !== 'string')) {
      return res.status(400).json({ error: 'ids 必须是字符串数组' });
    }
    reorderKbs(ids);
    res.json({ ok: true, kbs: listKbs() });
  });

  // ───────────── 文件夹 ─────────────
  api.get('/folders', (_req, res) => {
    res.json({ folders: listFolders() });
  });

  api.post('/folders', (req, res) => {
    const kbId = String(req.body?.kbId ?? '').trim();
    const name = String(req.body?.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'name 不能为空' });
    const parentId = req.body?.parentId ?? null;
    const folder = createFolder({ kbId, parentId, name });
    if (!folder) return res.status(400).json({ error: '知识库不存在或父文件夹无效' });
    res.status(201).json({ folder });
  });

  api.put('/folders/:id', (req, res) => {
    const name = String(req.body?.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'name 不能为空' });
    const folder = renameFolder(req.params.id, name);
    if (!folder) return res.status(404).json({ error: 'not found' });
    res.json({ folder });
  });

  api.post('/folders/move', (req, res) => {
    const id = String(req.body?.id ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id 不能为空' });
    const ok = moveFolder(id, {
      parentId: req.body?.parentId ?? null,
      kbId: req.body?.kbId,
    });
    if (!ok) return res.status(400).json({ error: '目标无效或会形成环' });
    res.json({ ok: true, folders: listFolders() });
  });

  api.delete('/folders/:id', (req, res) => {
    const ok = deleteFolder(req.params.id);
    if (!ok) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true, folders: listFolders(), entries: listEntries() });
  });

  api.post('/folders/reorder', (req, res) => {
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.some((i: unknown) => typeof i !== 'string')) {
      return res.status(400).json({ error: 'ids 必须是字符串数组' });
    }
    reorderFolders(ids);
    res.json({ ok: true, folders: listFolders() });
  });

  // ───────────── 知识点 ─────────────
  // 全部知识点
  api.get('/entries', (_req, res) => {
    res.json({ entries: listEntries() });
  });

  // 检索
  api.get('/search', (req, res) => {
    const q = String(req.query.q ?? '');
    const results = searchEntries(listEntries(), q);
    res.json({ query: q, count: results.length, results });
  });

  // AI 生成知识点：按当前知识库/文件夹直接创建一条结构化知识点
  api.post('/entries/generate', async (req, res) => {
    const topic = String(req.body?.topic ?? '').trim();
    const kbId = String(req.body?.kbId ?? '').trim();
    const requestedFolderId = req.body?.folderId == null ? '' : String(req.body.folderId).trim();
    const folderId = requestedFolderId || null;
    if (!topic) return res.status(400).json({ error: 'topic 不能为空' });
    if (!kbId) return res.status(400).json({ error: 'kbId 不能为空' });
    const kb = getKb(kbId);
    if (!kb) return res.status(404).json({ error: '知识库不存在' });
    const folder = folderId ? getFolder(folderId) : null;
    if (folderId && !folder) return res.status(404).json({ error: '文件夹不存在' });
    if (folder && folder.kbId !== kbId) return res.status(400).json({ error: '文件夹不属于当前知识库' });

    try {
      const context = searchEntries(listEntries().filter((entry) => entry.kbId === kbId), topic);
      const input = await generateEntryInput({
        topic,
        kbName: kb.name,
        folderPath: folderPathLabel(folderId),
        context,
      });
      const entry = createEntry({ ...input, kbId, folderId });
      res.status(201).json({ configured: true, entry });
    } catch (err) {
      if (err instanceof AiConfigError) {
        return res.json({ configured: false, error: err.message });
      }
      res.status(502).json({ configured: true, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // AI 生成知识点：SSE 流式返回真实阶段、上下文、模型输出片段和保存结果。
  api.post('/entries/generate/stream', async (req, res) => {
    const topic = String(req.body?.topic ?? '').trim();
    const kbId = String(req.body?.kbId ?? '').trim();
    const requestedFolderId = req.body?.folderId == null ? '' : String(req.body.folderId).trim();
    const folderId = requestedFolderId || null;
    if (!topic) return res.status(400).json({ error: 'topic 不能为空' });
    if (!kbId) return res.status(400).json({ error: 'kbId 不能为空' });
    const kb = getKb(kbId);
    if (!kb) return res.status(404).json({ error: '知识库不存在' });
    const folder = folderId ? getFolder(folderId) : null;
    if (folderId && !folder) return res.status(404).json({ error: '文件夹不存在' });
    if (folder && folder.kbId !== kbId) return res.status(400).json({ error: '文件夹不属于当前知识库' });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    sendSse(res, 'stage', { message: '准备生成请求' });

    try {
      const context = searchEntries(listEntries().filter((entry) => entry.kbId === kbId), topic);
      const input = await generateEntryInputStream({
        topic,
        kbName: kb.name,
        folderPath: folderPathLabel(folderId),
        context,
      }, (event: GenerateEntryEvent) => sendSse(res, event.type, event));
      sendSse(res, 'stage', { message: '写入当前知识库' });
      const entry = createEntry({ ...input, kbId, folderId });
      sendSse(res, 'saved', { entry });
      sendSse(res, 'done', { entry });
      res.end();
    } catch (err) {
      sendSse(res, 'error', {
        configured: !(err instanceof AiConfigError),
        error: err instanceof Error ? err.message : String(err),
      });
      res.end();
    }
  });

  // AI 改写知识点：读取当前 doc，流式返回改写说明与新结构，并原地更新当前 entry。
  api.post('/entries/:id/rewrite/stream', async (req, res) => {
    const current = getEntry(req.params.id);
    if (!current) return res.status(404).json({ error: '知识点不存在' });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    sendSse(res, 'stage', { message: '准备改写请求' });

    try {
      const input = await rewriteEntryInputStream({ entry: current }, (event: GenerateEntryEvent) => sendSse(res, event.type, event));
      sendSse(res, 'stage', { message: '写回当前知识点' });
      const entry = updateEntry(current.id, {
        ...input,
        kbId: current.kbId,
        folderId: current.folderId,
      });
      if (!entry) throw new Error('知识点不存在');
      sendSse(res, 'saved', { entry });
      sendSse(res, 'done', { entry });
      res.end();
    } catch (err) {
      sendSse(res, 'error', {
        configured: !(err instanceof AiConfigError),
        error: err instanceof Error ? err.message : String(err),
      });
      res.end();
    }
  });

  // 单条
  api.get('/entries/:id', (req, res) => {
    const e = getEntry(req.params.id);
    if (!e) return res.status(404).json({ error: 'not found' });
    res.json({ entry: e });
  });

  // 新建
  api.post('/entries', (req, res) => {
    const { title, kbId, folderId, cat, tags, py, summary, intro, nodes, doc } = req.body ?? {};
    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: 'title 不能为空' });
    }
    const entry = createEntry({ title, kbId, folderId, cat, tags, py, summary, intro, nodes, doc } as EntryInput);
    res.status(201).json({ entry });
  });

  // 导出全部知识库结构（备份）
  api.get('/export', (_req, res) => {
    res.json(exportData());
  });

  function requestToImportPayload(body: unknown): ImportPayload {
    const b = (body ?? {}) as {
      tree?: unknown;
      entries?: unknown;
      assets?: unknown;
      package?: unknown;
      schema?: unknown;
      containers?: unknown;
      extensions?: unknown;
      kbs?: unknown;
      folders?: unknown;
      targetKbId?: unknown;
      targetKbName?: unknown;
      targetFolderId?: unknown;
      importBatchId?: unknown;
    };
    const cleanText = (value: unknown): string | undefined => {
      if (typeof value !== 'string') return undefined;
      const trimmed = value.trim();
      return trimmed || undefined;
    };
    const targetFolderProvided = Object.prototype.hasOwnProperty.call(b, 'targetFolderId');
    const requestedFolderId = cleanText(b.targetFolderId);
    const targetFolder = requestedFolderId ? getFolder(requestedFolderId) : null;
    if (requestedFolderId && !targetFolder) throw new Error('目标文件夹不存在');

    const requestedKbId = cleanText(b.targetKbId);
    const targetKbId = requestedKbId || targetFolder?.kbId;
    const targetKb = targetKbId ? getKb(targetKbId) : null;
    if (targetKbId && !targetKb) throw new Error('目标知识库不存在');
    if (targetFolder && targetKbId && targetFolder.kbId !== targetKbId) throw new Error('目标文件夹不属于目标知识库');

    const targetKbName = cleanText(b.targetKbName) || targetKb?.name;
    const targetFolderId = targetFolderProvided ? (requestedFolderId ?? null) : undefined;
    const routedBody = {
      ...(body && typeof body === 'object' ? body as Record<string, unknown> : {}),
      ...(targetKbId ? { targetKbId } : {}),
      ...(targetKbName ? { targetKbName } : {}),
      ...(targetFolderProvided ? { targetFolderId: targetFolderId ?? null } : {}),
    };

    if (isKbPackage2(routedBody)) {
      return kbPackage2ToImportPayload(routedBody);
    }

    if (Array.isArray(b.tree)) {
      return knowledgeTreeToImportPayload(routedBody);
    }
    if (Array.isArray(b.entries)) {
      const assets = Array.isArray(b.assets) ? b.assets : [];
      // kb-export-2 备份：原样转发知识库与文件夹（folders 含 parentId 多级嵌套），
      // 由 importEntries 按依赖拓扑建入，保证文件夹/子文件夹结构能完整还原。
      const kbs: ImportKb[] | undefined = Array.isArray(b.kbs)
        ? b.kbs
            .map((k) => (k && typeof k === 'object' ? (k as Record<string, unknown>) : null))
            .filter((k): k is Record<string, unknown> => !!k && typeof k.name === 'string')
            .map((k) => ({
              id: typeof k.id === 'string' ? k.id : undefined,
              name: String(k.name),
              sort: typeof k.sort === 'number' ? k.sort : 0,
            }))
        : undefined;
      const folders: ImportFolder[] | undefined = Array.isArray(b.folders)
        ? b.folders
            .map((f) => (f && typeof f === 'object' ? (f as Record<string, unknown>) : null))
            .filter((f): f is Record<string, unknown> => !!f && typeof f.name === 'string')
            .map((f) => {
              const id = cleanText(f.id) || cleanText(f.sourceId);
              const parentId = cleanText(f.parentId) || cleanText(f.parentSourceId);
              const hasParentField = Object.prototype.hasOwnProperty.call(f, 'parentId')
                || Object.prototype.hasOwnProperty.call(f, 'parentSourceId');
              return {
                id,
                kbId: cleanText(f.kbId),
                parentId: parentId ?? (hasParentField ? null : undefined),
                name: String(f.name),
                sort: typeof f.sort === 'number' ? f.sort : 0,
              };
            })
        : undefined;
      const routed = Boolean(targetKbId || targetFolderProvided);
      const importBatchId = cleanText(b.importBatchId) || randomUUID();
      const folderIdMap = new Map<string, string>();
      const routedFolders: ImportFolder[] | undefined = routed && folders
        ? folders.map((folder, index) => {
            const sourceId = folder.id || `${folder.name}:${index}`;
            const nextId = stableImportId('fld', `${importBatchId}/${targetKbId ?? folder.kbId ?? 'kb'}/${sourceId}`);
            if (folder.id) folderIdMap.set(folder.id, nextId);
            return { ...folder, id: nextId };
          }).map((folder, index) => {
            const source = folders[index];
            const mappedParent = source.parentId ? folderIdMap.get(source.parentId) : undefined;
            return {
              ...folder,
              kbId: targetKbId ?? source.kbId,
              parentId: mappedParent ?? (targetFolderProvided ? targetFolderId ?? null : null),
            };
          })
        : folders;
      const entries = b.entries.map((e: unknown, index: number) => {
        const entry = convertEntry(e, assets);
        const sourceId = entry.id || `${entry.title ?? 'entry'}:${index}`;
        if (routed) entry.id = stableImportId('ke', `${importBatchId}/${targetKbId ?? entry.kbId ?? 'kb'}/${sourceId}`);
        if (targetKbId) entry.kbId = targetKbId;
        if (targetKbName) entry.cat = targetKbName;
        if (routed) {
          const mappedFolder = entry.folderId ? folderIdMap.get(entry.folderId) : undefined;
          if (mappedFolder) entry.folderId = mappedFolder;
          else if (targetFolderProvided) entry.folderId = targetFolderId ?? null;
          else if (targetKbId) entry.folderId = null;
        }
        return entry;
      });
      return {
        kbs: routed ? undefined : kbs,
        folders: routedFolders,
        entries,
        ...(targetKbId ? { targetKbId } : {}),
        ...(targetKbName ? { targetKbName } : {}),
        ...(targetFolderProvided ? { targetFolderId: targetFolderId ?? null } : {}),
        importBatchId,
      };
    }
    throw new Error('导入载荷需包含 kb-package-2 的 entries 数组');
  }

  // 导入：主格式为 kb-package-2；内部备份/撤销仍走 entries/folders 结构。
  api.post('/import', (req, res) => {
    try {
      const payload = requestToImportPayload(req.body);
      if (payload.entries.length > 5000) return res.status(400).json({ error: '单次导入不超过 5000 条' });
      const { imported } = importEntries(payload, Boolean(req.body?.replace));
      res.json({ ok: true, imported, kbs: listKbs(), folders: listFolders(), entries: listEntries() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // 导入预览：解析导入载荷，但不写库。
  api.post('/import/preview', (req, res) => {
    try {
      const payload = requestToImportPayload(req.body);
      if (payload.entries.length > 5000) return res.status(400).json({ error: '单次导入不超过 5000 条' });
      const preview = buildImportPreview(payload.entries, payload.folders);
      res.json({ preview });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // 排序（管理模块拖拽）：body = { ids: string[] }
  api.post('/entries/reorder', (req, res) => {
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.some((i: unknown) => typeof i !== 'string')) {
      return res.status(400).json({ error: 'ids 必须是字符串数组' });
    }
    reorderEntries(ids);
    res.json({ ok: true, entries: listEntries() });
  });

  // 更新
  api.put('/entries/:id', (req, res) => {
    const entry = updateEntry(req.params.id, req.body ?? {});
    if (!entry) return res.status(404).json({ error: 'not found' });
    res.json({ entry });
  });

  // 删除
  api.delete('/entries/:id', (req, res) => {
    const ok = deleteEntry(req.params.id);
    if (!ok) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  });

  // ───────────── 资源(图片) ─────────────
  // 上传:body = { dataUrl } 落库去重 / { url } 登记外链；alt 可选
  api.post('/assets', (req, res) => {
    const alt = String(req.body?.alt ?? '');
    const dataUrl = req.body?.dataUrl;
    const url = req.body?.url;
    if (typeof dataUrl === 'string' && dataUrl) {
      const asset = createDataAsset(dataUrl, alt);
      if (!asset) return res.status(400).json({ error: '无法解析 dataUrl' });
      return res.status(201).json({ asset });
    }
    if (typeof url === 'string' && url) {
      return res.status(201).json({ asset: registerExternalAsset(url, alt) });
    }
    res.status(400).json({ error: '需要 dataUrl 或 url' });
  });

  api.get('/assets/:id', (req, res) => {
    const a = getAsset(req.params.id);
    if (!a) return res.status(404).json({ error: 'not found' });
    res.json({ asset: a });
  });

  // 原始二进制(站内存储的 data 资源)
  api.get('/assets/:id/raw', (req, res) => {
    const a = getAsset(req.params.id);
    if (!a) return res.status(404).end();
    if (a.kind === 'external') return res.redirect(a.url);
    const raw = getAssetBytes(req.params.id);
    if (!raw) return res.status(404).end();
    res.setHeader('Content-Type', raw.mime || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(raw.bytes);
  });

  // AI 问答（预留接口）
  api.post('/ask', async (req, res) => {
    const q = String(req.body?.query ?? '').trim();
    if (!q) return res.status(400).json({ error: 'query 不能为空' });
    const context = searchEntries(listEntries(), q);
    const result = await askAI(q, context);
    res.json(result);
  });

  app.use('/api', api);

  // 生产环境：托管前端构建产物
  const webDist = path.resolve(process.cwd(), '../web/dist');
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get('*', (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }

  return app;
}
