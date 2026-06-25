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

export interface GeneratedKbFolder {
  path: string[];
}

export interface GeneratedKbQuestion {
  folderPath: string[];
  title: string;
  question: string;
  summary: string;
  tags: string[];
  shortAnswer: string;
  answer: string;
  keyPoints: string[];
  followUps: string[];
  pitfalls: string[];
  answerTemplate: string;
}

export interface GeneratedKbDraft {
  kbName: string;
  description: string;
  folders: GeneratedKbFolder[];
  questions: GeneratedKbQuestion[];
}

export interface GeneratedFolderTreeDraft {
  title: string;
  description: string;
  folders: GeneratedKbFolder[];
}

export interface GenerateEntryOptions {
  topic: string;
  kbName: string;
  folderPath?: string;
  context?: Entry[];
}

export interface GenerateKnowledgeBaseOptions {
  domain: string;
  questionCount?: number;
}

export interface GenerateFolderTreeOptions {
  domain: string;
  kbName: string;
  targetPath?: string;
  existingFolders?: string[];
  folderCount?: number;
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

export type GenerateKnowledgeBaseEvent =
  | { type: 'stage'; message: string }
  | { type: 'model-delta'; content: string }
  | { type: 'model-output'; content: string }
  | { type: 'parsed-kb'; kbName: string; folders: number; questions: number };

export type GenerateFolderTreeEvent =
  | { type: 'stage'; message: string }
  | { type: 'model-delta'; content: string }
  | { type: 'model-output'; content: string }
  | { type: 'parsed-folders'; title: string; folders: number };

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

function cleanPathPart(value: string): string {
  return value
    .replace(/[\\>#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 32);
}

function pathArray(value: unknown, limit = 3): string[] {
  const raw = Array.isArray(value)
    ? value
    : (typeof value === 'string' ? value.split(/[/>｜|]/) : []);
  const out: string[] = [];
  for (const item of raw) {
    const next = cleanPathPart(String(item ?? ''));
    if (next && !out.includes(next)) out.push(next);
    if (out.length >= limit) break;
  }
  return out;
}

function collectFolderPaths(value: unknown, parent: string[] = [], out: GeneratedKbFolder[] = []): GeneratedKbFolder[] {
  if (!Array.isArray(value)) return out;
  for (const raw of value) {
    const item = asRecord(raw);
    const ownPath = pathArray(item.path);
    const name = cleanPathPart(text(item.name) || text(item.title));
    const path = ownPath.length ? ownPath : (name ? [...parent, name] : parent);
    if (path.length) out.push({ path });
    collectFolderPaths(item.children, path, out);
  }
  return out;
}

function uniqueFolderPaths(folders: GeneratedKbFolder[]): GeneratedKbFolder[] {
  const seen = new Set<string>();
  const out: GeneratedKbFolder[] = [];
  for (const folder of folders) {
    const path = folder.path.map(cleanPathPart).filter(Boolean).slice(0, 3);
    const key = path.join('/');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ path });
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

export function coerceGeneratedKbDraft(raw: unknown, domain: string): GeneratedKbDraft {
  const obj = asRecord(raw);
  const kbName = text(obj.kbName) || text(obj.title) || `${domain}面试知识库`;
  const description = text(obj.description, `围绕「${domain}」整理高频面试题、核心知识点和回答模板。`);
  const rawQuestions = Array.isArray(obj.questions)
    ? obj.questions
    : (Array.isArray(obj.entries) ? obj.entries : (Array.isArray(obj.items) ? obj.items : []));

  const questions = rawQuestions.map((question, index) => {
    const item = asRecord(question);
    const folderPath = pathArray(item.folderPath).length
      ? pathArray(item.folderPath)
      : pathArray(item.folder ?? item.category ?? item.directory);
    const q = text(item.question) || text(item.title) || `${domain} 高频面试题 ${index + 1}`;
    const title = text(item.title) || q.replace(/[?？]\s*$/, '');
    const answer = text(item.answer) || text(item.detail) || text(item.content);
    return {
      folderPath,
      title,
      question: q,
      summary: text(item.summary, `围绕「${q}」梳理面试回答、关键点和常见追问。`),
      tags: textArray(item.tags, 8),
      shortAnswer: text(item.shortAnswer) || text(item.briefAnswer),
      answer,
      keyPoints: textArray(item.keyPoints, 10),
      followUps: textArray(item.followUps, 8),
      pitfalls: textArray(item.pitfalls, 8),
      answerTemplate: text(item.answerTemplate) || text(item.template),
    };
  }).filter((item) => item.title || item.question).slice(0, 24);

  const folders = uniqueFolderPaths([
    ...collectFolderPaths(obj.folders),
    ...questions.filter((question) => question.folderPath.length).map((question) => ({ path: question.folderPath })),
  ]);

  return {
    kbName,
    description,
    folders,
    questions,
  };
}

export function coerceGeneratedFolderTreeDraft(raw: unknown, domain: string): GeneratedFolderTreeDraft {
  const obj = asRecord(raw);
  const sourceFolders = Array.isArray(raw)
    ? raw
    : (Array.isArray(obj.folders)
      ? obj.folders
      : (Array.isArray(obj.directories)
        ? obj.directories
        : (Array.isArray(obj.containers) ? obj.containers : [])));
  const folders = uniqueFolderPaths(collectFolderPaths(sourceFolders));
  return {
    title: text(obj.title) || text(obj.name) || `${domain}目录`,
    description: text(obj.description, `围绕「${domain}」初始化知识库目录。`),
    folders,
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

export function kbQuestionToMarkdown(question: GeneratedKbQuestion): string {
  const lines: string[] = [
    question.summary,
    '',
    '## Q',
    question.question,
    '',
    '## A',
    question.shortAnswer || question.answer || '先给结论，再补充原理、场景和边界。',
    '',
  ];
  if (question.answer && question.answer !== question.shortAnswer) {
    lines.push('## 展开回答', question.answer, '');
  }
  if (question.answerTemplate) {
    lines.push('## 面试表达模板', question.answerTemplate, '');
  }
  if (question.keyPoints.length) {
    lines.push('## 关键知识点', ...bulletLines(question.keyPoints), '');
  }
  if (question.followUps.length) {
    lines.push('## 高频追问', ...bulletLines(question.followUps), '');
  }
  if (question.pitfalls.length) {
    lines.push('## 易错点', ...bulletLines(question.pitfalls), '');
  }
  if (!question.keyPoints.length && !question.answer) {
    lines.push('## 回答抓手', '- 定义是什么', '- 为什么这样设计', '- 工程里如何使用', '- 有什么边界和坑', '');
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function kbQuestionToEntryInput(question: GeneratedKbQuestion, domain: string): EntryInput {
  return {
    title: question.title,
    tags: ensureTags(question.tags, domain),
    summary: question.summary,
    doc: markdownToDocBlocks(kbQuestionToMarkdown(question)),
  };
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

function buildGenerateKnowledgeBaseMessages(options: GenerateKnowledgeBaseOptions): AiMessage[] {
  const { domain } = options;
  const questionCount = Math.min(24, Math.max(8, Math.floor(options.questionCount ?? 14)));
  const prompt = [
    `请为「${domain}」创建一套工程面试知识库。`,
    '输出必须分两段：',
    '1）先输出“建库思路”，用 4-8 条短 bullet 说明目录如何划分、哪些问题是高频、回答如何组织。这里是可公开说明，不要输出隐藏推理链路。',
    '2）然后输出一行 ---JSON---，后面只放一个 JSON 对象，不要 Markdown 代码围栏。',
    'JSON 字段必须是：',
    '{"kbName":"知识库名称","description":"一句话说明","folders":[{"path":["一级目录","二级目录"]}],"questions":[{"folderPath":["一级目录","二级目录"],"title":"知识点标题","question":"面试题","summary":"一句话摘要","tags":["标签"],"shortAnswer":"30-80字直接回答","answer":"展开回答","keyPoints":["关键点"],"followUps":["常见追问"],"pitfalls":["易错点"],"answerTemplate":"可直接复述的回答模板"}]}',
    `要求：中文；questions 生成 ${questionCount} 道高频题；目录 4-7 个、最多二级；每道题必须是 Q&A 形式；覆盖定义、原理、实现、场景、性能、排障、对比、项目表达；避免空话和营销话术；标题适合作为知识点列表展示，不要全部以“什么是”开头。`,
  ].join('\n');

  return [
    { role: 'system', content: '你是资深技术面试官和知识库架构师，擅长把一个技术领域整理成目录清晰、问题高频、回答可复述的面试知识库。可以输出可公开的建库说明，但不要泄露隐藏推理链路。' },
    { role: 'user', content: prompt },
  ];
}

function buildGenerateFolderTreeMessages(options: GenerateFolderTreeOptions): AiMessage[] {
  const { domain, kbName, targetPath, existingFolders = [] } = options;
  const folderCount = Math.min(36, Math.max(8, Math.floor(options.folderCount ?? 18)));
  const existing = existingFolders.slice(0, 80).map((folder) => `- ${folder}`).join('\n') || '（暂无）';
  const prompt = [
    `请为「${kbName}」知识库初始化「${domain}」相关文件目录。`,
    '只生成目录，不要生成知识点、题目、正文或答案。',
    '输出必须分两段：',
    '1）先输出“目录规划”，用 4-7 条短 bullet 说明目录分层逻辑、覆盖哪些面试复习维度。这里是可公开说明，不要输出隐藏推理链路。',
    '2）然后输出一行 ---JSON---，后面只放一个 JSON 对象，不要 Markdown 代码围栏。',
    'JSON 字段必须是：',
    '{"title":"目录方案名称","description":"一句话说明","folders":[{"path":["一级目录","二级目录"]}]}',
    `要求：中文；生成约 ${folderCount} 个目录路径；最多 3 层；目录名短、稳定、适合长期维护；覆盖基础概念、核心原理、架构组件、工程实践、性能优化、故障排查、对比选型、项目表达；避免与已有目录重复；path 是相对目标位置的路径。`,
    `目标位置：${targetPath || '知识库根层级'}`,
    '已有目录：',
    existing,
  ].join('\n');

  return [
    { role: 'system', content: '你是资深技术面试知识库架构师，擅长为一个技术领域设计清晰、可扩展、便于复习和检索的文件目录。可以输出可公开的目录规划说明，但不要泄露隐藏推理链路。' },
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

function kbDraftFromModelOutput(raw: string, domain: string): GeneratedKbDraft {
  const marker = raw.indexOf('---JSON---');
  const json = extractJsonObject(marker >= 0 ? raw.slice(marker + '---JSON---'.length) : raw);
  if (!json) throw new Error('AI 返回内容不是有效知识库 JSON');
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('AI 返回知识库 JSON 解析失败');
  }
  const draft = coerceGeneratedKbDraft(parsed, domain);
  if (!draft.questions.length) throw new Error('AI 未返回可创建的面试题');
  return draft;
}

export async function generateKnowledgeBaseDraftStream(
  options: GenerateKnowledgeBaseOptions,
  onEvent: (event: GenerateKnowledgeBaseEvent) => void,
): Promise<GeneratedKbDraft> {
  onEvent({ type: 'stage', message: '开始规划知识库目录和高频题' });
  const raw = await chatCompletionStream(buildGenerateKnowledgeBaseMessages(options), {}, (content) => {
    onEvent({ type: 'model-delta', content });
  });
  onEvent({ type: 'model-output', content: raw });
  onEvent({ type: 'stage', message: 'Qwen 输出完成，开始解析知识库结构' });
  const draft = kbDraftFromModelOutput(raw, options.domain);
  onEvent({
    type: 'parsed-kb',
    kbName: draft.kbName,
    folders: draft.folders.length,
    questions: draft.questions.length,
  });
  return draft;
}

function folderTreeDraftFromModelOutput(raw: string, domain: string): GeneratedFolderTreeDraft {
  const marker = raw.indexOf('---JSON---');
  const json = extractJsonObject(marker >= 0 ? raw.slice(marker + '---JSON---'.length) : raw);
  if (!json) throw new Error('AI 返回内容不是有效目录 JSON');
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('AI 返回目录 JSON 解析失败');
  }
  const draft = coerceGeneratedFolderTreeDraft(parsed, domain);
  if (!draft.folders.length) throw new Error('AI 未返回可创建的目录');
  return draft;
}

export async function generateFolderTreeDraftStream(
  options: GenerateFolderTreeOptions,
  onEvent: (event: GenerateFolderTreeEvent) => void,
): Promise<GeneratedFolderTreeDraft> {
  onEvent({ type: 'stage', message: '开始规划知识库文件目录' });
  const raw = await chatCompletionStream(buildGenerateFolderTreeMessages(options), {}, (content) => {
    onEvent({ type: 'model-delta', content });
  });
  onEvent({ type: 'model-output', content: raw });
  onEvent({ type: 'stage', message: 'Qwen 输出完成，开始解析目录结构' });
  const draft = folderTreeDraftFromModelOutput(raw, options.domain);
  onEvent({
    type: 'parsed-folders',
    title: draft.title,
    folders: draft.folders.length,
  });
  return draft;
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
