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
} from './db.js';
import { convertEntry } from './blocks-import.js';
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
    const { title, cat, tags, py, summary, intro, nodes } = req.body ?? {};
    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: 'title 不能为空' });
    }
    const entry = createEntry({ title, cat, tags, py, summary, intro, nodes });
    res.status(201).json({ entry });
  });

  // 导出全部知识点（备份）
  api.get('/export', (_req, res) => {
    res.json({ version: 'kb-export-1', exportedAt: Date.now(), entries: listEntries() });
  });

  // 导入：body = { version?, assets?, entries: [...], replace?: boolean }
  // kb-import-2 的富块结构（intro/nodes.blocks、assets）在此自动折叠为扁平 markdown
  api.post('/import', (req, res) => {
    const raw = req.body?.entries;
    if (!Array.isArray(raw)) return res.status(400).json({ error: 'entries 必须是数组' });
    if (raw.length > 5000) return res.status(400).json({ error: '单次导入不超过 5000 条' });
    const assets = Array.isArray(req.body?.assets) ? req.body.assets : [];
    // convertEntry 对扁平旧条目是直通，v1/v2 可混用
    const list = raw.map((e) => convertEntry(e, assets));
    const { imported } = importEntries(list, Boolean(req.body?.replace));
    res.json({ ok: true, imported, entries: listEntries() });
  });

  // 排序（管理模块拖拽）：body = { ids: string[] }
  api.post('/entries/reorder', (req, res) => {
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.some((i) => typeof i !== 'string')) {
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
