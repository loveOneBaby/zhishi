import { chatCompletion, chatCompletionStream } from './ai-client.js';
import type { EntryInput } from './db.js';
import type {
  GenerateEntryEvent,
  GenerateEntryOptions,
  GenerateFolderTreeEvent,
  GenerateFolderTreeOptions,
  GenerateKnowledgeBaseEvent,
  GenerateKnowledgeBaseOptions,
  GeneratedFolderTreeDraft,
  GeneratedKbDraft,
  RewriteEntryOptions,
} from './ai/types.js';
import {
  buildGenerateFolderTreeMessages,
  buildGenerateKnowledgeBaseMessages,
  buildGenerateMessages,
  buildRewriteMessages,
} from './ai/prompts.js';
import {
  entryInputFromModelOutput,
  folderTreeDraftFromModelOutput,
  kbDraftFromModelOutput,
} from './ai/parse.js';

// 向后兼容:app.ts / server.test.ts 仍从 './ai-generate.js' 引用,保持公开 API 形状不变
export type {
  GeneratedKbFolder,
  GeneratedKbQuestion,
  GeneratedKbDraft,
  GeneratedFolderTreeDraft,
  GenerateEntryOptions,
  GenerateKnowledgeBaseOptions,
  GenerateFolderTreeOptions,
  RewriteEntryOptions,
  GenerateEntryEvent,
  GenerateKnowledgeBaseEvent,
  GenerateFolderTreeEvent,
} from './ai/types.js';
export {
  extractJsonObject,
  coerceGeneratedDraft,
  coerceGeneratedKbDraft,
  coerceGeneratedFolderTreeDraft,
} from './ai/parse.js';
export { draftToMarkdown, kbQuestionToMarkdown, kbQuestionToEntryInput } from './ai/render.js';

const ENTRY_JSON_SCHEMA = '{"title":"知识点标题","summary":"一句话摘要","tags":["标签"],"sections":[{"title":"小节标题","content":"正文","bullets":["要点"]}],"interviewPoints":["面试考点"],"commonQuestions":["常见追问"],"pitfalls":["易错点"],"answerTemplate":"可直接用于面试回答的模板"}';
const KB_JSON_SCHEMA = '{"kbName":"知识库名称","description":"一句话说明","containers":[{"sourceId":"folder_unique_id","kind":"folder","parentSourceId":null,"name":"目录名","sort":1}],"entries":[{"sourceId":"entry_unique_id","containerSourceId":"folder_unique_id","title":"知识点标题","question":"面试题","summary":"一句话摘要","tags":["标签"],"shortAnswer":"30-80字直接回答","answer":"展开回答","keyPoints":["关键点"],"followUps":["常见追问"],"pitfalls":["易错点"],"answerTemplate":"可直接复述的回答模板"}]}';
const FOLDER_JSON_SCHEMA = '{"title":"目录方案名称","description":"一句话说明","folders":[{"path":["一级目录","二级目录"]}]}';

async function repairModelJson(raw: string, schema: string, signal?: AbortSignal): Promise<string> {
  const content = await chatCompletion([
    {
      role: 'system',
      content: '你是 JSON 修复器。只修复用户给出的模型输出为合法 JSON，不补充新事实，不解释，不输出 Markdown 代码围栏。',
    },
    {
      role: 'user',
      content: [
        '把下面内容修复成一个合法 JSON 对象。',
        `目标字段结构：${schema}`,
        '要求：只输出 JSON 对象本身，不要任何说明。',
        '原始输出：',
        raw.slice(0, 30000),
      ].join('\n'),
    },
  ], { temperature: 0, signal });
  return `---JSON---\n${content}`;
}

async function parseWithRepair<T>(
  raw: string,
  schema: string,
  parse: (value: string) => T,
  onRepair: () => void,
  signal?: AbortSignal,
): Promise<T> {
  try {
    return parse(raw);
  } catch {
    onRepair();
    const repaired = await repairModelJson(raw, schema, signal);
    return parse(repaired);
  }
}

