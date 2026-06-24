import { createApp } from './app.js';

const PORT = Number(process.env.PORT) || 5173;
const app = createApp();

app.listen(PORT, () => {
  console.log(`[server] 知识检索服务已启动: http://localhost:${PORT}`);
  console.log(`[server] API: http://localhost:${PORT}/api/entries`);
});
