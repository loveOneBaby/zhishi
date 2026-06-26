import type { Entry, EntryInput } from '../types';
import { apiDelJson, apiGetKey, apiPostJson, apiPostKey, apiPutKey, runSseStream, type SseDispatchCtx } from './client';

// 兼容旧引用
export type { EntryInput };
export type NewEntryInput = EntryInput;

// ───────────── 知识点 CRUD ─────────────

export async function fetchEntries(): Promise<Entry[]> {
  return apiGetKey<Entry[]>('/entries', 'entries');
}
export async function createEntry(input: EntryInput): Promise<Entry> {
  return apiPostKey<Entry>('/entries', input, 'entry');
}
export async function updateEntry(id: string, input: EntryInput): Promise<Entry> {
  return apiPutKey<Entry>(`/entries/${encodeURIComponent(id)}`, input, 'entry');
}
export async function deleteEntry(id: string): Promise<void> {
  await apiDelJson<{ ok: boolean }>(`/entries/${encodeURIComponent(id)}`);
}
// 按给定顺序重排,返回重排后的全量列表
export async function reorderEntries(ids: string[]): Promise<Entry[]> {
  return apiPostKey<Entry[]>('/entries/reorder', { ids }, 'entries');
}

// ───────────── AI 生成 / 改写 ─────────────

export interface GenerateEntryInput {
  topic: string;
  kbId: string;
  folderId?: string | null;
}

export interface GenerateEntryStreamHandlers {
  onStage?: (message: string) => void;
  onContext?: (items: Array<{ title: string; summary: string }>) => void;
  onDelta?: (content: string) => void;
  onOutput?: (content: string) => void;
  onParsed?: (payload: { title: string; tags: string[]; sections: number }) => void;
  onImage?: (payload: { url: string; assetId: string; caption: string; prompt: string }) => void;
  onSaved?: (entry: Entry) => void;
}

export interface EntryVersion {
  id: string;
  entryId: string;
  source: string;
  title: string;
  summary: string;
  tags: string[];
  snapshot: EntryInput;
  createdAt: number;
}

export async function generateEntryWithAI(input: GenerateEntryInput): Promise<Entry> {
  const data = await apiPostJson<{ configured: boolean; entry?: Entry; error?: string }>('/entries/generate', input);
  if (!data.configured || !data.entry) throw new Error(data.error || 'AI 未配置，请先配置 server/.env');
  return data.entry;
}

// generate 与 rewrite 的事件映射一致,仅错误信息不同,共用此 dispatch
function dispatchEntryStream(handlers: GenerateEntryStreamHandlers, errorMessage: string) {
  return (event: string, data: Record<string, unknown>, ctx: SseDispatchCtx<Entry>): void => {
    if (event === 'stage' && typeof data.message === 'string') handlers.onStage?.(data.message);
    if (event === 'context' && Array.isArray(data.items)) {
      handlers.onContext?.(data.items as Array<{ title: string; summary: string }>);
    }
    if (event === 'model-delta' && typeof data.content === 'string') handlers.onDelta?.(data.content);
    if (event === 'model-output' && typeof data.content === 'string') handlers.onOutput?.(data.content);
    if (event === 'image-stage' && typeof data.message === 'string') handlers.onStage?.(data.message);
    if (event === 'image') {
      handlers.onImage?.({
        url: String(data.url ?? ''),
        assetId: String(data.assetId ?? ''),
        caption: String(data.caption ?? ''),
        prompt: String(data.prompt ?? ''),
      });
    }
    if (event === 'parsed') {
      handlers.onParsed?.({
        title: String(data.title ?? ''),
        tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
        sections: Number(data.sections ?? 0),
      });
    }
    if ((event === 'saved' || event === 'done') && data.entry && typeof data.entry === 'object') {
      const entry = data.entry as Entry;
      ctx.setSaved(entry);
      handlers.onSaved?.(entry);
    }
    if (event === 'error') ctx.setError(String(data.error ?? errorMessage));
  };
}

