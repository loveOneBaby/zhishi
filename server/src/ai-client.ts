import { ChatOpenAI } from '@langchain/openai';
import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { RunnableSequence } from '@langchain/core/runnables';

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
    configuration: {
      baseURL: config.baseUrl,
    },
  });
}

function createTextChain(messages: AiMessage[], options: AiRequestOptions = {}) {
  const prompt = ChatPromptTemplate.fromMessages(messages.map(toLangChainMessage));
  return RunnableSequence.from([
    prompt,
    createLangChainModel(options),
    new StringOutputParser(),
  ]);
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
  const chain = createTextChain(messages, options);
  const content = (await chain.invoke({}, { signal: options.signal })).trim();
  if (!content) throw new Error('AI 未返回内容');
  return content;
}

export async function chatCompletionStream(
  messages: AiMessage[],
  options: AiRequestOptions = {},
  onDelta?: (delta: string) => void,
): Promise<string> {
  let full = '';
  const chain = createTextChain(messages, options);
  const stream = await chain.stream({}, { signal: options.signal });
  for await (const chunk of stream) {
    const delta = String(chunk ?? '');
    if (!delta) continue;
    full += delta;
    onDelta?.(delta);
  }
  const content = full.trim();
  if (!content) throw new Error('AI 未返回内容');
  return content;
}
