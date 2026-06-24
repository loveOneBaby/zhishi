import type { Entry } from './types.js';

export interface AskResult {
  configured: boolean;
  answer: string;
}

// 预留的 AI 问答接口。
// 设置环境变量 AI_API_KEY（及可选 AI_BASE_URL / AI_MODEL）后即可启用。
// 默认接入 OpenAI 兼容的 /chat/completions 接口；未配置时返回占位提示。
export async function askAI(query: string, context: Entry[]): Promise<AskResult> {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) {
    return {
      configured: false,
      answer:
        '当前未配置 AI（缺少环境变量 AI_API_KEY）。\n配置后，未命中的问题会实时生成结构化回答，并可引用知识库内容。',
    };
  }

  const baseUrl = process.env.AI_BASE_URL || 'https://api.openai.com/v1';
  const model = process.env.AI_MODEL || 'gpt-4o-mini';

  // 取相关度最高的若干条作为上下文
  const snippets = context
    .slice(0, 5)
    .map((e) => `【${e.cat}·${e.title}】${e.summary}`)
    .join('\n');

  const messages = [
    {
      role: 'system',
      content:
        '你是一个面试知识助手。用简洁、结构化的中文回答问题，适当使用 ## 小标题和 - 列表。如下知识库片段可作参考：\n' +
        (snippets || '（无相关片段）'),
    },
    { role: 'user', content: query },
  ];

  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages, temperature: 0.3 }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      return { configured: true, answer: `AI 接口返回错误（${resp.status}）：${text.slice(0, 300)}` };
    }
    const data: any = await resp.json();
    const answer = data?.choices?.[0]?.message?.content?.trim() || '（AI 未返回内容）';
    return { configured: true, answer };
  } catch (err: any) {
    return { configured: true, answer: `调用 AI 失败：${err?.message || String(err)}` };
  }
}
