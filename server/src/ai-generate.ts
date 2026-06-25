import { chatCompletion, chatCompletionStream, type AiMessage } from './ai-client.js';
import { markdownToDocBlocks } from './doc.js';
import { blocksToMarkdown } from './blocks.js';
import type { EntryInput } from './db.js';
import type { Entry } from './types.js';

interface GeneratedSection {
  title: string;
  content: string;
  bullets: string[];
}

interface GeneratedDraft {
  title: string;
  summary: string;
  tags: string[];
  sections: GeneratedSection[];
  interviewPoints: string[];
  commonQuestions: string[];
  pitfalls: string[];
  answerTemplate: string;
}

export interface GenerateEntryOptions {
  topic: string;
  kbName: string;
  folderPath?: string;
  context?: Entry[];
}

export interface RewriteEntryOptions {
  entry: Entry;
}

export type GenerateEntryEvent =
  | { type: 'stage'; message: string }
  | { type: 'context'; items: Array<{ title: string; summary: string }> }
  | { type: 'model-delta'; content: string }
  | { type: 'model-output'; content: string }
  | { type: 'parsed'; title: string; tags: string[]; sections: number };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, fallback = ''): string {
  if (typeof value !== 'string') return fallback;
  return value.trim() || fallback;
}

function textArray(value: unknown, limit = 10): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const next = text(item);
    if (next && !out.includes(next)) out.push(next);
    if (out.length >= limit) break;
  }
  return out;
}

