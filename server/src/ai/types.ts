import type { Entry } from '../types.js';

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
