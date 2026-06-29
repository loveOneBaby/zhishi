import type { Router } from 'express';
import { asyncHandler } from '../app.js';
import {
  listFolders,
  createFolder,
  renameFolder,
  moveFolder,
  deleteFolder,
  reorderFolders,
} from '../db.js';
import { discardAiJobResultItems, type DiscardAiJobResultItemsResult } from '../services/ai-jobs.js';

function mergeDeleteResult(
  left: DiscardAiJobResultItemsResult,
  right: DiscardAiJobResultItemsResult,
): DiscardAiJobResultItemsResult {
  return {
    folderIds: [...new Set([...left.folderIds, ...right.folderIds])],
    entryIds: [...new Set([...left.entryIds, ...right.entryIds])],
  };
}

export function registerFolderRoutes(api: Router): void {
  // ───────────── 文件夹 ─────────────
  api.get('/folders', asyncHandler(async (_req, res) => {
    res.json({ folders: await listFolders() });
  }));

  api.post('/folders', asyncHandler(async (req, res) => {
    const kbId = String(req.body?.kbId ?? '').trim();
    const name = String(req.body?.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'name 不能为空' });
    const parentId = req.body?.parentId ?? null;
    const folder = await createFolder({ kbId, parentId, name });
    if (!folder) return res.status(400).json({ error: '知识库不存在或父文件夹无效' });
    res.status(201).json({ folder });
  }));

  api.put('/folders/:id', asyncHandler(async (req, res) => {
    const name = String(req.body?.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'name 不能为空' });
    const folder = await renameFolder(req.params.id, name);
    if (!folder) return res.status(404).json({ error: 'not found' });
    res.json({ folder });
  }));

  api.post('/folders/move', asyncHandler(async (req, res) => {
    const id = String(req.body?.id ?? '').trim();
    if (!id) return res.status(400).json({ error: 'id 不能为空' });
    const ok = await moveFolder(id, {
      parentId: req.body?.parentId ?? null,
      kbId: req.body?.kbId,
    });
    if (!ok) return res.status(400).json({ error: '目标无效或会形成环' });
    res.json({ ok: true, folders: await listFolders() });
  }));

  api.delete('/folders/:id', asyncHandler(async (req, res) => {
    const id = req.params.id;
    const result = await deleteFolder(id);
    const cleanup = await discardAiJobResultItems({
      folderIds: result?.folderIds ?? [id],
      entryIds: result?.entryIds ?? [],
    });
    const merged = mergeDeleteResult(result ?? { folderIds: [], entryIds: [] }, cleanup);
    if (!result && !merged.folderIds.length && !merged.entryIds.length) {
      return res.status(404).json({ error: 'not found' });
    }
    res.json({ ok: true, ...merged });
  }));

  api.post('/folders/reorder', asyncHandler(async (req, res) => {
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.some((i: unknown) => typeof i !== 'string')) {
      return res.status(400).json({ error: 'ids 必须是字符串数组' });
    }
    await reorderFolders(ids);
    res.json({ ok: true, folders: await listFolders() });
  }));
}
