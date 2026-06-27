import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

// 管理鉴权:在 server/.env 设 AUTH_TOKEN 后启用;未设仅允许本地开发开放。
// 检索 / 浏览(只读 GET)默认公开;增删改 / AI 生成 / 导入导出 / 任务管理需登录。
// 凭据走 httpOnly cookie(同源 fetch / <img> 自动携带),兼容 Authorization: Bearer。

const COOKIE_NAME = 'zhishi_admin';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 天

function clean(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t || undefined;
}

function enabledFlag(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(String(value ?? '').trim());
}

export function getAuthToken(): string | undefined {
  return clean(process.env.AUTH_TOKEN);
}

export function authRequired(): boolean {
  return Boolean(getAuthToken());
}

export function publicAskEnabled(): boolean {
  return enabledFlag(process.env.AI_PUBLIC_ASK) || enabledFlag(process.env.PUBLIC_ASK_ENABLED);
}

function productionAuthRequired(): boolean {
  return enabledFlag(process.env.REQUIRE_AUTH)
    || process.env.NODE_ENV === 'production'
    || Boolean(clean(process.env.RENDER) || clean(process.env.TURSO_DATABASE_URL));
}

export function assertAuthConfiguredForProduction(): void {
  if (getAuthToken()) return;
  if (!productionAuthRequired()) return;
  if (enabledFlag(process.env.ALLOW_UNAUTHENTICATED_ADMIN)) return;
  throw new Error('线上环境必须设置 AUTH_TOKEN；如确认为一次性内网开发环境，可显式设置 ALLOW_UNAUTHENTICATED_ADMIN=true。');
}

// 常量时间比较,避免时序侧信道
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// 不引入 cookie-parser:手动解析 Cookie 头(只读几个键,够用)
function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
  }
  return out;
}

function tokenFromRequest(req: Request): string | undefined {
  const cookie = parseCookies(req)[COOKIE_NAME];
  if (cookie) return cookie;
  const auth = req.headers.authorization;
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  return undefined;
}

export function isAuthenticated(req: Request): boolean {
  const expected = getAuthToken();
  if (!expected) return true; // 未配置令牌 → 开放
  const provided = tokenFromRequest(req);
  if (!provided) return false;
  return safeEqual(provided, expected);
}

export interface AuthStatus {
  authRequired: boolean;
  authenticated: boolean;
}

export function authStatus(req: Request): AuthStatus {
  return { authRequired: authRequired(), authenticated: isAuthenticated(req) };
}

function isSecure(req: Request): boolean {
  return req.secure || req.headers['x-forwarded-proto'] === 'https';
}

export function setAuthCookie(res: Response, token: string, req: Request): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: isSecure(req),
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });
}

export function clearAuthCookie(res: Response, req: Request): void {
  res.clearCookie(COOKIE_NAME, { path: '/', httpOnly: true, sameSite: 'strict', secure: isSecure(req) });
}

// 公开(检索 / 浏览)路由白名单:只读 GET + /auth/*。
// 其余(增删改 / AI 生成 / 导入导出 / 任务管理)需鉴权。
function isPublicRoute(req: Request): boolean {
  const method = req.method;
  const path = req.path; // 相对 /api 挂载点
  if (path === '/health') return true;
  if (path === '/auth' || path.startsWith('/auth/')) return true;
  if (method === 'GET' || method === 'HEAD') {
    if (path === '/entries' || path === '/search' || path === '/kbs' || path === '/kb-categories' || path === '/folders') return true;
    if (/^\/entries\/[^/]+$/.test(path)) return true;        // 单条详情(不含 /versions /analyze 等子路径)
    if (/^\/assets\/[^/]+(\/raw)?$/.test(path)) return true; // 资源元信息与原图
  }
  if (method === 'POST' && path === '/ask') return publicAskEnabled(); // AI 问答默认不公开,避免被刷额度
  return false;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!authRequired()) return next();
  if (isPublicRoute(req)) return next();
  if (!isAuthenticated(req)) {
    res.status(401).json({ error: '未登录或令牌无效', authRequired: true });
    return;
  }
  next();
}
