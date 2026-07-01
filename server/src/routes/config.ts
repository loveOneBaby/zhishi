import type { Router } from 'express';
import { asyncHandler } from '../app.js';
import { authStatus } from '../auth.js';
import { reconfigureDb, getDbInfo, type DbConfig } from '../db/client.js';
import {
  initDb,
  seedBuiltins,
  invalidateAllCaches,
  listEntrySummaries,
  listFolders,
  listKbs,
  listKbCategories,
  warmEntriesCache,
} from '../db.js';
import { teardownAiJobs, initAiJobs } from '../services/ai-jobs.js';

// 数据库连接配置：管理员在 UI 里切换本服务实际使用的数据库（本地文件 / 远程 libSQL）。
// GET /config 只回 mode/label/source（不泄露 token）；POST /config/db 热切换并重跑初始化序列。
// 默认经 requireAuth 鉴权（不在 isPublicRoute 白名单）；桌面端 ALLOW_UNAUTHENTICATED_ADMIN=true 时本地放开。

export function registerConfigRoutes(api: Router): void {
  api.get('/config', (req, res) => {
    res.json({ auth: authStatus(req), db: getDbInfo() });
  });

  api.post('/config/db', asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const cfg: DbConfig | null = body.clear
      ? null
      : {
          mode: body.mode === 'local' || body.mode === 'remote' ? body.mode : undefined,
          url: typeof body.url === 'string' ? body.url : undefined,
          token: typeof body.token === 'string' ? body.token : undefined,
          dbPath: typeof body.dbPath === 'string' ? body.dbPath : undefined,
        };

    // 1. 校验 + 探活 + 落盘 + 交换 client。配置/连接类错误回 400 并带可读信息（旧 DB 不变）。
    try {
      await reconfigureDb(cfg);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
      return;
    }
    // 2. 清空上一份库的内存缓存（同步，紧接交换之后，避免读到残留）。
    invalidateAllCaches();
    // 3. 中断旧库上的 AI 任务，再在新库上重建 schema / 播种 / 水合任务 / 预热缓存。
    //    探活已过的新库上这些步骤罕有失败；若失败回 500（交换已发生，管理员可重试或恢复默认）。
    teardownAiJobs();
    try {
      await initDb();
      await seedBuiltins();
      await initAiJobs();
      await Promise.all([listEntrySummaries(), listFolders(), listKbs(), listKbCategories()]);
    } catch (e) {
      console.error('[api] 数据库切换后初始化失败:', e);
      res.status(500).json({ error: `切换后初始化失败：${e instanceof Error ? e.message : String(e)}` });
      return;
    }
    void warmEntriesCache().catch((err) => console.warn('[api] 预热知识点详情缓存失败:', err));

    res.json({ ok: true, db: getDbInfo() });
  }));
}
