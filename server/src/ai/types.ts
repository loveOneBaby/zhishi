import type { Block, Entry } from '../types.js';

interface GeneratedSection {
  title: string;
  content: string;
  bullets: string[];
}

// 生成草稿:AI 返回 JSON 的中间结构,渲染层与解析层共用
export interface GeneratedDraft {
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
  sourceId?: string;
  parentSourceId?: string | null;
  sort?: number;
}

export interface GeneratedSourceRef {
  title: string;
  url: string;
}

export interface GeneratedKbQuestion {
  folderPath: string[];
  containerSourceId?: string;
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
  doc?: Block[];
  sourceRefs?: GeneratedSourceRef[];
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
  signal?: AbortSignal;
}

export interface GenerateKnowledgeBaseOptions {
  domain: string;
  questionCount?: number;
  signal?: AbortSignal;
}

export interface GenerateFolderTreeOptions {
  domain: string;
  kbName: string;
  targetPath?: string;
  existingFolders?: string[];
  folderCount?: number;
  compact?: boolean;
  signal?: AbortSignal;
}

export interface RewriteEntryOptions {
  entry: Entry;
  /** 可选的改写重点指令(来自 AI 分析建议),会引导本次改写优先满足该项改进 */
  instruction?: string;
  signal?: AbortSignal;
}

// 单次 AI 调用的 token 消耗(与 ai-client.TokenUsage 同构，独立定义避免 types ↔ ai-client 循环依赖)
export interface AiTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export type GenerateEntryEvent =
  | { type: 'stage'; message: string }
  | { type: 'context'; items: Array<{ title: string; summary: string }> }
  | { type: 'model-delta'; content: string }
  | { type: 'model-output'; content: string }
  | { type: 'parsed'; title: string; tags: string[]; sections: number }
  | { type: 'image-stage'; message: string }
  | { type: 'image'; url: string; assetId: string; caption: string; prompt: string }
  | { type: 'usage'; usage: AiTokenUsage };

export type GenerateKnowledgeBaseEvent =
  | { type: 'stage'; message: string }
  | { type: 'model-delta'; content: string }
  | { type: 'model-output'; content: string }
  | { type: 'parsed-kb'; kbName: string; folders: number; questions: number }
  | { type: 'usage'; usage: AiTokenUsage };

export type GenerateFolderTreeEvent =
  | { type: 'stage'; message: string }
  | { type: 'model-delta'; content: string }
  | { type: 'model-output'; content: string }
  | { type: 'parsed-folders'; title: string; folders: number }
  | { type: 'usage'; usage: AiTokenUsage };
