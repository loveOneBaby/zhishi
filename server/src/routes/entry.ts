import type { Router } from 'express';
import { AiConfigError } from '../ai-client.js';
import {
  generateEntryInput,
  generateEntryInputStream,
  rewriteEntryInputStream,
  type GenerateEntryEvent,
} from '../ai-generate.js';
import {
  listEntries,
  getEntry,
  createEntry,
  updateEntry,
  deleteEntry,
  reorderEntries,
  getKb,
  getFolder,
  createEntryVersion,
  listEntryVersions,
  restoreEntryVersion,
  type EntryInput,
} from '../db.js';
import { searchEntries } from '../search.js';
import { folderPathLabel, sendSse } from '../services/utils.js';

export function registerEntryRoutes(api: Router): void {
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

  // AI 生成知识点草稿：流式返回真实阶段、上下文、模型输出和结构化草稿，但不写库。
  api.post('/entries/generate/draft/stream', async (req, res) => {
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
    sendSse(res, 'stage', { message: '准备生成草稿请求' });

    try {
      const context = searchEntries(listEntries().filter((entry) => entry.kbId === kbId), topic);
      const input = await generateEntryInputStream({
        topic,
        kbName: kb.name,
        folderPath: folderPathLabel(folderId),
        context,
      }, (event: GenerateEntryEvent) => sendSse(res, event.type, event));
      const draft: EntryInput = { ...input, kbId, folderId };
      sendSse(res, 'draft', { input: draft });
      sendSse(res, 'done', { input: draft });
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
      createEntryVersion(current, 'ai-rewrite');
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

  // AI 改写草稿：读取当前 doc，流式返回改写说明与新结构，但不覆盖原知识点。
  api.post('/entries/:id/rewrite/draft/stream', async (req, res) => {
    const current = getEntry(req.params.id);
    if (!current) return res.status(404).json({ error: '知识点不存在' });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    sendSse(res, 'stage', { message: '准备改写草稿请求' });

    try {
      const input = await rewriteEntryInputStream({ entry: current }, (event: GenerateEntryEvent) => sendSse(res, event.type, event));
      const draft: EntryInput = { ...input, kbId: current.kbId, folderId: current.folderId };
      sendSse(res, 'draft', { input: draft });
      sendSse(res, 'done', { input: draft });
      res.end();
    } catch (err) {
      sendSse(res, 'error', {
        configured: !(err instanceof AiConfigError),
        error: err instanceof Error ? err.message : String(err),
      });
      res.end();
    }
  });

  // 确认 AI 改写草稿：先保存旧版本，再用草稿覆盖当前知识点。
  api.post('/entries/:id/rewrite/commit', (req, res) => {
    const current = getEntry(req.params.id);
    if (!current) return res.status(404).json({ error: '知识点不存在' });
    const input = req.body as EntryInput;
    if (!input?.title || !String(input.title).trim()) return res.status(400).json({ error: 'title 不能为空' });
    createEntryVersion(current, 'ai-rewrite');
    const entry = updateEntry(current.id, {
      ...input,
      kbId: current.kbId,
      folderId: current.folderId,
    });
    if (!entry) return res.status(404).json({ error: '知识点不存在' });
    res.json({ entry });
  });

  api.get('/entries/:id/versions', (req, res) => {
    if (!getEntry(req.params.id)) return res.status(404).json({ error: '知识点不存在' });
    res.json({ versions: listEntryVersions(req.params.id) });
  });

  api.post('/entries/:id/versions/:versionId/restore', (req, res) => {
    const entry = restoreEntryVersion(req.params.id, req.params.versionId);
    if (!entry) return res.status(404).json({ error: '版本不存在' });
    res.json({ entry });
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
}
