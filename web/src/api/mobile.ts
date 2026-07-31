import type { Entry, KbCategory, KnowledgeBase } from '../types';
import { apiGetJson } from './client';

export interface MobileBootstrapPayload {
  kbs: KnowledgeBase[];
  kbCategories: KbCategory[];
  counts: Record<string, number>;
  recommendations: Entry[];
  totalEntries: number;
}

export interface MobileEntriesPayload {
  entries: Entry[];
  total: number;
  offset: number;
  limit: number;
}

export interface MobileEntryRef {
  id: string;
  title: string;
  cat: string;
  kbId: string;
}

export interface MobileEntryNavigationPayload {
  previous: MobileEntryRef | null;
  next: MobileEntryRef | null;
}

export function fetchMobileBootstrap(): Promise<MobileBootstrapPayload> {
  return apiGetJson('/mobile/bootstrap');
}

export function fetchMobileEntries(options: { kbId?: string; kbIds?: string[]; offset?: number; limit?: number } = {}): Promise<MobileEntriesPayload> {
  const params = new URLSearchParams();
  if (options.kbId) params.set('kbId', options.kbId);
  if (options.kbIds?.length) params.set('kbIds', options.kbIds.join(','));
  params.set('offset', String(options.offset ?? 0));
  params.set('limit', String(options.limit ?? 24));
  return apiGetJson(`/mobile/entries?${params}`);
}

export function searchMobileEntries(query: string, limit = 50): Promise<MobileEntriesPayload> {
  return apiGetJson(`/mobile/search?q=${encodeURIComponent(query)}&limit=${limit}`);
}

export function fetchMobileEntryNavigation(entryId: string): Promise<MobileEntryNavigationPayload> {
  return apiGetJson(`/mobile/entry/${encodeURIComponent(entryId)}/navigation`);
}
