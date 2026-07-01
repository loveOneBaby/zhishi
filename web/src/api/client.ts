export const API_BASE_STORAGE_KEY = 'ik_api_base';
export const API_TOKEN_STORAGE_KEY = 'ik_api_token';
export const DEFAULT_EXTENSION_API_BASE = 'http://localhost:5173/api';

export function isExtensionRuntime(): boolean {
  return typeof window !== 'undefined' && window.location.protocol === 'chrome-extension:';
}

export function normalizeApiBase(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (trimmed.startsWith('/')) return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.pathname.replace(/\/+$/, '').endsWith('/api') ? url.toString().replace(/\/+$/, '') : `${url.toString().replace(/\/+$/, '')}/api`;
  } catch {
    return '';
  }
}

export function getApiBase(): string {
  // 优先用户在「设置」里保存的自定义后端地址（Web / 桌面端 / 扩展共用同一 localStorage key）。
  try {
    const saved = window.localStorage.getItem(API_BASE_STORAGE_KEY);
    const normalized = saved ? normalizeApiBase(saved) : '';
    if (normalized) return normalized;
  } catch { /* ignore */ }
  if (isExtensionRuntime()) return DEFAULT_EXTENSION_API_BASE;
  return '/api';
}

export const BASE = getApiBase();

// 是否走自定义后端（跨域）。同源 /api 仍由服务端 httpOnly cookie 鉴权；自定义后端改用 Bearer token。
export function usingCustomBase(): boolean {
  return isExtensionRuntime() || BASE !== '/api';
}

const CLIENT_SLOW_API_MS = 100;
const CLIENT_LARGE_API_BYTES = 100 * 1024;
const GET_DEDUPE_MS = 800;
const getMemo = new Map<string, { promise: Promise<unknown>; settledAt?: number }>();

function responseBytes(res: Response): number {
  const raw = res.headers.get('content-length');
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) ? n : 0;
}

function logApiMetric(method: string, path: string, res: Response, durationMs: number): void {
  const bytes = responseBytes(res);
  const slow = durationMs >= CLIENT_SLOW_API_MS;
  const large = bytes >= CLIENT_LARGE_API_BYTES;
  if (!slow && !large) return;
  const tags = [slow ? 'slow' : '', large ? 'large' : ''].filter(Boolean).join(',');
  const size = bytes ? `${(bytes / 1024).toFixed(1)}KB` : 'unknown';
  console.warn(`[api-client:${tags}] ${method} ${path} -> ${res.status} ${durationMs.toFixed(1)}ms ${size}`);
}

function withApiAuth(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  // 自定义后端（跨域 / 扩展）无法靠同源 cookie，改用 localStorage 里的 Bearer token。
  if (usingCustomBase() && !headers.has('Authorization')) {
    try {
      const token = window.localStorage.getItem(API_TOKEN_STORAGE_KEY)?.trim();
      if (token) headers.set('Authorization', `Bearer ${token}`);
    } catch { /* ignore */ }
  }
  return { ...init, headers };
}

export function apiUrl(path: string): string {
  return `${BASE}${path}`;
}

export function resolveAssetUrl(src: string): string {
  const value = src.trim();
  if (!value) return '';
  if (!isExtensionRuntime()) return value;
  if (value.startsWith('/api/')) {
    return `${BASE.replace(/\/api$/, '')}${value}`;
  }
  return value;
}

export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(apiUrl(path), withApiAuth(init));
}

async function timedFetch(method: string, path: string, init?: RequestInit): Promise<Response> {
  const started = performance.now();
  const res = await apiFetch(path, init);
  logApiMetric(method, path, res, performance.now() - started);
  return res;
}

function clearGetMemo(): void {
  getMemo.clear();
}

