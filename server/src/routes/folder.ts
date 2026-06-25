import type { Router } from 'express';
import {
  listFolders,
  createFolder,
  renameFolder,
  moveFolder,
  deleteFolder,
  reorderFolders,
  listEntries,
} from '../db.js';

export function registerFolderRoutes(api: Router): void {
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
}
