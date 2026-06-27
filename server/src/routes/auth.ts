import type { Router } from 'express';
import { asyncHandler } from '../app.js';
import { rateLimit } from '../rateLimit.js';
import {
  authStatus,
  clearAuthCookie,
  getAuthToken,
  safeEqual,
  setAuthCookie,
} from '../auth.js';

// 登录尝试限流:令牌是共享密钥,收紧以防爆破。
const loginLimiter = rateLimit({ windowMs: 60_000, max: 10, message: '登录尝试过于频繁,请稍后再试' });

export function registerAuthRoutes(api: Router): void {
  api.get('/auth/status', (req, res) => {
    res.json(authStatus(req));
  });

  api.post('/auth/login', loginLimiter, asyncHandler(async (req, res) => {
    const token = String(req.body?.token ?? '').trim();
    const expected = getAuthToken();
    if (!expected) {
      // 未启用鉴权:直接告知前端为开放态。
      res.json({ authRequired: false, authenticated: true });
      return;
    }
    if (!token || !safeEqual(token, expected)) {
      res.status(401).json({ error: '令牌无效' });
      return;
    }
    setAuthCookie(res, token, req);
    res.json({ authRequired: true, authenticated: true });
  }));

  api.post('/auth/logout', (req, res) => {
    clearAuthCookie(res, req);
    res.json({ ok: true });
  });
}
