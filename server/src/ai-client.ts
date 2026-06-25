export type AiRole = 'system' | 'user' | 'assistant';

export interface AiMessage {
  role: AiRole;
  content: string;
}

export interface AiConfig {
  configured: boolean;
  apiKey?: string;
  baseUrl: string;
  model: string;
  temperature: number;
}

export interface AiRequestOptions extends Partial<Pick<AiConfig, 'model' | 'temperature'>> {
  signal?: AbortSignal;
}

export class AiConfigError extends Error {
  constructor(message = 'AI 未配置：请在 server/.env 中设置 AI_API_KEY') {
    super(message);
    this.name = 'AiConfigError';
  }
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function numberEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function getAiConfig(): AiConfig {
  const apiKey = clean(process.env.AI_API_KEY)
    || clean(process.env.BAILIAN_API_KEY)
    || clean(process.env.DASHSCOPE_API_KEY);
  const baseUrl = clean(process.env.AI_BASE_URL)
    || clean(process.env.BAILIAN_BASE_URL)
    || clean(process.env.DASHSCOPE_BASE_URL)
    || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  const model = clean(process.env.AI_MODEL)
    || clean(process.env.QWEN_MODEL)
    || 'qwen-plus';
  return {
    configured: Boolean(apiKey),
    apiKey,
    baseUrl: trimTrailingSlash(baseUrl),
    model,
    temperature: numberEnv(process.env.AI_TEMPERATURE, 0.35),
  };
}

export async function chatCompletion(
  messages: AiMessage[],
  options: AiRequestOptions = {},
): Promise<string> {
  const config = getAiConfig();
  if (!config.apiKey) throw new AiConfigError();

  const resp = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    signal: options.signal,
    body: JSON.stringify({
      model: options.model ?? config.model,
      messages,
      temperature: options.temperature ?? config.temperature,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`AI 接口返回错误（${resp.status}）：${text.slice(0, 500)}`);
  }
  const data = await resp.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('AI 未返回内容');
  return content;
}

export async function chatCompletionStream(
  messages: AiMessage[],
  options: AiRequestOptions = {},
  onDelta?: (delta: string) => void,
): Promise<string> {
  const config = getAiConfig();
  if (!config.apiKey) throw new AiConfigError();

  const resp = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    signal: options.signal,
    body: JSON.stringify({
      model: options.model ?? config.model,
      messages,
      temperature: options.temperature ?? config.temperature,
      stream: true,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`AI 接口返回错误（${resp.status}）：${text.slice(0, 500)}`);
  }
  if (!resp.body) throw new Error('AI 接口未返回流式响应');

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  const consumeLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    let parsed: {
      choices?: Array<{
        delta?: { content?: string; reasoning_content?: string };
        message?: { content?: string };
      }>;
    };
    try {
      parsed = JSON.parse(payload);
    } catch {
      return;
    }
    const choice = parsed.choices?.[0];
    const delta = choice?.delta?.content ?? choice?.message?.content ?? '';
    // reasoning_content 是模型隐藏推理类字段，不暴露到 UI。
    if (!delta) return;
    full += delta;
    onDelta?.(delta);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) consumeLine(line);
  }
  buffer += decoder.decode();
  for (const line of buffer.split(/\r?\n/)) consumeLine(line);

  const content = full.trim();
  if (!content) throw new Error('AI 未返回内容');
  return content;
}
