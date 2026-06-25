// Barrel：把 db/ 目录各域模块聚合为单一入口，保持 7 个消费者的 `from './db.js'` 零改动。
// 模块加载顺序即副作用顺序：client(连接+DDL+迁移+genId) → asset → doc-write → kb → folder → entry → import → seed。
// migrateKbFolder() 是唯一顶层调用，置于末尾——此时 createKb/ensureFolder 均已就绪。
export * from './db/client.js';
export * from './db/asset.js';
export * from './db/doc-write.js';
export * from './db/kb.js';
export * from './db/folder.js';
export * from './db/entry.js';
export * from './db/entry-version.js';
export * from './db/import.js';
export * from './db/ai.js';
export * from './db/seed.js';
import { migrateKbFolder } from './db/seed.js';
migrateKbFolder();
