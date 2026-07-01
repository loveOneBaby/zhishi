import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { registerHealthRoutes } from './routes/health.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerBootstrapRoutes } from './routes/bootstrap.js';
import { registerAiRoutes } from './routes/ai.js';
import { registerKbRoutes } from './routes/kb.js';
import { registerFolderRoutes } from './routes/folder.js';
import { registerEntryRoutes } from './routes/entry.js';
import { registerImportRoutes } from './routes/import.js';
import { registerAssetRoutes } from './routes/asset.js';
import { registerConfigRoutes } from './routes/config.js';
import { requireAuth } from './auth.js';
import { rateLimit } from './rateLimit.js';

// Express 4 不自动捕获 async handler 抛出的 rejection：统一包装 + 错误中间件兜底
export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// 安全响应头:不引 helmet,按需设置关键头。
// 应用大量内联样式,严格 CSP 需大改,暂不设(已用 nosniff / frame / referrer 兜底)。
// IK_ALLOW_REMOTE_API=true 时放开 connect-src 并加 CORS:让前端可在「设置」里指向远程后端。
// 默认关闭,保持同源锁紧;启用后写操作仍需 Bearer/cookie 鉴权,不引入越权风险。
const allowRemoteApi = /^(1|true|yes|on)$/i.test(String(process.env.IK_ALLOW_REMOTE_API ?? '').trim());

function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  // CSP:禁止内联脚本与外部脚本(构建产物仅 /assets/*.js),内联样式因应用大量使用而放开。
  // img 允许站内、https 外链、data/blob;connect 默认仅同源(全部接口走 /api),远程后端模式放开 http/https;worker 允许 blob(BlockNote 贴图)。
  const connectSrc = allowRemoteApi ? "'self' https: http:" : "'self'";
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "img-src 'self' https: data: blob:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "script-src 'self'",
    `connect-src ${connectSrc}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; '));
  const origin = req.headers.origin;
  if (allowRemoteApi && typeof origin === 'string') {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS' && req.path.startsWith('/api')) {
      res.sendStatus(204);
      return;
    }
  }
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

// 写操作(POST/PUT/DELETE)按 IP 限流,兜底防刷;读接口不限。
const writeLimiter = rateLimit({ windowMs: 60_000, max: 120, message: '操作过于频繁,请稍后再试' });

const SLOW_API_MS = Number(process.env.SLOW_API_MS ?? 100);
const LARGE_API_BYTES = Number(process.env.LARGE_API_BYTES ?? 100 * 1024);

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0B';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}

function apiMetrics(req: Request, res: Response, next: NextFunction): void {
  const started = process.hrtime.bigint();
  let bodyBytes = 0;
  const originalSend = res.send.bind(res);
  res.send = ((body?: unknown): Response => {
    if (typeof body === 'string') bodyBytes = Buffer.byteLength(body);
    else if (Buffer.isBuffer(body)) bodyBytes = body.length;
    else if (body != null) {
      try { bodyBytes = Buffer.byteLength(JSON.stringify(body)); } catch { bodyBytes = 0; }
    }
    return originalSend(body as Parameters<Response['send']>[0]);
  }) as Response['send'];

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    const headerLength = Number(res.getHeader('Content-Length') ?? 0);
    const bytes = headerLength || bodyBytes;
    const slow = durationMs >= SLOW_API_MS;
    const large = bytes >= LARGE_API_BYTES;
    if (!slow && !large) return;
    const tags = [slow ? 'slow' : '', large ? 'large' : ''].filter(Boolean).join(',');
    console.warn(`[api:${tags}] ${req.method} ${req.originalUrl} -> ${res.statusCode} ${durationMs.toFixed(1)}ms ${formatBytes(bytes)}`);
  });

  next();
}

export function createApp() {
  const app = express();
  // Render 等平台反代:信任一跳,使 req.ip / req.secure 取真实客户端。
  app.set('trust proxy', 1);
  app.use(securityHeaders);
  // 常规接口收紧 body 体积；导入与图片上传保留较大限额。
  app.use(['/api/import', '/api/assets'], express.json({ limit: '5mb' }));
  app.use('/api', express.json({ limit: '256kb' }));
  app.use('/api', apiMetrics);

  const api = express.Router();
  // 写操作统一限流(在鉴权前,429 不必走鉴权)
  api.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    writeLimiter(req, res, next);
  });
  // 管理鉴权:检索/浏览路由公开,其余需登录
  api.use(requireAuth);

  registerAuthRoutes(api);
  registerBootstrapRoutes(api);
  registerHealthRoutes(api);
  registerAiRoutes(api);
  registerKbRoutes(api);
  registerFolderRoutes(api);
  registerEntryRoutes(api);
  registerImportRoutes(api);
  registerAssetRoutes(api);
  registerConfigRoutes(api);

  app.use('/api', api);

  // 错误中间件:5xx 对外只回通用提示(细节记日志),4xx 保留可读信息
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const errObj = err as { status?: number; statusCode?: number };
    const status = errObj?.status || errObj?.statusCode || 500;
    console.error('[server] 未捕获错误:', err);
    if (res.headersSent) return;
    if (status >= 500) {
      res.status(500).json({ error: '服务器内部错误' });
      return;
    }
    res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  });

  // 生产环境：托管前端构建产物
  const webDist = path.resolve(process.cwd(), '../web/dist');
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get('*', (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }

  return app;
}
