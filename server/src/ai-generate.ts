import { chatCompletion, chatCompletionStream, type AiMessage, type TokenUsage } from './ai-client.js';
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
  buildPlanKnowledgeBaseMessages,
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
const JSON_REPAIR_ATTEMPTS = 2;
const JSON_GENERATE_ATTEMPTS = 2;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isGeneratedJsonError(error: unknown): boolean {
  return /JSON|解析|未返回|不是有效|可创建/i.test(errorMessage(error));
}

function retryInstruction(error: unknown): AiMessage {
  return {
    role: 'user',
    content: [
      `上一次输出无法解析：${errorMessage(error)}`,
      '请重新输出，并严格遵守：',
      '1. 必须先写简短说明，然后输出单独一行 ---JSON---。',
      '2. ---JSON--- 后只能放一个完整 JSON 对象，不要 Markdown 代码围栏，不要尾随解释。',
      '3. JSON 必须包含目标字段结构中的所有必要数组字段；数组为空会导致任务失败。',
      '4. 不要把多个 JSON 对象、列表项或注释混在一起。',
    ].join('\n'),
  };
}

async function repairModelJson(raw: string, schema: string, lastError?: unknown, signal?: AbortSignal, onUsage?: (usage: TokenUsage) => void): Promise<string> {
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
        lastError ? `上一次解析错误：${errorMessage(lastError)}` : '',
        '必须补齐目标字段中的必要数组字段；如果原文有等价字段，请映射到目标字段名。',
        '要求：只输出 JSON 对象本身，不要任何说明。',
        '原始输出：',
        raw.slice(0, 30000),
      ].filter(Boolean).join('\n'),
    },
  ], { temperature: 0, signal }, onUsage);
  return `---JSON---\n${content}`;
}