export async function generateEntryInput(options: GenerateEntryOptions): Promise<EntryInput> {
  const raw = await chatCompletion(buildGenerateMessages(options), { signal: options.signal });
  return parseWithRepair(raw, ENTRY_JSON_SCHEMA, (value) => entryInputFromModelOutput(value, options.topic), () => {}, options.signal);
}

export async function generateKnowledgeBaseDraftStream(
  options: GenerateKnowledgeBaseOptions,
  onEvent: (event: GenerateKnowledgeBaseEvent) => void,
): Promise<GeneratedKbDraft> {
  onEvent({ type: 'stage', message: '开始规划知识库目录和高频题' });
  const raw = await chatCompletionStream(buildGenerateKnowledgeBaseMessages(options), { signal: options.signal }, (content) => {
    onEvent({ type: 'model-delta', content });
  });
  onEvent({ type: 'model-output', content: raw });
  onEvent({ type: 'stage', message: 'Qwen 输出完成，开始解析知识库结构' });
  const draft = await parseWithRepair(
    raw,
    KB_JSON_SCHEMA,
    (value) => kbDraftFromModelOutput(value, options.domain),
    () => onEvent({ type: 'stage', message: '结构化 JSON 解析失败，正在自动修复' }),
    options.signal,
  );
  onEvent({
    type: 'parsed-kb',
    kbName: draft.kbName,
    folders: draft.folders.length,
    questions: draft.questions.length,
  });
  return draft;
}

export async function generateFolderTreeDraftStream(
  options: GenerateFolderTreeOptions,
  onEvent: (event: GenerateFolderTreeEvent) => void,
): Promise<GeneratedFolderTreeDraft> {
  onEvent({ type: 'stage', message: '开始规划知识库文件目录' });
  const raw = await chatCompletionStream(buildGenerateFolderTreeMessages(options), { signal: options.signal }, (content) => {
    onEvent({ type: 'model-delta', content });
  });
  onEvent({ type: 'model-output', content: raw });
  onEvent({ type: 'stage', message: 'Qwen 输出完成，开始解析目录结构' });
  const draft = await parseWithRepair(
    raw,
    FOLDER_JSON_SCHEMA,
    (value) => folderTreeDraftFromModelOutput(value, options.domain),
    () => onEvent({ type: 'stage', message: '目录 JSON 解析失败，正在自动修复' }),
    options.signal,
  );
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
  const raw = await chatCompletionStream(buildGenerateMessages(options), { signal: options.signal }, (content) => {
    onEvent({ type: 'model-delta', content });
  });
  onEvent({ type: 'model-output', content: raw });
  onEvent({ type: 'stage', message: 'Qwen 输出完成，开始解析结构' });
  const input = await parseWithRepair(
    raw,
    ENTRY_JSON_SCHEMA,
    (value) => entryInputFromModelOutput(value, options.topic),
    () => onEvent({ type: 'stage', message: '结构化 JSON 解析失败，正在自动修复' }),
    options.signal,
  );
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
  const raw = await chatCompletionStream(buildRewriteMessages(options), { signal: options.signal }, (content) => {
    onEvent({ type: 'model-delta', content });
  });
  onEvent({ type: 'model-output', content: raw });
  onEvent({ type: 'stage', message: 'Qwen 输出完成，开始解析改写结果' });
  const input = await parseWithRepair(
    raw,
    ENTRY_JSON_SCHEMA,
    (value) => entryInputFromModelOutput(value, entry.title),
    () => onEvent({ type: 'stage', message: '改写 JSON 解析失败，正在自动修复' }),
    options.signal,
  );
  onEvent({
    type: 'parsed',
    title: input.title,
    tags: input.tags ?? [],
    sections: input.doc?.filter((block) => block.type === 'heading').length ?? 0,
  });
  return input;
}
