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
import { generateEntryInput, generateEntryInputStream, rewriteEntryInputStream, type GenerateEntryEvent } from './ai-generate.js';

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
