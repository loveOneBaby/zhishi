import { markdownToDocBlocks, normalizeDocBlocks } from '../doc.js';
import type { EntryInput } from '../db.js';
import type { GeneratedDraft, GeneratedKbQuestion } from './types.js';

export function ensureTags(tags: string[], topic: string): string[] {
  const normalizeTag = (value: string): string => value
    .replace(/^#+/, '')
    .replace(/[，,;；|｜/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);
  const out: string[] = [];
  for (const tag of [topic, ...tags, 'AI生成']) {
    const next = normalizeTag(tag);
    if (next && !out.some((item) => item.toLowerCase() === next.toLowerCase())) out.push(next);
    if (out.length >= 8) break;
  }
  if (!out.some((item) => item.toLowerCase() === 'ai生成'.toLowerCase())) {
    out[out.length >= 8 ? out.length - 1 : out.length] = 'AI生成';
  }
  return out;
}

export function bulletLines(items: string[]): string[] {
  return items.map((item) => `- ${item}`);
}

export function draftToMarkdown(draft: GeneratedDraft): string {
  const lines: string[] = [];
  if (draft.summary) {
    lines.push('## 一句话结论', draft.summary, '');
  }
  if (draft.answerTemplate) {
    lines.push('## 30 秒面试回答', draft.answerTemplate, '');
  }
  for (const section of draft.sections) {
    if (section.title) lines.push(`## ${section.title}`);
    if (section.content) lines.push(section.content);
    lines.push(...bulletLines(section.bullets), '');
  }
  if (draft.interviewPoints.length) {
    lines.push('## 面试考点', ...bulletLines(draft.interviewPoints), '');
  }
  if (draft.commonQuestions.length) {
    lines.push('## 高频追问（带答题抓手）', ...bulletLines(draft.commonQuestions), '');
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
  const lines: string[] = [];
  lines.push('## 一句话结论', question.shortAnswer || question.summary || '先给结论，再补充原理、场景和边界。', '');
  if (question.answerTemplate) {
    lines.push('## 30 秒面试回答', question.answerTemplate, '');
  }
  lines.push('## 面试题', question.question, '');
  if (question.answer && question.answer !== question.shortAnswer) {
    lines.push('## 展开理解', question.answer, '');
  }
  if (question.keyPoints.length) {
    lines.push('## 关键知识点', ...bulletLines(question.keyPoints), '');
  }
  if (question.followUps.length) {
    lines.push('## 高频追问（带答题抓手）', ...bulletLines(question.followUps), '');
  }
  if (question.pitfalls.length) {
    lines.push('## 易错点', ...bulletLines(question.pitfalls), '');
  }
  if (!question.keyPoints.length && !question.answer) {
    lines.push('## 回答抓手', '- 定义是什么', '- 为什么这样设计', '- 工程里如何使用', '- 有什么边界和坑', '');
  }
  if (question.sourceRefs?.length) {
    lines.push('## 参考链接', ...question.sourceRefs.map((ref) => ref.url ? `- ${ref.title}: ${ref.url}` : `- ${ref.title}`), '');
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function kbQuestionToEntryInput(question: GeneratedKbQuestion, domain: string): EntryInput {
  const sourceRefBlocks = question.sourceRefs?.length
    ? markdownToDocBlocks(['## 参考链接', ...question.sourceRefs.map((ref) => ref.url ? `- ${ref.title}: ${ref.url}` : `- ${ref.title}`)].join('\n'))
    : [];
  return {
    title: question.title,
    tags: ensureTags(question.tags, domain),
    summary: question.summary,
    doc: question.doc?.length
      ? [...normalizeDocBlocks(question.doc), ...sourceRefBlocks]
      : markdownToDocBlocks(kbQuestionToMarkdown(question)),
  };
}
