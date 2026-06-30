import { randomUUID } from 'node:crypto';
import type { Router } from 'express';
import { asyncHandler } from '../app.js';
import { convertEntry } from '../blocks-import.js';
import {
  exportData,
  importEntries,
  buildImportPreview,
  listKbs,
  listKbCategories,
  listFolders,
  listEntries,
  listEntrySummaries,
  getFolder,
  getKb,
  type ImportPayload,
  type ImportKbCategory,
  type ImportKb,
  type ImportFolder,
} from '../db.js';
import { isKbPackage2, kbPackage2ToImportPayload } from '../kb-package-2.js';
import { knowledgeTreeToImportPayload } from '../knowledge-tree-import.js';
import { stableImportId } from '../services/utils.js';

async function requestToImportPayload(body: unknown): Promise<ImportPayload> {
  const b = (body ?? {}) as {
    tree?: unknown;
    entries?: unknown;
    assets?: unknown;
    package?: unknown;
    schema?: unknown;
    containers?: unknown;
    extensions?: unknown;
    kbs?: unknown;
    kbCategories?: unknown;
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
  const targetFolder = requestedFolderId ? await getFolder(requestedFolderId) : null;
  if (requestedFolderId && !targetFolder) throw new Error('目标文件夹不存在');

  const requestedKbId = cleanText(b.targetKbId);
  const targetKbId = requestedKbId || targetFolder?.kbId;
  const targetKb = targetKbId ? await getKb(targetKbId) : null;
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
    const kbCategories: ImportKbCategory[] | undefined = Array.isArray(b.kbCategories)
      ? b.kbCategories
          .map((c) => (c && typeof c === 'object' ? (c as Record<string, unknown>) : null))
          .filter((c): c is Record<string, unknown> => !!c && typeof c.name === 'string')
          .map((c) => ({
            id: cleanText(c.id),
            parentId: cleanText(c.parentId) ?? (Object.prototype.hasOwnProperty.call(c, 'parentId') ? null : undefined),
            name: String(c.name),
            sort: typeof c.sort === 'number' ? c.sort : 0,
          }))
      : undefined;
    const kbs: ImportKb[] | undefined = Array.isArray(b.kbs)
      ? b.kbs
          .map((k) => (k && typeof k === 'object' ? (k as Record<string, unknown>) : null))
          .filter((k): k is Record<string, unknown> => !!k && typeof k.name === 'string')
          .map((k) => ({
	            id: typeof k.id === 'string' ? k.id : undefined,
	            name: String(k.name),
	            categoryId: cleanText(k.categoryId) ?? (Object.prototype.hasOwnProperty.call(k, 'categoryId') ? null : undefined),
	            favorite: typeof k.favorite === 'boolean' ? k.favorite : undefined,
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
      kbCategories: routed ? undefined : kbCategories,
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

export function registerImportRoutes(api: Router): void {
  // 导出全部知识库结构（备份）
  api.get('/export', asyncHandler(async (_req, res) => {
    res.json(await exportData());
  }));

  // 导入：主格式为 kb-package-2；内部备份/撤销仍走 entries/folders 结构。
  api.post('/import', asyncHandler(async (req, res) => {
    try {
      const payload = await requestToImportPayload(req.body);
      if (payload.entries.length > 5000) return res.status(400).json({ error: '单次导入不超过 5000 条' });
      const { imported } = await importEntries(payload, Boolean(req.body?.replace));
      res.json({ ok: true, imported, kbCategories: await listKbCategories(), kbs: await listKbs(), folders: await listFolders(), entries: await listEntrySummaries() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }));

  // 导入预览：解析导入载荷，但不写库。
  api.post('/import/preview', asyncHandler(async (req, res) => {
    try {
      const payload = await requestToImportPayload(req.body);
      if (payload.entries.length > 5000) return res.status(400).json({ error: '单次导入不超过 5000 条' });
      const preview = await buildImportPreview(payload.entries, payload.folders);
      res.json({ preview });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }));
}
