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

export async function generateEntryInput(options: GenerateEntryOptions): Promise<EntryInput> {
  const raw = await chatCompletion(buildGenerateMessages(options));
  return entryInputFromModelOutput(raw, options.topic);
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
