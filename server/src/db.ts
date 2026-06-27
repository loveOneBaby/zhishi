// Barrel：把 db/ 目录各域模块聚合为单一入口，保持消费者的 `from './db.js'` 零改动。
// 副作用统一收敛到 initDb()，由启动入口（index.ts）在 listen 之前 await 调用，
// 顺序：initSchema(建表+列迁移) → ensureEntryVersionTable → ensureAiJobsTable → migrateKbFolder。
export * from './db/client.js';
export * from './db/asset.js';
export * from './db/doc-write.js';
export * from './db/kb-category.js';
export * from './db/kb.js';
export * from './db/folder.js';
export * from './db/entry.js';
export * from './db/entry-version.js';
export * from './db/import.js';
export * from './db/ai.js';
export * from './db/seed.js';
import { initSchema } from './db/client.js';
import { ensureEntryVersionTable } from './db/entry-version.js';
import { ensureAiJobsTable } from './db/ai.js';
import { migrateKbFolder } from './db/seed.js';

export async function initDb(): Promise<void> {
  await initSchema();
  await ensureEntryVersionTable();
  await ensureAiJobsTable();
  await migrateKbFolder();
}
