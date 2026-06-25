export const BASE = '/api';

export async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `请求失败 ${res.status}`;
    try { const d = await res.json(); if (d?.error) msg = d.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

// ───────────── JSON 请求封装(行为等价:收敛重复的 fetch + j + 取键样板) ─────────────

export async function apiGetJson<T>(path: string): Promise<T> {
  return j<T>(await fetch(`${BASE}${path}`));
}
export async function apiGetKey<T>(path: string, key: string): Promise<T> {
  const data = await j<Record<string, T>>(await fetch(`${BASE}${path}`));
  return data[key];
}
export async function apiPostJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return j<T>(res);
}
export async function apiPostKey<T>(path: string, body: unknown, key: string): Promise<T> {
  const data = await j<Record<string, T>>(await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  return data[key];
}
export async function apiPutKey<T>(path: string, body: unknown, key: string): Promise<T> {
  const data = await j<Record<string, T>>(await fetch(`${BASE}${path}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  return data[key];
}
export async function apiDelJson<T>(path: string): Promise<T> {
  return j<T>(await fetch(`${BASE}${path}`, { method: 'DELETE' }));
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
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
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
