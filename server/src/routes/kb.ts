import type { Router } from 'express';
import { AiConfigError } from '../ai-client.js';
import {
  generateKnowledgeBaseDraftStream,
  type GenerateKnowledgeBaseEvent,
} from '../ai-generate.js';
import {
  listKbs,
  listKbCategories,
  createKbCategory,
  renameKbCategory,
  deleteKbCategory,
  getKb,
  createKb,
  renameKb,
  deleteKb,
  updateKbCategory,
  reorderKbs,
  getFolder,
  listFolders,
  listEntries,
} from '../db.js';
import { createKnowledgeBaseFromDraft } from '../services/kb-draft-writer.js';
import { discardAiJobResultsForKb, jobSnapshot, startAnalyzeJob, startFolderEntriesJob, startFolderInitJob, startKnowledgeBaseJob } from '../services/ai-jobs.js';
import { folderPathLabel, sendSse } from '../services/utils.js';
import { asyncHandler } from '../app.js';

export function registerKbRoutes(api: Router): void {
  // ───────────── 知识库分类 ─────────────
  api.get('/kb-categories', asyncHandler(async (_req, res) => {
    res.json({ categories: await listKbCategories() });
  }));

  api.post('/kb-categories', asyncHandler(async (req, res) => {
    const name = String(req.body?.name ?? '').trim();
    const parentId = req.body?.parentId == null ? null : String(req.body.parentId).trim() || null;
    if (!name) return res.status(400).json({ error: 'name 不能为空' });
    const category = await createKbCategory(name, parentId);
    if (!category) return res.status(400).json({ error: '父分类不存在' });
    res.status(201).json({ category });
  }));

  api.put('/kb-categories/:id', asyncHandler(async (req, res) => {
    const name = String(req.body?.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'name 不能为空' });
    const category = await renameKbCategory(req.params.id, name);
    if (!category) return res.status(404).json({ error: 'not found' });
    res.json({ category });
  }));

  api.delete('/kb-categories/:id', asyncHandler(async (req, res) => {
    const ok = await deleteKbCategory(req.params.id);
    if (!ok) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true, categories: await listKbCategories(), kbs: await listKbs() });
  }));

  // ───────────── 知识库 ─────────────
  api.get('/kbs', asyncHandler(async (_req, res) => {
    res.json({ kbs: await listKbs() });
  }));

  api.post('/kbs', asyncHandler(async (req, res) => {
    const name = String(req.body?.name ?? '').trim();
    const categoryId = req.body?.categoryId == null ? null : String(req.body.categoryId).trim() || null;
    if (!name) return res.status(400).json({ error: 'name 不能为空' });
    const kb = await createKb(name, categoryId);
    res.status(201).json({ kb });
  }));

  // AI 新建知识库后台任务：提交后立即返回 jobId，生成过程由服务端继续执行。
  api.post('/kbs/generate/jobs', asyncHandler(async (req, res) => {
    const domain = String(req.body?.domain ?? '').trim();
    const questionCount = Number(req.body?.questionCount ?? 18);
    if (!domain) return res.status(400).json({ error: 'domain 不能为空' });
    const job = await startKnowledgeBaseJob(domain, Number.isFinite(questionCount) ? questionCount : 18);
    res.status(202).json({ job: await jobSnapshot(job) });
  }));

  // AI 初始化当前知识库文件目录：只创建文件夹，不生成知识点。
  api.post('/kbs/:id/folders/init/jobs', asyncHandler(async (req, res) => {
    const kb = await getKb(req.params.id);
    if (!kb) return res.status(404).json({ error: '知识库不存在' });
    const requestedParentId = req.body?.parentId == null ? '' : String(req.body.parentId).trim();
    const parentId = requestedParentId || null;
    const parent = parentId ? await getFolder(parentId) : null;
    if (parentId && !parent) return res.status(404).json({ error: '目标文件夹不存在' });
    if (parent && parent.kbId !== kb.id) return res.status(400).json({ error: '目标文件夹不属于当前知识库' });
    const domain = String(req.body?.domain ?? '').trim() || kb.name;
    const folderCount = Number(req.body?.folderCount ?? 18);
    const job = await startFolderInitJob({
      kbId: kb.id,
      kbName: kb.name,
      parentId,
      targetPath: await folderPathLabel(parentId),
      domain,
      folderCount: Number.isFinite(folderCount) ? folderCount : 18,
    });
    res.status(202).json({ job: await jobSnapshot(job) });
  }));

  // AI 按已有目录直接生成知识点：无需用户输入题目，按当前目录树自动补全空叶子目录。
  api.post('/kbs/:id/folders/entries/jobs', asyncHandler(async (req, res) => {
    const kb = await getKb(req.params.id);
    if (!kb) return res.status(404).json({ error: '知识库不存在' });
    const requestedParentId = req.body?.parentId == null ? '' : String(req.body.parentId).trim();
    const parentId = requestedParentId || null;
    const parent = parentId ? await getFolder(parentId) : null;
    if (parentId && !parent) return res.status(404).json({ error: '目标文件夹不存在' });
    if (parent && parent.kbId !== kb.id) return res.status(400).json({ error: '目标文件夹不属于当前知识库' });
    const domain = String(req.body?.domain ?? '').trim() || kb.name;
    const job = await startFolderEntriesJob({
      kbId: kb.id,
      kbName: kb.name,
      parentId,
      targetPath: await folderPathLabel(parentId),
      domain,
    });
    res.status(202).json({ job: await jobSnapshot(job) });
  }));

  // AI 新建知识库：按领域自动规划目录，并生成一批 Q&A 面试知识点。
  api.post('/kbs/generate/stream', async (req, res) => {
    const domain = String(req.body?.domain ?? '').trim();
    const questionCount = Number(req.body?.questionCount ?? 18);
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
        questionCount: Number.isFinite(questionCount) ? questionCount : 18,
      }, (event: GenerateKnowledgeBaseEvent) => sendSse(res, event.type, event));

      sendSse(res, 'stage', { message: '写入新知识库、目录和 Q&A 知识点' });
      const payload = await createKnowledgeBaseFromDraft(domain, draft);
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

  // AI 分析当前知识库:后台任务,完成后把诊断与建议挂在任务上(随任务持久化、刷新可恢复)
  api.post('/kbs/:id/analyze/jobs', asyncHandler(async (req, res) => {
    const kb = await getKb(req.params.id);
    if (!kb) return res.status(404).json({ error: '知识库不存在' });
    const job = await startAnalyzeJob({ kbId: kb.id, kbName: kb.name });
    res.status(202).json({ job: await jobSnapshot(job) });
  }));

  api.put('/kbs/:id', asyncHandler(async (req, res) => {
    const name = String(req.body?.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'name 不能为空' });
    const kb = await renameKb(req.params.id, name);
    if (!kb) return res.status(404).json({ error: 'not found' });
    res.json({ kb });
  }));

  api.put('/kbs/:id/category', asyncHandler(async (req, res) => {
    const categoryId = req.body?.categoryId == null ? null : String(req.body.categoryId).trim() || null;
    const kb = await updateKbCategory(req.params.id, categoryId);
    if (!kb) return res.status(404).json({ error: 'not found' });
    res.json({ kb });
  }));

  api.delete('/kbs/:id', asyncHandler(async (req, res) => {
    const kb = await getKb(req.params.id);
    if (!kb) return res.status(404).json({ error: 'not found' });
    await discardAiJobResultsForKb(kb.id);
    const ok = await deleteKb(kb.id);
    if (!ok) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true, kbs: await listKbs(), folders: await listFolders(), entries: await listEntries() });
  }));

  api.post('/kbs/reorder', asyncHandler(async (req, res) => {
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.some((i: unknown) => typeof i !== 'string')) {
      return res.status(400).json({ error: 'ids 必须是字符串数组' });
    }
    await reorderKbs(ids);
    res.json({ ok: true, kbs: await listKbs() });
  }));
}