async function parseWithRepair<T>(
  raw: string,
  schema: string,
  parse: (value: string) => T,
  onRepair: (attempt: number, total: number, error: unknown) => void,
  signal?: AbortSignal,
  onUsage?: (usage: TokenUsage) => void,
): Promise<T> {
  let current = raw;
  let lastError: unknown;
  for (let attempt = 0; attempt <= JSON_REPAIR_ATTEMPTS; attempt += 1) {
    try {
      return parse(current);
    } catch (err) {
      lastError = err;
      if (attempt >= JSON_REPAIR_ATTEMPTS) throw err;
      onRepair(attempt + 1, JSON_REPAIR_ATTEMPTS, err);
      current = await repairModelJson(current, schema, err, signal, onUsage);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

type JsonStreamEvent =
  | { type: 'stage'; message: string }
  | { type: 'model-delta'; content: string }
  | { type: 'model-output'; content: string }
  | { type: 'usage'; usage: TokenUsage };

async function streamAndParseWithRetry<T>(input: {
  startMessage: string;
  parseMessage: string;
  retryMessage: (attempt: number, total: number, error: unknown) => string;
  repairMessage: (attempt: number, total: number, error: unknown) => string;
  messages: (attempt: number, lastError: unknown | null) => AiMessage[];
  schema: string;
  parse: (raw: string) => T;
  signal?: AbortSignal;
  onEvent: (event: JsonStreamEvent) => void;
}): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= JSON_GENERATE_ATTEMPTS; attempt += 1) {
    input.onEvent({
      type: 'stage',
      message: attempt === 1 ? input.startMessage : input.retryMessage(attempt, JSON_GENERATE_ATTEMPTS, lastError),
    });
    const raw = await chatCompletionStream(
      input.messages(attempt, lastError),
      { signal: input.signal, temperature: attempt === 1 ? undefined : 0.1 },
      (content) => input.onEvent({ type: 'model-delta', content }),
      (usage) => input.onEvent({ type: 'usage', usage }),
    );
    input.onEvent({ type: 'model-output', content: raw });
    input.onEvent({ type: 'stage', message: input.parseMessage });
    try {
      return await parseWithRepair(
        raw,
        input.schema,
        input.parse,
        (repairAttempt, repairTotal, error) => input.onEvent({
          type: 'stage',
          message: input.repairMessage(repairAttempt, repairTotal, error),
        }),
        input.signal,
        (usage) => input.onEvent({ type: 'usage', usage }),
      );
    } catch (err) {
      lastError = err;
      if (attempt >= JSON_GENERATE_ATTEMPTS || !isGeneratedJsonError(err)) throw err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function generateEntryInput(options: GenerateEntryOptions, onUsage?: (usage: TokenUsage) => void): Promise<EntryInput> {
  const raw = await chatCompletion(buildGenerateMessages(options), { signal: options.signal }, onUsage);
  return parseWithRepair(raw, ENTRY_JSON_SCHEMA, (value) => entryInputFromModelOutput(value, options.topic), () => {}, options.signal, onUsage);
}

export async function generateKnowledgeBaseDraftStream(
  options: GenerateKnowledgeBaseOptions,
  onEvent: (event: GenerateKnowledgeBaseEvent) => void,
): Promise<GeneratedKbDraft> {
  const draft = await streamAndParseWithRetry({
    startMessage: '开始规划知识库目录和高频题',
    parseMessage: 'Qwen 输出完成，开始解析知识库结构',
    retryMessage: (attempt, total, error) => `知识库 JSON 解析仍失败，重新生成规划 ${attempt}/${total}：${errorMessage(error)}`,
    repairMessage: (attempt, total, error) => `结构化 JSON 解析失败，正在自动修复 ${attempt}/${total}：${errorMessage(error)}`,
    messages: (attempt, lastError) => {
      const messages = buildGenerateKnowledgeBaseMessages(options);
      return attempt === 1 || !lastError ? messages : [...messages, retryInstruction(lastError)];
    },
    schema: KB_JSON_SCHEMA,
    parse: (value) => kbDraftFromModelOutput(value, options.domain),
    signal: options.signal,
    onEvent,
  });
  onEvent({
    type: 'parsed-kb',
    kbName: draft.kbName,
    folders: draft.folders.length,
    questions: draft.questions.length,
  });
  return draft;
}

export async function generateKnowledgeBasePlanStream(
  options: GenerateKnowledgeBaseOptions,
  onEvent: (event: GenerateKnowledgeBaseEvent) => void,
): Promise<GeneratedKbDraft> {
  const draft = await streamAndParseWithRetry({
    startMessage: 'Agent 第 1 步：规划目录树和知识点清单',
    parseMessage: '规划输出完成，开始解析目录与挂载关系',
    retryMessage: (attempt, total, error) => `规划 JSON 解析仍失败，重新生成规划 ${attempt}/${total}：${errorMessage(error)}`,
    repairMessage: (attempt, total, error) => `规划 JSON 解析失败，正在自动修复 ${attempt}/${total}：${errorMessage(error)}`,
    messages: (attempt, lastError) => {
      const messages = buildPlanKnowledgeBaseMessages(options);
      return attempt === 1 || !lastError ? messages : [...messages, retryInstruction(lastError)];
    },
    schema: KB_JSON_SCHEMA,
    parse: (value) => kbDraftFromModelOutput(value, options.domain),
    signal: options.signal,
    onEvent,
  });
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
  const draft = await streamAndParseWithRetry({
    startMessage: '开始规划知识库文件目录',
    parseMessage: 'Qwen 输出完成，开始解析目录结构',
    retryMessage: (attempt, total, error) => `目录 JSON 解析仍失败，重新生成目录 ${attempt}/${total}：${errorMessage(error)}`,
    repairMessage: (attempt, total, error) => `目录 JSON 解析失败，正在自动修复 ${attempt}/${total}：${errorMessage(error)}`,
    messages: (attempt, lastError) => {
      const messages = buildGenerateFolderTreeMessages(options);
      return attempt === 1 || !lastError ? messages : [...messages, retryInstruction(lastError)];
    },
    schema: FOLDER_JSON_SCHEMA,
    parse: (value) => folderTreeDraftFromModelOutput(value, options.domain),
    signal: options.signal,
    onEvent,
  });
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
  const input = await streamAndParseWithRetry({
    startMessage: '通过 LangChain 调用 Qwen 生成内容',
    parseMessage: 'Qwen 输出完成，开始解析结构',
    retryMessage: (attempt, total, error) => `知识点 JSON 解析仍失败，重新生成内容 ${attempt}/${total}：${errorMessage(error)}`,
    repairMessage: (attempt, total, error) => `结构化 JSON 解析失败，正在自动修复 ${attempt}/${total}：${errorMessage(error)}`,
    messages: (attempt, lastError) => {
      const messages = buildGenerateMessages(options);
      return attempt === 1 || !lastError ? messages : [...messages, retryInstruction(lastError)];
    },
    schema: ENTRY_JSON_SCHEMA,
    parse: (value) => entryInputFromModelOutput(value, options.topic),
    signal: options.signal,
    onEvent,
  });
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
  onEvent({ type: 'stage', message: '通过 LangChain 调用 Qwen 改写知识点' });
  const raw = await chatCompletionStream(buildRewriteMessages(options), { signal: options.signal }, (content) => {
    onEvent({ type: 'model-delta', content });
  }, (usage) => onEvent({ type: 'usage', usage }));
  onEvent({ type: 'model-output', content: raw });
  onEvent({ type: 'stage', message: 'Qwen 输出完成，开始解析改写结果' });
  const input = await parseWithRepair(
    raw,
    ENTRY_JSON_SCHEMA,
    (value) => entryInputFromModelOutput(value, entry.title),
    () => onEvent({ type: 'stage', message: '改写 JSON 解析失败，正在自动修复' }),
    options.signal,
    (usage) => onEvent({ type: 'usage', usage }),
  );
  onEvent({
    type: 'parsed',
    title: input.title,
    tags: input.tags ?? [],
    sections: input.doc?.filter((block) => block.type === 'heading').length ?? 0,
  });
  return input;
}
