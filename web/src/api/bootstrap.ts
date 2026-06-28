import type { Entry, Folder, KbCategory, KnowledgeBase } from '../types';
import { apiGetJson } from './client';
import type { AuthStatus } from './auth';

export interface BootstrapPayload {
  auth: AuthStatus;
  entries: Entry[];
  kbs: KnowledgeBase[];
  folders: Folder[];
  kbCategories: KbCategory[];
}

export function fetchBootstrap(): Promise<BootstrapPayload> {
  return apiGetJson<BootstrapPayload>('/bootstrap');
}
