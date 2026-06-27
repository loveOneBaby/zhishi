import type { Entry } from './types.js';
import { AiConfigError, chatCompletion, type AiMessage } from './ai-client.js';

export interface AskResult {
  configured: boolean;
  answer: string;
}

// AI 问答接口。默认按百炼/DashScope OpenAI-compatible 模式接入。
export async function askAI(query: string, context: Entry[]): Promise<AskResult> {
  // 取相关度最高的若干条作为上下文
  const snippets = context
    .slice(0, 5)
    .map((e) => `【${e.cat}·${e.title}】${e.summary}`)
    .join('\n');

  const messages: AiMessage[] = [
    {
      role: 'system',
      content:
        '你是一个面试知识助手。用简洁、结构化的中文回答问题，适当使用 ## 小标题和 - 列表。如下知识库片段可作参考：\n' +
        (snippets || '（无相关片段）'),
    },
    { role: 'user', content: query },
  ];

  try {
    const answer = await chatCompletion(messages, { temperature: 0.3 });
    return { configured: true, answer };
  } catch (err: any) {
    if (err instanceof AiConfigError) {
      return {
        configured: false,
        answer:
          '当前未配置 AI（缺少环境变量 AI_API_KEY）。\n配置 server/.env 后，可用百炼 Qwen 生成问答和知识点。',
      };
    }
    console.warn('[server] AI 问答调用失败:', err);
    return { configured: true, answer: 'AI 调用失败，请稍后重试。' };
  }
}
