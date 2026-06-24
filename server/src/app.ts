import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
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
  createFolder,
  renameFolder,
  moveFolder,
  deleteFolder,
  reorderFolders,
  type EntryInput,
  type ImportPayload,
} from './db.js';
import { convertEntry } from './blocks-import.js';
import { knowledgeTreeToImportPayload } from './knowledge-tree-import.js';
import { searchEntries } from './search.js';
import { askAI } from './ask.js';

export function createApp() {
  seedBuiltins();

  const app = express();
  // 1mb 对常规接口足够；导入（kb-import-2，可能含大量条目）放宽到 5mb
  app.use(express.json({ limit: '5mb' }));

  const api = express.Router();

  // 健康检查
  api.get('/health', (_req, res) => res.json({ ok: true }));

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

  // 单条
  api.get('/entries/:id', (req, res) => {
    const e = getEntry(req.params.id);
    if (!e) return res.status(404).json({ error: 'not found' });
    res.json({ entry: e });
  });

  // 新建
  api.post('/entries', (req, res) => {
    const { title, kbId, folderId, cat, tags, py, summary, intro, nodes } = req.body ?? {};
    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: 'title 不能为空' });
    }
    const entry = createEntry({ title, kbId, folderId, cat, tags, py, summary, intro, nodes } as EntryInput);
    res.status(201).json({ entry });
  });

  // 导出全部知识库结构（备份）
  api.get('/export', (_req, res) => {
    res.json(exportData());
  });

  function requestToImportPayload(body: unknown): ImportPayload {
    const b = (body ?? {}) as { tree?: unknown; entries?: unknown; assets?: unknown };
    if (Array.isArray(b.tree)) return knowledgeTreeToImportPayload(body);
    if (Array.isArray(b.entries)) {
      const assets = Array.isArray(b.assets) ? b.assets : [];
      return { entries: b.entries.map((e: unknown) => convertEntry(e, assets)) };
    }
    throw new Error('tree 必须是数组');
  }

  // 导入：主格式为 { version:"knowledge-tree-v1", meta, tree:[...] }
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

  // 导入预览：解析 knowledge-tree-v1，但不写库。
  api.post('/import/preview', (req, res) => {
    try {
      const payload = requestToImportPayload(req.body);
      if (payload.entries.length > 5000) return res.status(400).json({ error: '单次导入不超过 5000 条' });
      const preview = buildImportPreview(payload.entries);
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
