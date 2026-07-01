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
import { clearEntriesCache } from './db/entry.js';
import { clearKbsCache } from './db/kb.js';
import { clearFoldersCache } from './db/folder.js';
import { clearKbCategoriesCache } from './db/kb-category.js';

export async function initDb(): Promise<void> {
  await initSchema();
  await ensureEntryVersionTable();
  await ensureAiJobsTable();
  await migrateKbFolder();
}

// 清空所有内存缓存（知识点 / 知识库 / 文件夹 / 分类）。热切换数据库后调用，避免读到上一份库的残留数据。
export function invalidateAllCaches(): void {
  clearEntriesCache();
  clearKbsCache();
  clearFoldersCache();
  clearKbCategoriesCache();
}
