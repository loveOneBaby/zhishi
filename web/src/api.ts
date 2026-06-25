import type { Entry, EntryInput, IndexNode, KnowledgeBase, Folder } from './types';

const BASE = '/api';

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `请求失败 ${res.status}`;
    try { const d = await res.json(); if (d?.error) msg = d.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

// ───────────── 知识库 ─────────────

export async function fetchKbs(): Promise<KnowledgeBase[]> {
  const data = await j<{ kbs: KnowledgeBase[] }>(await fetch(`${BASE}/kbs`));
  return data.kbs;
}

export async function createKb(name: string): Promise<KnowledgeBase> {
  const res = await fetch(`${BASE}/kbs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return j<{ kb: KnowledgeBase }>(res).then((d) => d.kb);
}

export async function renameKb(id: string, name: string): Promise<KnowledgeBase> {
  const res = await fetch(`${BASE}/kbs/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return j<{ kb: KnowledgeBase }>(res).then((d) => d.kb);
}

export async function deleteKb(id: string): Promise<{ kbs: KnowledgeBase[]; folders: Folder[]; entries: Entry[] }> {
  const res = await fetch(`${BASE}/kbs/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return j(res);
}

export async function reorderKbs(ids: string[]): Promise<KnowledgeBase[]> {
  const res = await fetch(`${BASE}/kbs/reorder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  return j<{ kbs: KnowledgeBase[] }>(res).then((d) => d.kbs);
}

// ───────────── 文件夹 ─────────────

export async function fetchFolders(): Promise<Folder[]> {
  const data = await j<{ folders: Folder[] }>(await fetch(`${BASE}/folders`));
  return data.folders;
}

export async function createFolder(input: { kbId: string; parentId?: string | null; name: string }): Promise<Folder> {
  const res = await fetch(`${BASE}/folders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return j<{ folder: Folder }>(res).then((d) => d.folder);
}

export async function renameFolder(id: string, name: string): Promise<Folder> {
  const res = await fetch(`${BASE}/folders/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return j<{ folder: Folder }>(res).then((d) => d.folder);
}

export async function moveFolder(id: string, opts: { parentId?: string | null; kbId?: string }): Promise<Folder[]> {
  const res = await fetch(`${BASE}/folders/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...opts }),
  });
  return j<{ folders: Folder[] }>(res).then((d) => d.folders);
}

export async function deleteFolder(id: string): Promise<{ folders: Folder[]; entries: Entry[] }> {
  const res = await fetch(`${BASE}/folders/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return j(res);
}

export async function reorderFolders(ids: string[]): Promise<Folder[]> {
  const res = await fetch(`${BASE}/folders/reorder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  return j<{ folders: Folder[] }>(res).then((d) => d.folders);
}

// ───────────── 知识点 ─────────────

export async function fetchEntries(): Promise<Entry[]> {
  const data = await j<{ entries: Entry[] }>(await fetch(`${BASE}/entries`));
  return data.entries;
}

// 兼容旧引用
export type { EntryInput };
export type NewEntryInput = EntryInput;

export async function createEntry(input: EntryInput): Promise<Entry> {
  const res = await fetch(`${BASE}/entries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await j<{ entry: Entry }>(res);
  return data.entry;
}

export interface GenerateEntryInput {
  topic: string;
  kbId: string;
  folderId?: string | null;
}

export async function generateEntryWithAI(input: GenerateEntryInput): Promise<Entry> {
  const res = await fetch(`${BASE}/entries/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await j<{ configured: boolean; entry?: Entry; error?: string }>(res);
  if (!data.configured || !data.entry) throw new Error(data.error || 'AI 未配置，请先配置 server/.env');
  return data.entry;
}

export interface GenerateEntryStreamHandlers {
  onStage?: (message: string) => void;
  onContext?: (items: Array<{ title: string; summary: string }>) => void;
  onDelta?: (content: string) => void;
  onOutput?: (content: string) => void;
  onParsed?: (payload: { title: string; tags: string[]; sections: number }) => void;
  onSaved?: (entry: Entry) => void;
}

export interface GenerateKnowledgeBaseInput {
  domain: string;
  questionCount?: number;
}

export interface GenerateKnowledgeBaseResult {
  kb: KnowledgeBase;
  folders: Folder[];
  entries: Entry[];
}

export interface GenerateKnowledgeBaseStreamHandlers {
  onStage?: (message: string) => void;
  onDelta?: (content: string) => void;
  onOutput?: (content: string) => void;
  onParsed?: (payload: { kbName: string; folders: number; questions: number }) => void;
  onSaved?: (result: GenerateKnowledgeBaseResult) => void;
}

export type AiJobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface AiKnowledgeBaseJob {
  id: string;
  kind: 'kb-generate' | 'folder-init';
  domain: string;
  questionCount: number;
  kbId?: string;
  kbName?: string;
  parentId?: string | null;
  targetPath?: string;
  status: AiJobStatus;
  logs: string[];
  modelOutput: string;
  parsed?: { kbName: string; folders: number; questions: number };
  result?: GenerateKnowledgeBaseResult;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface InitKnowledgeBaseFoldersInput {
  kbId: string;
  parentId?: string | null;
  domain?: string;
  folderCount?: number;
}

export async function startGenerateKnowledgeBaseJob(input: GenerateKnowledgeBaseInput): Promise<AiKnowledgeBaseJob> {
  const res = await fetch(`${BASE}/kbs/generate/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return j<{ job: AiKnowledgeBaseJob }>(res).then((d) => d.job);
}

export async function startInitKnowledgeBaseFoldersJob(input: InitKnowledgeBaseFoldersInput): Promise<AiKnowledgeBaseJob> {
  const res = await fetch(`${BASE}/kbs/${encodeURIComponent(input.kbId)}/folders/init/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      parentId: input.parentId ?? null,
      domain: input.domain,
      folderCount: input.folderCount,
    }),
  });
  return j<{ job: AiKnowledgeBaseJob }>(res).then((d) => d.job);
}

export async function fetchAiJobs(): Promise<AiKnowledgeBaseJob[]> {
  const data = await j<{ jobs: AiKnowledgeBaseJob[] }>(await fetch(`${BASE}/ai/jobs`));
  return data.jobs;
}

export async function fetchAiJob(id: string): Promise<AiKnowledgeBaseJob> {
  const data = await j<{ job: AiKnowledgeBaseJob }>(await fetch(`${BASE}/ai/jobs/${encodeURIComponent(id)}`));
  return data.job;
}

function readSseBlock(block: string): { event: string; data: unknown } | null {
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

export async function generateEntryWithAIStream(input: GenerateEntryInput, handlers: GenerateEntryStreamHandlers = {}): Promise<Entry> {
  const res = await fetch(`${BASE}/entries/generate/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
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
  let saved: Entry | null = null;
  let thrown: Error | null = null;

  const handle = (block: string): void => {
    const parsed = readSseBlock(block);
    if (!parsed) return;
    const data = parsed.data as Record<string, unknown>;
    if (parsed.event === 'stage' && typeof data.message === 'string') handlers.onStage?.(data.message);
    if (parsed.event === 'context' && Array.isArray(data.items)) {
      handlers.onContext?.(data.items as Array<{ title: string; summary: string }>);
    }
    if (parsed.event === 'model-delta' && typeof data.content === 'string') handlers.onDelta?.(data.content);
    if (parsed.event === 'model-output' && typeof data.content === 'string') handlers.onOutput?.(data.content);
    if (parsed.event === 'parsed') {
      handlers.onParsed?.({
        title: String(data.title ?? ''),
        tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
        sections: Number(data.sections ?? 0),
      });
    }
    if ((parsed.event === 'saved' || parsed.event === 'done') && data.entry && typeof data.entry === 'object') {
      saved = data.entry as Entry;
      handlers.onSaved?.(saved);
    }
    if (parsed.event === 'error') {
      thrown = new Error(String(data.error ?? 'AI 生成失败'));
    }
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
  if (!saved) throw new Error('AI 生成未返回知识点');
  return saved;
}

export async function generateKnowledgeBaseWithAIStream(
  input: GenerateKnowledgeBaseInput,
  handlers: GenerateKnowledgeBaseStreamHandlers = {},
): Promise<GenerateKnowledgeBaseResult> {
  const res = await fetch(`${BASE}/kbs/generate/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
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
  let saved: GenerateKnowledgeBaseResult | null = null;
  let thrown: Error | null = null;

  const handle = (block: string): void => {
    const parsed = readSseBlock(block);
    if (!parsed) return;
    const data = parsed.data as Record<string, unknown>;
    if (parsed.event === 'stage' && typeof data.message === 'string') handlers.onStage?.(data.message);
    if (parsed.event === 'model-delta' && typeof data.content === 'string') handlers.onDelta?.(data.content);
    if (parsed.event === 'model-output' && typeof data.content === 'string') handlers.onOutput?.(data.content);
    if (parsed.event === 'parsed-kb') {
      handlers.onParsed?.({
        kbName: String(data.kbName ?? ''),
        folders: Number(data.folders ?? 0),
        questions: Number(data.questions ?? 0),
      });
    }
    if ((parsed.event === 'saved-kb' || parsed.event === 'done') && data.kb && Array.isArray(data.folders) && Array.isArray(data.entries)) {
      saved = {
        kb: data.kb as KnowledgeBase,
        folders: data.folders as Folder[],
        entries: data.entries as Entry[],
      };
      if (parsed.event === 'saved-kb') handlers.onSaved?.(saved);
    }
    if (parsed.event === 'error') {
      thrown = new Error(String(data.error ?? 'AI 新建知识库失败'));
    }
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
  if (!saved) throw new Error('AI 新建知识库未返回保存结果');
  return saved;
}

export async function rewriteEntryWithAIStream(entryId: string, handlers: GenerateEntryStreamHandlers = {}): Promise<Entry> {
  const res = await fetch(`${BASE}/entries/${encodeURIComponent(entryId)}/rewrite/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
  let saved: Entry | null = null;
  let thrown: Error | null = null;

  const handle = (block: string): void => {
    const parsed = readSseBlock(block);
    if (!parsed) return;
    const data = parsed.data as Record<string, unknown>;
    if (parsed.event === 'stage' && typeof data.message === 'string') handlers.onStage?.(data.message);
    if (parsed.event === 'model-delta' && typeof data.content === 'string') handlers.onDelta?.(data.content);
    if (parsed.event === 'model-output' && typeof data.content === 'string') handlers.onOutput?.(data.content);
    if (parsed.event === 'parsed') {
      handlers.onParsed?.({
        title: String(data.title ?? ''),
        tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
        sections: Number(data.sections ?? 0),
      });
    }
    if ((parsed.event === 'saved' || parsed.event === 'done') && data.entry && typeof data.entry === 'object') {
      saved = data.entry as Entry;
      handlers.onSaved?.(saved);
    }
    if (parsed.event === 'error') {
      thrown = new Error(String(data.error ?? 'AI 改写失败'));
    }
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
  if (!saved) throw new Error('AI 改写未返回知识点');
  return saved;
}

export async function updateEntry(id: string, input: EntryInput): Promise<Entry> {
  const res = await fetch(`${BASE}/entries/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await j<{ entry: Entry }>(res);
  return data.entry;
}

export async function deleteEntry(id: string): Promise<void> {
  const res = await fetch(`${BASE}/entries/${encodeURIComponent(id)}`, { method: 'DELETE' });
  await j<{ ok: boolean }>(res);
}

// 按给定顺序重排，返回重排后的全量列表
export async function reorderEntries(ids: string[]): Promise<Entry[]> {
  const res = await fetch(`${BASE}/entries/reorder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  const data = await j<{ entries: Entry[] }>(res);
  return data.entries;
}

export interface ExportPayload {
  version: string;
  exportedAt: number;
  kbs: KnowledgeBase[];
  folders: Folder[];
  entries: Entry[];
}

export async function exportAll(): Promise<ExportPayload> {
  return j<ExportPayload>(await fetch(`${BASE}/export`));
}

// 导入载荷：新格式 = entries（BlockNote 块文档）；兼容旧 knowledge-tree-v1（meta + tree）
export interface ImportPayload {
  version?: string;
  meta?: unknown;
  package?: unknown;
  schema?: unknown;
  containers?: unknown[];
  extensions?: unknown;
  kbs?: unknown[];
  folders?: unknown[];
  tree?: unknown[];
  entries?: unknown[];
  assets?: unknown[];
  targetKbId?: string;
  targetKbName?: string;
  targetFolderId?: string | null;
  importBatchId?: string;
}

export interface ImportResult {
  ok: boolean;
  imported: number;
  kbs: KnowledgeBase[];
  folders: Folder[];
  entries: Entry[];
}

export async function importAll(payload: ImportPayload, replace: boolean): Promise<ImportResult> {
  const res = await fetch(`${BASE}/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, replace }),
  });
  return j<ImportResult>(res);
}

// 导入预览：解析载荷但不写库，返回将导入的条目与统计。与 importAll 同构输入。
export interface PreviewEntry {
  id?: string;
  cat: string;
  kbId?: string;
  folderId?: string | null;
  title: string;
  tags: string[];
  summary: string;
  intro: string;
  nodes: IndexNode[];
  exists: boolean;   // id 命中已有 → 将更新；否则新增
  valid: boolean;    // 标题非空 → 有效；否则导入时会被跳过
}

export interface ImportPreview {
  total: number;
  valid: number;
  skipped: number;
  newCount: number;
  updateCount: number;
  byCat: { cat: string; count: number }[];
  folders: {
    id?: string;
    kbId?: string;
    parentId?: string | null;
    name: string;
    path: string;
  }[];
  entries: PreviewEntry[];
}

export async function previewImport(payload: ImportPayload): Promise<ImportPreview> {
  const res = await fetch(`${BASE}/import/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await j<{ preview: ImportPreview }>(res);
  return data.preview;
}

// 上传图片(转 dataURL → /api/assets 落库去重),返回站内可用 url
export async function uploadAsset(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
  const res = await fetch(`${BASE}/assets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataUrl, alt: file.name }),
  });
  const data = await j<{ asset: { url: string } }>(res);
  return data.asset.url;
}

export interface AskResponse {
  configured: boolean;
  answer: string;
}

export async function askAI(query: string): Promise<AskResponse> {
  const res = await fetch(`${BASE}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  return j<AskResponse>(res);
}
