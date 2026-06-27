import type { Entry, Folder, KnowledgeBase } from '../types';
import { apiDelJson, apiGetKey, apiPostKey, apiPutKey, runSseStream } from './client';
import type { AiKnowledgeBaseJob, GenerateKnowledgeBaseResult } from './aiJobs';

// ───────────── AI 分析知识库(后台任务) ─────────────

export type { KbAnalysis, KbSuggestion, KbSuggestionKind } from './aiJobs';

export async function startAnalyzeJob(kbId: string): Promise<AiKnowledgeBaseJob> {
  return apiPostKey<AiKnowledgeBaseJob>(`/kbs/${encodeURIComponent(kbId)}/analyze/jobs`, {}, 'job');
}

export async function startAnalyzeEntryJob(entryId: string): Promise<AiKnowledgeBaseJob> {
  return apiPostKey<AiKnowledgeBaseJob>(`/entries/${encodeURIComponent(entryId)}/analyze/jobs`, {}, 'job');
}

// ───────────── 知识库 CRUD ─────────────

export async function fetchKbs(): Promise<KnowledgeBase[]> {
  return apiGetKey<KnowledgeBase[]>('/kbs', 'kbs');
}
export async function createKb(name: string): Promise<KnowledgeBase> {
  return apiPostKey<KnowledgeBase>('/kbs', { name }, 'kb');
}
export async function renameKb(id: string, name: string): Promise<KnowledgeBase> {
  return apiPutKey<KnowledgeBase>(`/kbs/${encodeURIComponent(id)}`, { name }, 'kb');
}
export async function deleteKb(id: string): Promise<{ kbs: KnowledgeBase[]; folders: Folder[]; entries: Entry[] }> {
  return apiDelJson(`/kbs/${encodeURIComponent(id)}`);
}
export async function reorderKbs(ids: string[]): Promise<KnowledgeBase[]> {
  return apiPostKey<KnowledgeBase[]>('/kbs/reorder', { ids }, 'kbs');
}

// ───────────── AI 建库 ─────────────

export interface GenerateKnowledgeBaseInput {
  domain: string;
  questionCount?: number;
}

export interface GenerateKnowledgeBaseStreamHandlers {
  onStage?: (message: string) => void;
  onDelta?: (content: string) => void;
  onOutput?: (content: string) => void;
  onParsed?: (payload: { kbName: string; folders: number; questions: number }) => void;
  onSaved?: (result: GenerateKnowledgeBaseResult) => void;
}

export async function startGenerateKnowledgeBaseJob(input: GenerateKnowledgeBaseInput): Promise<AiKnowledgeBaseJob> {
  return apiPostKey<AiKnowledgeBaseJob>('/kbs/generate/jobs', input, 'job');
}

export async function generateKnowledgeBaseWithAIStream(
  input: GenerateKnowledgeBaseInput,
  handlers: GenerateKnowledgeBaseStreamHandlers = {},
): Promise<GenerateKnowledgeBaseResult> {
  const dispatch = (event: string, data: Record<string, unknown>, ctx: { setSaved: (v: GenerateKnowledgeBaseResult) => void; setError: (m: string) => void }): void => {
    if (event === 'stage' && typeof data.message === 'string') handlers.onStage?.(data.message);
    if (event === 'model-delta' && typeof data.content === 'string') handlers.onDelta?.(data.content);
    if (event === 'model-output' && typeof data.content === 'string') handlers.onOutput?.(data.content);
    if (event === 'parsed-kb') {
      handlers.onParsed?.({
        kbName: String(data.kbName ?? ''),
        folders: Number(data.folders ?? 0),
        questions: Number(data.questions ?? 0),
      });
    }
    if ((event === 'saved-kb' || event === 'done') && data.kb && Array.isArray(data.folders) && Array.isArray(data.entries)) {
      const result: GenerateKnowledgeBaseResult = {
        kb: data.kb as KnowledgeBase,
        folders: data.folders as Folder[],
        entries: data.entries as Entry[],
      };
      ctx.setSaved(result);
      if (event === 'saved-kb') handlers.onSaved?.(result);
    }
    if (event === 'error') ctx.setError(String(data.error ?? 'AI 新建知识库失败'));
  };
  return runSseStream<GenerateKnowledgeBaseResult>('/kbs/generate/stream', input, 'AI 新建知识库未返回保存结果', dispatch);
}