function dispatchEntryDraftStream(handlers: GenerateEntryStreamHandlers, errorMessage: string) {
  return (event: string, data: Record<string, unknown>, ctx: SseDispatchCtx<EntryInput>): void => {
    if (event === 'stage' && typeof data.message === 'string') handlers.onStage?.(data.message);
    if (event === 'context' && Array.isArray(data.items)) {
      handlers.onContext?.(data.items as Array<{ title: string; summary: string }>);
    }
    if (event === 'model-delta' && typeof data.content === 'string') handlers.onDelta?.(data.content);
    if (event === 'model-output' && typeof data.content === 'string') handlers.onOutput?.(data.content);
    if (event === 'image-stage' && typeof data.message === 'string') handlers.onStage?.(data.message);
    if (event === 'image') {
      handlers.onImage?.({
        url: String(data.url ?? ''),
        assetId: String(data.assetId ?? ''),
        caption: String(data.caption ?? ''),
        prompt: String(data.prompt ?? ''),
      });
    }
    if (event === 'parsed') {
      handlers.onParsed?.({
        title: String(data.title ?? ''),
        tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
        sections: Number(data.sections ?? 0),
      });
    }
    if ((event === 'draft' || event === 'done') && data.input && typeof data.input === 'object') {
      ctx.setSaved(data.input as EntryInput);
    }
    if (event === 'error') ctx.setError(String(data.error ?? errorMessage));
  };
}

export async function generateEntryWithAIStream(input: GenerateEntryInput, handlers: GenerateEntryStreamHandlers = {}): Promise<Entry> {
  return runSseStream<Entry>('/entries/generate/stream', input, 'AI 生成未返回知识点', dispatchEntryStream(handlers, 'AI 生成失败'));
}

export async function rewriteEntryWithAIStream(entryId: string, handlers: GenerateEntryStreamHandlers = {}): Promise<Entry> {
  return runSseStream<Entry>(`/entries/${encodeURIComponent(entryId)}/rewrite/stream`, undefined, 'AI 改写未返回知识点', dispatchEntryStream(handlers, 'AI 改写失败'));
}

export async function generateEntryDraftWithAIStream(input: GenerateEntryInput, handlers: GenerateEntryStreamHandlers = {}): Promise<EntryInput> {
  return runSseStream<EntryInput>('/entries/generate/draft/stream', input, 'AI 生成未返回草稿', dispatchEntryDraftStream(handlers, 'AI 生成失败'));
}

export async function rewriteEntryDraftWithAIStream(entryId: string, handlers: GenerateEntryStreamHandlers = {}): Promise<EntryInput> {
  return runSseStream<EntryInput>(`/entries/${encodeURIComponent(entryId)}/rewrite/draft/stream`, undefined, 'AI 改写未返回草稿', dispatchEntryDraftStream(handlers, 'AI 改写失败'));
}

export async function generateEntryIllustrationWithAIStream(entryId: string, handlers: GenerateEntryStreamHandlers = {}): Promise<Entry> {
  return runSseStream<Entry>(`/entries/${encodeURIComponent(entryId)}/illustration/stream`, undefined, 'AI 图解未返回知识点', dispatchEntryStream(handlers, 'AI 图解失败'));
}

export async function commitRewriteEntryDraft(entryId: string, input: EntryInput): Promise<Entry> {
  return apiPostKey<Entry>(`/entries/${encodeURIComponent(entryId)}/rewrite/commit`, input, 'entry');
}

export async function fetchEntryVersions(entryId: string): Promise<EntryVersion[]> {
  return apiGetKey<EntryVersion[]>(`/entries/${encodeURIComponent(entryId)}/versions`, 'versions');
}

export async function restoreEntryVersion(entryId: string, versionId: string): Promise<Entry> {
  return apiPostKey<Entry>(`/entries/${encodeURIComponent(entryId)}/versions/${encodeURIComponent(versionId)}/restore`, {}, 'entry');
}
