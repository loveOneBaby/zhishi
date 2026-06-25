import type { Router } from 'express';

export function registerHealthRoutes(api: Router): void {
  // 健康检查
  api.get('/health', (_req, res) => res.json({ ok: true }));
}