export async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `请求失败 ${res.status}`;
    try { const d = await res.json(); if (d?.error) msg = d.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

// ───────────── JSON 请求封装(行为等价:收敛重复的 fetch + j + 取键样板) ─────────────

function memoizedGet<T>(path: string, loader: () => Promise<T>): Promise<T> {
  const key = `GET ${path}`;
  const now = Date.now();
  const hit = getMemo.get(key);
  if (hit && (!hit.settledAt || now - hit.settledAt < GET_DEDUPE_MS)) return hit.promise as Promise<T>;

  const promise = loader().finally(() => {
    const current = getMemo.get(key);
    if (current?.promise !== promise) return;
    current.settledAt = Date.now();
    window.setTimeout(() => {
      if (getMemo.get(key)?.promise === promise) getMemo.delete(key);
    }, GET_DEDUPE_MS);
  });
  getMemo.set(key, { promise });
  return promise;
}

export async function apiGetJson<T>(path: string): Promise<T> {
  return memoizedGet(path, async () => j<T>(await timedFetch('GET', path)));
}
export async function apiGetKey<T>(path: string, key: string): Promise<T> {
  const data = await memoizedGet(path, async () => j<Record<string, T>>(await timedFetch('GET', path)));
  return data[key];
}
export async function apiPostJson<T>(path: string, body: unknown): Promise<T> {
  const res = await timedFetch('POST', path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await j<T>(res);
  clearGetMemo();
  return data;
}
export async function apiPostKey<T>(path: string, body: unknown, key: string): Promise<T> {
  const data = await j<Record<string, T>>(await timedFetch('POST', path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  clearGetMemo();
  return data[key];
}
export async function apiPutKey<T>(path: string, body: unknown, key: string): Promise<T> {
  const data = await j<Record<string, T>>(await timedFetch('PUT', path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  clearGetMemo();
  return data[key];
}
export async function apiDelJson<T>(path: string): Promise<T> {
  const data = await j<T>(await timedFetch('DELETE', path, { method: 'DELETE' }));
  clearGetMemo();
  return data;
}

// ───────────── SSE 流式读取封装 ─────────────

export function readSseBlock(block: string): { event: string; data: unknown } | null {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }
  if (!dataLines.length) return null;
  try {
    return { event, data: JSON.parse(dataLines.join('\n')) };
  } catch {
    return { event, data: dataLines.join('\n') };
  }
}

// SSE 流统一处理:负责 fetch/错误响应/reader/decoder/buffer 切块/flush/throw,
// 各调用方只提供 dispatch(event,data,ctx) 把事件映射到对应 handler 并通过 ctx.setSaved/setError 回传状态
export interface SseDispatchCtx<T> {
  setSaved: (value: T) => void;
  setError: (message: string) => void;
}
export async function runSseStream<T>(
  path: string,
  body: unknown | undefined,
  notSavedMessage: string,
  dispatch: (event: string, data: Record<string, unknown>, ctx: SseDispatchCtx<T>) => void,
  signal?: AbortSignal,
): Promise<T> {
  const res = await apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    ...(signal ? { signal } : {}),
  });
  if (!res.ok || !res.body) {
    let msg = `请求失败 ${res.status}`;
    try {
      const data = await res.json();
      if (data?.error) msg = data.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let saved: T | null = null;
  let thrown: Error | null = null;
  const ctx: SseDispatchCtx<T> = {
    setSaved: (value: T) => { saved = value; },
    setError: (message: string) => { thrown = new Error(message); },
  };
  const handle = (block: string): void => {
    const parsed = readSseBlock(block);
    if (!parsed) return;
    dispatch(parsed.event, parsed.data as Record<string, unknown>, ctx);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\n\n/);
    buffer = blocks.pop() ?? '';
    for (const block of blocks) handle(block);
    if (thrown) throw thrown;
  }
  buffer += decoder.decode();
  if (buffer.trim()) handle(buffer);
  if (thrown) throw thrown;
  if (!saved) throw new Error(notSavedMessage);
  return saved;
}
