import { loadEnvFile } from './env.js';
import { createApp } from './app.js';
import { initDb, seedBuiltins } from './db.js';
import { initAiJobs } from './services/ai-jobs.js';

loadEnvFile();

const PORT = Number(process.env.PORT) || 5173;

// 启动序列：先建表/迁移，再播种内置知识库，再恢复 AI 任务，最后起服务。
// 副作用此前散落在各模块加载期，现统一收敛到此处，避免「连接未就绪就用」。
await initDb();
await seedBuiltins();
await initAiJobs();

const app = createApp();

app.listen(PORT, () => {
  console.log(`[server] 知识检索服务已启动: http://localhost:${PORT}`);
  console.log(`[server] API: http://localhost:${PORT}/api/entries`);
});
