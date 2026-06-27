import { ChatOpenAI } from '@langchain/openai';
import { AIMessage, AIMessageChunk, HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';

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

// 单次 AI 调用的 token 消耗(与 LangChain usage_metadata 对齐)
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AiRequestOptions extends Partial<Pick<AiConfig, 'model' | 'temperature'>> {
  signal?: AbortSignal;
  // 流式调用时开启 stream_options.include_usage，使最后一个 chunk 带 usage_metadata
  streamUsage?: boolean;
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

function toLangChainMessage(message: AiMessage): BaseMessage {
  if (message.role === 'system') return new SystemMessage(message.content);
  if (message.role === 'assistant') return new AIMessage(message.content);
  return new HumanMessage(message.content);
}

function createLangChainModel(options: AiRequestOptions = {}): ChatOpenAI {
  const config = getAiConfig();
  if (!config.apiKey) throw new AiConfigError();
  return new ChatOpenAI({
    apiKey: config.apiKey,
    model: options.model ?? config.model,
    temperature: options.temperature ?? config.temperature,
    streamUsage: options.streamUsage ?? false,
    configuration: {
      baseURL: config.baseUrl,
    },
  });
}

// 从 AIMessage/AIMessageChunk.usage_metadata 提取 token 消耗，缺失或全 0 时返回 null
function extractUsage(message: AIMessage | AIMessageChunk): TokenUsage | null {
  const meta = (message as AIMessage).usage_metadata as
    | { input_tokens?: number; output_tokens?: number; total_tokens?: number }
    | undefined;
  if (!meta) return null;
  const promptTokens = Number(meta.input_tokens ?? 0);
  const completionTokens = Number(meta.output_tokens ?? 0);
  const totalTokens = Number(meta.total_tokens ?? (promptTokens + completionTokens));
  if (!promptTokens && !completionTokens && !totalTokens) return null;
  return { promptTokens, completionTokens, totalTokens };
}

// AIMessage.content 可能是 string 或多模态数组，统一规整为纯文本
function messageContentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
          return (part as { text: string }).text;
        }
        return '';
      })
      .join('');
  }
  return '';
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
  onUsage?: (usage: TokenUsage) => void,
): Promise<string> {
  const model = createLangChainModel(options);
  const aiMessage = await model.invoke(messages.map(toLangChainMessage), { signal: options.signal });
  const usage = extractUsage(aiMessage);
  if (usage) onUsage?.(usage);
  const content = messageContentToText(aiMessage.content).trim();
  if (!content) throw new Error('AI 未返回内容');
  return content;
}

export async function chatCompletionStream(
  messages: AiMessage[],
  options: AiRequestOptions = {},
  onDelta?: (delta: string) => void,
  onUsage?: (usage: TokenUsage) => void,
): Promise<string> {
  let full = '';
  const model = createLangChainModel({ ...options, streamUsage: true });
  const stream = await model.stream(messages.map(toLangChainMessage), { signal: options.signal });
  for await (const chunk of stream) {
    const delta = messageContentToText(chunk.content);
    if (delta) {
      full += delta;
      onDelta?.(delta);
    }
    const usage = extractUsage(chunk);
    if (usage) onUsage?.(usage);
  }
  const content = full.trim();
  if (!content) throw new Error('AI 未返回内容');
  return content;
}
