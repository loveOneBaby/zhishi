import type { Router } from 'express';
import { authStatus } from '../auth.js';
import {
  listEntrySummaries,
  listFolders,
  listKbCategories,
  listKbs,
  warmEntriesCache,
} from '../db.js';
import { asyncHandler } from '../app.js';

export function registerBootstrapRoutes(api: Router): void {
  api.get('/bootstrap', asyncHandler(async (req, res) => {
    // 本地 libSQL sqlite3 连接并发查询会排队放大耗时；这里顺序读缓存反而更稳。
    const entries = await listEntrySummaries();
    const kbs = await listKbs();
    const folders = await listFolders();
    const kbCategories = await listKbCategories();
    void warmEntriesCache().catch((err) => console.warn('[api] 预热知识点详情缓存失败:', err));

    res.json({
      auth: authStatus(req),
      entries,
      kbs,
      folders,
      kbCategories,
    });
  }));
}
