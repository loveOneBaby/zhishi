import { apiGetJson, apiPostJson } from './client';
import type { AuthStatus } from './auth';

// 与 server/src/db/client.ts 的 DbInfo 对齐：仅展示，不含 token。
export interface DbInfo {
  mode: 'local' | 'remote';
  label: string;
  source: 'user' | 'env' | 'default';
}

export interface ServerConfig {
  auth: AuthStatus;
  db: DbInfo;
}

export interface DbConfigBody {
  mode?: 'local' | 'remote';
  url?: string;
  token?: string;
  dbPath?: string;
  clear?: boolean;
}

export interface DbConfigResult {
  ok: boolean;
  db: DbInfo;
}

export function getServerConfig(): Promise<ServerConfig> {
  return apiGetJson<ServerConfig>('/config');
}

export function setDbConfig(body: DbConfigBody): Promise<DbConfigResult> {
  return apiPostJson<DbConfigResult>('/config/db', body);
}
