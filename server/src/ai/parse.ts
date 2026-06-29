import { markdownToDocBlocks } from '../doc.js';
import type { EntryInput } from '../db.js';
import type { Block } from '../types.js';
import type { GeneratedDraft, GeneratedFolderTreeDraft, GeneratedKbDraft, GeneratedKbFolder, GeneratedSourceRef } from './types.js';
import { draftToMarkdown, ensureTags } from './render.js';

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

function numeric(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
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

function sourceId(value: unknown): string {
  return text(value).replace(/\s+/g, '_').slice(0, 80);
}

function collectFolderPaths(value: unknown, parent: string[] = [], out: GeneratedKbFolder[] = []): GeneratedKbFolder[] {
  if (!Array.isArray(value)) return out;
  for (const raw of value) {
    const item = asRecord(raw);
    const ownPath = pathArray(item.path);
    const name = cleanPathPart(text(item.name) || text(item.title));
    const path = ownPath.length ? ownPath : (name ? [...parent, name] : parent);
    if (path.length) out.push({
      path,
      sourceId: sourceId(item.sourceId ?? item.id) || undefined,
      parentSourceId: sourceId(item.parentSourceId ?? item.parentId) || undefined,
      sort: numeric(item.sort, out.length + 1),
    });
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
    out.push({ ...folder, path });
  }
  return out;
}

function collectContainerFolders(value: unknown): GeneratedKbFolder[] {
  if (!Array.isArray(value)) return [];
  const containers = value.map((raw, index) => {
    const item = asRecord(raw);
    const id = sourceId(item.sourceId ?? item.id) || `container_${index + 1}`;
    const name = cleanPathPart(text(item.name) || text(item.title));
    return name ? {
      sourceId: id,
      parentSourceId: sourceId(item.parentSourceId ?? item.parentId) || null,
      name,
      sort: numeric(item.sort, index + 1),
    } : null;
  }).filter((item): item is { sourceId: string; parentSourceId: string | null; name: string; sort: number } => Boolean(item));
  const byId = new Map(containers.map((container) => [container.sourceId, container]));
  const cache = new Map<string, string[]>();

  const resolvePath = (id: string, seen = new Set<string>()): string[] => {
    const cached = cache.get(id);
    if (cached) return cached;
    const container = byId.get(id);
    if (!container || seen.has(id)) return [];
    seen.add(id);
    const parentPath = container.parentSourceId ? resolvePath(container.parentSourceId, seen) : [];
    const path = [...parentPath, container.name].slice(0, 3);
    cache.set(id, path);
    return path;
  };

  return containers
    .sort((a, b) => a.sort - b.sort)
    .map((container) => ({
      sourceId: container.sourceId,
      parentSourceId: container.parentSourceId,
      sort: container.sort,
      path: resolvePath(container.sourceId),
    }))
    .filter((folder) => folder.path.length > 0);
}

function collectSourceRefs(value: unknown): GeneratedSourceRef[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw) => {
      const item = asRecord(raw);
      const url = text(item.url) || text(item.href);
      const title = text(item.title) || text(item.name) || url;
      return title || url ? { title, url } : null;
    })
    .filter((item): item is GeneratedSourceRef => Boolean(item));
}

function blockText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(blockText).filter(Boolean).join(' ');
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return blockText(obj.text ?? obj.content ?? obj.children ?? obj.caption ?? '');
  }
  return '';
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
          bullets: textArray(item.bullets, 12),
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
    interviewPoints: textArray(obj.interviewPoints, 14),
    commonQuestions: textArray(obj.commonQuestions, 12),
    pitfalls: textArray(obj.pitfalls, 12),
    answerTemplate: text(obj.answerTemplate),
  };
}

export function coerceGeneratedKbDraft(raw: unknown, domain: string): GeneratedKbDraft {
  const obj = asRecord(raw);
  const kbName = text(obj.kbName) || text(obj.title) || `${domain}面试知识库`;
  const description = text(obj.description, `围绕「${domain}」整理高频面试题、核心知识点和回答模板。`);
  const containerFolders = collectContainerFolders(obj.containers);
  const folderPathBySourceId = new Map(
    containerFolders
      .filter((folder) => folder.sourceId)
      .map((folder) => [folder.sourceId!, folder.path]),
  );
  const rawQuestions = Array.isArray(obj.questions)
    ? obj.questions
    : (Array.isArray(obj.entries) ? obj.entries : (Array.isArray(obj.items) ? obj.items : []));

  const questions = rawQuestions.map((question, index) => {
    const item = asRecord(question);
    const containerSourceId = sourceId(item.containerSourceId ?? item.containerId ?? item.folderSourceId);
    const containerPath = containerSourceId ? folderPathBySourceId.get(containerSourceId) ?? [] : [];
    const explicitFolderPath = pathArray(item.folderPath).length
      ? pathArray(item.folderPath)
      : pathArray(item.folder ?? item.category ?? item.directory);
    const folderPath = containerPath.length ? containerPath : explicitFolderPath;
    const q = text(item.question) || text(item.title) || `${domain} 高频面试题 ${index + 1}`;
    const title = text(item.title) || q.replace(/[?？]\s*$/, '');
    const answer = text(item.answer) || text(item.detail) || text(item.content);
    const doc = Array.isArray(item.doc) ? item.doc as Block[] : undefined;
    const docSummary = doc ? blockText(doc).slice(0, 90).trim() : '';
    return {
      folderPath,
      containerSourceId: containerSourceId || undefined,
      title,
      question: q,
      summary: text(item.summary, docSummary || `围绕「${q}」梳理面试回答、关键点和常见追问。`),
      tags: textArray(item.tags, 8),
      shortAnswer: text(item.shortAnswer) || text(item.briefAnswer),
      answer,
      keyPoints: textArray(item.keyPoints, 10),
      followUps: textArray(item.followUps, 8),
      pitfalls: textArray(item.pitfalls, 8),
      answerTemplate: text(item.answerTemplate) || text(item.template),
      doc,
      sourceRefs: collectSourceRefs(item.sourceRefs),
    };
  }).filter((item) => item.title || item.question).slice(0, 24);

  const folders = uniqueFolderPaths([
    ...containerFolders,
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
  const containerFolders = collectContainerFolders(obj.containers);
  const sourceFolders = Array.isArray(raw)
    ? raw
    : (Array.isArray(obj.folders)
      ? obj.folders
      : (Array.isArray(obj.directories)
        ? obj.directories
        : (Array.isArray(obj.containers) ? obj.containers : [])));
  const folders = uniqueFolderPaths([
    ...containerFolders,
    ...(containerFolders.length ? [] : collectFolderPaths(sourceFolders)),
  ]);
  return {
    title: text(obj.title) || text(obj.name) || `${domain}目录`,
    description: text(obj.description, `围绕「${domain}」初始化知识库目录。`),
    folders,
  };
}

export function entryInputFromModelOutput(raw: string, topic: string): EntryInput {
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

export function kbDraftFromModelOutput(raw: string, domain: string): GeneratedKbDraft {
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

export function folderTreeDraftFromModelOutput(raw: string, domain: string): GeneratedFolderTreeDraft {
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