export function extractJsonObject(raw: string): string | null {
  const source = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const start = source.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

export function coerceGeneratedDraft(raw: unknown, topic: string): GeneratedDraft {
  const obj = asRecord(raw);
  const tags = [...textArray(obj.tags, 8), ...textArray(obj.keywords, 8)];
  const sections = Array.isArray(obj.sections)
    ? obj.sections.map((section) => {
        const item = asRecord(section);
        return {
          title: text(item.title),
          content: text(item.content),
          bullets: textArray(item.bullets, 8),
        };
      }).filter((section) => section.title || section.content || section.bullets.length)
    : [];
  const title = text(obj.title, topic);
  const summary = text(obj.summary, `围绕「${title}」梳理核心知识、面试考点和常见追问。`);
  return {
    title,
    summary,
    tags,
    sections,
    interviewPoints: textArray(obj.interviewPoints, 10),
    commonQuestions: textArray(obj.commonQuestions, 8),
    pitfalls: textArray(obj.pitfalls, 8),
    answerTemplate: text(obj.answerTemplate),
  };
}

function ensureTags(tags: string[], topic: string): string[] {
  const out: string[] = [];
  for (const tag of [topic, ...tags, 'AI生成']) {
    const next = tag.replace(/^#/, '').trim();
    if (next && !out.some((item) => item.toLowerCase() === next.toLowerCase())) out.push(next);
    if (out.length >= 8) break;
  }
  if (!out.some((item) => item.toLowerCase() === 'ai生成'.toLowerCase())) {
    out[out.length >= 8 ? out.length - 1 : out.length] = 'AI生成';
  }
  return out;
}

function bulletLines(items: string[]): string[] {
  return items.map((item) => `- ${item}`);
}

export function draftToMarkdown(draft: GeneratedDraft): string {
  const lines: string[] = [draft.summary, ''];
  for (const section of draft.sections) {
    if (section.title) lines.push(`## ${section.title}`);
    if (section.content) lines.push(section.content);
    lines.push(...bulletLines(section.bullets), '');
  }
  if (draft.interviewPoints.length) {
    lines.push('## 面试考点', ...bulletLines(draft.interviewPoints), '');
  }
  if (draft.answerTemplate) {
    lines.push('## 面试回答模板', draft.answerTemplate, '');
  }
  if (draft.commonQuestions.length) {
    lines.push('## 高频追问', ...bulletLines(draft.commonQuestions), '');
  }
  if (draft.pitfalls.length) {
    lines.push('## 易错点', ...bulletLines(draft.pitfalls), '');
  }
  if (!draft.sections.length && !draft.interviewPoints.length) {
    lines.push('## 核心知识', draft.summary, '', '## 面试考点', '- 定义、原理、应用场景和工程边界。', '');
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function contextText(context: Entry[] = []): string {
  return context.slice(0, 5).map((entry) => `- ${entry.title}：${entry.summary}`).join('\n') || '（暂无相似知识点）';
}

function buildGenerateMessages(options: GenerateEntryOptions): AiMessage[] {
  const { topic, kbName, folderPath, context = [] } = options;
  const prompt = [
    '请为面试知识库生成一个完整知识点。',
    '输出必须分两段：',
    '1）先输出“生成思路”，用 3-6 条短 bullet 说明你会如何组织知识点、选择哪些面试考点、参考了哪些相似知识点。这里是可公开的生成说明，不要输出隐藏推理链路。',
    '2）然后输出一行 ---JSON---，后面只放一个 JSON 对象，不要 Markdown 代码围栏。',
    'JSON 字段必须是：',
    '{"title":"知识点标题","summary":"一句话摘要","tags":["标签"],"sections":[{"title":"小节标题","content":"正文","bullets":["要点"]}],"interviewPoints":["面试考点"],"commonQuestions":["常见追问"],"pitfalls":["易错点"],"answerTemplate":"可直接用于面试回答的模板"}',
    '要求：中文，结构化，偏工程面试，内容准确克制；sections 至少包含“基本定义/核心原理/应用场景”中的两个；interviewPoints 至少 5 条。',
    `知识库：${kbName}`,
    `当前文件夹：${folderPath || '根层级'}`,
    `主题：${topic}`,
    '相似知识点参考：',
    contextText(context),
  ].join('\n');

  return [
    { role: 'system', content: '你是资深技术面试官和知识库编辑，擅长把主题整理成可复习、可追问的结构化知识点。可以输出可公开的生成说明，但不要泄露隐藏推理链路。' },
    { role: 'user', content: prompt },
  ];
}

function buildRewriteMessages(options: RewriteEntryOptions): AiMessage[] {
  const { entry } = options;
  const currentMarkdown = blocksToMarkdown(entry.doc);
  const prompt = [
    '请改写下面这个面试知识点，让它更适合复习和面试表达。',
    '输出必须分两段：',
    '1）先输出“改写思路”，用 3-6 条短 bullet 说明你会补强哪些知识、删减哪些冗余、如何组织面试考点。这里是可公开说明，不要输出隐藏推理链路。',
    '2）然后输出一行 ---JSON---，后面只放一个 JSON 对象，不要 Markdown 代码围栏。',
    'JSON 字段必须是：',
    '{"title":"知识点标题","summary":"一句话摘要","tags":["标签"],"sections":[{"title":"小节标题","content":"正文","bullets":["要点"]}],"interviewPoints":["面试考点"],"commonQuestions":["常见追问"],"pitfalls":["易错点"],"answerTemplate":"可直接用于面试回答的模板"}',
    '要求：中文，结构化，偏工程面试，内容准确克制；保留原知识点主题，不要凭空扩展到无关领域；sections 至少 3 个，interviewPoints 至少 5 条。',
    `原标题：${entry.title}`,
    `原摘要：${entry.summary || '（无）'}`,
    `原标签：${entry.tags.join('、') || '（无）'}`,
    '原正文：',
    currentMarkdown || blocksToMarkdown(markdownToDocBlocks(entry.intro)),
  ].join('\n');

  return [
    { role: 'system', content: '你是资深技术面试官和知识库编辑，擅长把已有笔记改写成结构清楚、面试可用的知识点。可以输出可公开的改写说明，但不要泄露隐藏推理链路。' },
    { role: 'user', content: prompt },
  ];
}

function entryInputFromModelOutput(raw: string, topic: string): EntryInput {
  const marker = raw.indexOf('---JSON---');
  const json = extractJsonObject(marker >= 0 ? raw.slice(marker + '---JSON---'.length) : raw);
  if (!json) throw new Error('AI 返回内容不是有效 JSON');
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('AI 返回 JSON 解析失败');
  }
  const draft = coerceGeneratedDraft(parsed, topic);
  return {
    title: draft.title,
    tags: ensureTags(draft.tags, topic),
    summary: draft.summary,
    doc: markdownToDocBlocks(draftToMarkdown(draft)),
  };
}

export async function generateEntryInput(options: GenerateEntryOptions): Promise<EntryInput> {
  const raw = await chatCompletion(buildGenerateMessages(options));
  return entryInputFromModelOutput(raw, options.topic);
}

export async function generateEntryInputStream(
  options: GenerateEntryOptions,
  onEvent: (event: GenerateEntryEvent) => void,
): Promise<EntryInput> {
  const context = options.context ?? [];
  onEvent({ type: 'stage', message: '检索相似知识点完成' });
  onEvent({
    type: 'context',
    items: context.slice(0, 5).map((entry) => ({ title: entry.title, summary: entry.summary })),
  });
  onEvent({ type: 'stage', message: '开始调用 Qwen 生成内容' });
  const raw = await chatCompletionStream(buildGenerateMessages(options), {}, (content) => {
    onEvent({ type: 'model-delta', content });
  });
  onEvent({ type: 'model-output', content: raw });
  onEvent({ type: 'stage', message: 'Qwen 输出完成，开始解析结构' });
  const input = entryInputFromModelOutput(raw, options.topic);
  onEvent({
    type: 'parsed',
    title: input.title,
    tags: input.tags ?? [],
    sections: input.doc?.filter((block) => block.type === 'heading').length ?? 0,
  });
  return input;
}

export async function rewriteEntryInputStream(
  options: RewriteEntryOptions,
  onEvent: (event: GenerateEntryEvent) => void,
): Promise<EntryInput> {
  const { entry } = options;
  onEvent({ type: 'stage', message: '读取当前 doc 内容完成' });
  onEvent({ type: 'stage', message: '开始调用 Qwen 改写知识点' });
  const raw = await chatCompletionStream(buildRewriteMessages(options), {}, (content) => {
    onEvent({ type: 'model-delta', content });
  });
  onEvent({ type: 'model-output', content: raw });
  onEvent({ type: 'stage', message: 'Qwen 输出完成，开始解析改写结果' });
  const input = entryInputFromModelOutput(raw, entry.title);
  onEvent({
    type: 'parsed',
    title: input.title,
    tags: input.tags ?? [],
    sections: input.doc?.filter((block) => block.type === 'heading').length ?? 0,
  });
  return input;
}
