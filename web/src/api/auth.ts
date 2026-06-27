import { apiGetJson, apiPostJson } from './client';

export interface AuthStatus {
  authRequired: boolean;
  authenticated: boolean;
}

export function fetchAuthStatus(): Promise<AuthStatus> {
  return apiGetJson<AuthStatus>('/auth/status');
}

export function login(token: string): Promise<AuthStatus> {
  return apiPostJson<AuthStatus>('/auth/login', { token });
}

export function logout(): Promise<{ ok: boolean }> {
  return apiPostJson<{ ok: boolean }>('/auth/logout', {});
}
