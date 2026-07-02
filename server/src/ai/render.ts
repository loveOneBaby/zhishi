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

function cleanLines(value: string): string[] {
  return value.split('\n').map((line) => line.trimEnd()).filter((line) => line.trim());
}

function fallbackFlowchart(title: string, steps: string[]): string {
  const mainSteps = steps.map((step) => step.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 4);
  const chain = ['拿到问题', '先给结论', ...(mainSteps.length ? mainSteps : ['展开机制', '补工程边界']), '应对追问'];
  return chain.map((step, index) => `${index === 0 ? '' : '\n    |\n    v\n'}[${step}]`).join('');
}

function qaLines(items: string[]): string[] {
  const lines: string[] = [];
  for (const item of items) {
    const raw = item.trim();
    if (!raw) continue;
    if (/^Q\s*[:：]/i.test(raw)) {
      lines.push(...cleanLines(raw), '');
      continue;
    }
    const match = /^(.+?[?？])\s*(?:答题抓手\s*[:：])?\s*(.+)$/.exec(raw);
    if (match) {
      lines.push(`Q: ${match[1].trim()}`, `A: ${match[2].trim()}`, '');
    } else {
      lines.push(`Q: ${raw}`, 'A: 先给结论，再结合原理、场景和边界说明。', '');
    }
  }
  return lines;
}

export function draftToMarkdown(draft: GeneratedDraft): string {
  const lines: string[] = [];
  lines.push('## 简要回答', draft.answerTemplate || draft.summary || `我一般会先围绕「${draft.title}」给结论，再补核心机制和工程边界。`, '');
  lines.push(
    '## 回答思路步骤图',
    '```text',
    draft.flowchart || fallbackFlowchart(draft.title, draft.sections.map((section) => section.title)),
    '```',
    '',
  );
  lines.push('## 详解');
  for (const section of draft.sections) {
    if (section.title) lines.push(`### ${section.title}`);
    if (section.content) lines.push(section.content);
    lines.push(...bulletLines(section.bullets), '');
  }
  if (draft.interviewPoints.length) {
    lines.push('### 面试抓手', ...bulletLines(draft.interviewPoints), '');
  }
  if (draft.pitfalls.length) {
    lines.push('### 易错点', ...bulletLines(draft.pitfalls), '');
  }
  if (!draft.sections.length && !draft.interviewPoints.length) {
    lines.push('### 核心知识', draft.summary, '', '### 面试抓手', '- 定义、原理、应用场景和工程边界。', '');
  }
  if (draft.commonQuestions.length) {
    lines.push('## 可能追问', ...qaLines(draft.commonQuestions));
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function kbQuestionToMarkdown(question: GeneratedKbQuestion): string {
  const lines: string[] = [];
  lines.push('## 简要回答', question.answerTemplate || question.shortAnswer || question.summary || '我一般会先给结论，再补充原理、场景和边界。', '');
  lines.push(
    '## 回答思路步骤图',
    '```text',
    question.flowchart || fallbackFlowchart(question.title, question.keyPoints),
    '```',
    '',
  );
  lines.push('## 详解');
  lines.push('### 面试题', question.question, '');
  if (question.answer && question.answer !== question.shortAnswer) {
    lines.push('### 展开理解', question.answer, '');
  }
  if (question.keyPoints.length) {
    lines.push('### 关键知识点', ...bulletLines(question.keyPoints), '');
  }
  if (question.pitfalls.length) {
    lines.push('### 易错点', ...bulletLines(question.pitfalls), '');
  }
  if (!question.keyPoints.length && !question.answer) {
    lines.push('### 回答抓手', '- 定义是什么', '- 为什么这样设计', '- 工程里如何使用', '- 有什么边界和坑', '');
  }
  if (question.followUps.length) {
    lines.push('## 可能追问', ...qaLines(question.followUps));
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
