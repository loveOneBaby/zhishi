import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { seedBuiltins } from './db.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerAiRoutes } from './routes/ai.js';
import { registerKbRoutes } from './routes/kb.js';
import { registerFolderRoutes } from './routes/folder.js';
import { registerEntryRoutes } from './routes/entry.js';
import { registerImportRoutes } from './routes/import.js';
import { registerAssetRoutes } from './routes/asset.js';

export function createApp() {
  seedBuiltins();

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

  // 生产环境：托管前端构建产物
  const webDist = path.resolve(process.cwd(), '../web/dist');
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get('*', (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }

  return app;
}
