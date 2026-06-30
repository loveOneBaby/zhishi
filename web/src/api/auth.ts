import { API_TOKEN_STORAGE_KEY, apiGetJson, apiPostJson, isExtensionRuntime } from './client';

export interface AuthStatus {
  authRequired: boolean;
  authenticated: boolean;
}

export function fetchAuthStatus(): Promise<AuthStatus> {
  return apiGetJson<AuthStatus>('/auth/status');
}

export async function login(token: string): Promise<AuthStatus> {
  const status = await apiPostJson<AuthStatus>('/auth/login', { token });
  if (isExtensionRuntime()) {
    try { window.localStorage.setItem(API_TOKEN_STORAGE_KEY, token); } catch { /* ignore */ }
  }
  return status;
}

export async function logout(): Promise<{ ok: boolean }> {
  try {
    return await apiPostJson<{ ok: boolean }>('/auth/logout', {});
  } finally {
    if (isExtensionRuntime()) {
      try { window.localStorage.removeItem(API_TOKEN_STORAGE_KEY); } catch { /* ignore */ }
    }
  }
}
