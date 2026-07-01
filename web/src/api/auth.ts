import { API_TOKEN_STORAGE_KEY, apiGetJson, apiPostJson, usingCustomBase } from './client';

export interface AuthStatus {
  authRequired: boolean;
  authenticated: boolean;
}

export function fetchAuthStatus(): Promise<AuthStatus> {
  return apiGetJson<AuthStatus>('/auth/status');
}

export async function login(token: string): Promise<AuthStatus> {
  const status = await apiPostJson<AuthStatus>('/auth/login', { token });
  // 自定义后端（跨域 / 扩展）无法依赖同源 httpOnly cookie，需把 token 留在 localStorage 供 Bearer 头使用。
  // 同源 /api 仍由服务端 cookie 兜底，不落本地。
  if (usingCustomBase()) {
    try { window.localStorage.setItem(API_TOKEN_STORAGE_KEY, token); } catch { /* ignore */ }
  }
  return status;
}

export async function logout(): Promise<{ ok: boolean }> {
  try {
    return await apiPostJson<{ ok: boolean }>('/auth/logout', {});
  } finally {
    if (usingCustomBase()) {
      try { window.localStorage.removeItem(API_TOKEN_STORAGE_KEY); } catch { /* ignore */ }
    }
  }
}
