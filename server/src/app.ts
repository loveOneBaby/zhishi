import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { registerHealthRoutes } from './routes/health.js';
import { registerAiRoutes } from './routes/ai.js';
import { registerKbRoutes } from './routes/kb.js';
import { registerFolderRoutes } from './routes/folder.js';
import { registerEntryRoutes } from './routes/entry.js';
import { registerImportRoutes } from './routes/import.js';
import { registerAssetRoutes } from './routes/asset.js';

// Express 4 不自动捕获 async handler 抛出的 rejection：统一包装 + 错误中间件兜底
export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function createApp() {
  const app = express();
  // 1mb 对常规接口足够；导入（kb-import-2，可能含大量条目）放宽到 5mb
  app.use(express.json({ limit: '5mb' }));

  const api = express.Router();
  registerHealthRoutes(api);
  registerAiRoutes(api);
  registerKbRoutes(api);
  registerFolderRoutes(api);
  registerEntryRoutes(api);
  registerImportRoutes(api);
  registerAssetRoutes(api);

  app.use('/api', api);

  // 错误中间件：把未捕获的异常（含 async rejection）转成 JSON 响应
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : String(err);
    if (res.headersSent) return;
    res.status(500).json({ error: message });
  });

  // 生产环境：托管前端构建产物
  const webDist = path.resolve(process.cwd(), '../web/dist');
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get('*', (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }

  return app;
}
