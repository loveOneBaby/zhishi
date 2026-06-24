import { createHash } from 'node:crypto';
import type { IndexNode } from './index-tree.js';
import type { ImportEntry, ImportFolder, ImportKb, ImportPayload } from './db.js';

interface KnowledgeTreeMeta {
  title?: unknown;
  source?: unknown;
  sourceUrl?: unknown;
  updatedAt?: unknown;
}

interface KnowledgeTreeInterview {
  question?: unknown;
  answer?: unknown;
  keyPoints?: unknown;
  pitfalls?: unknown;
  followUps?: unknown;
}

interface KnowledgeTreeContent {
  title?: unknown;
  body?: unknown;
  image?: unknown;
  images?: unknown;
}

interface KnowledgeTreeLink {
  title?: unknown;
  url?: unknown;
}

interface KnowledgeTreeNode {
  type?: unknown;
  title?: unknown;
  summary?: unknown;
  tags?: unknown;
  aliases?: unknown;
  importance?: unknown;
  cover?: unknown;
  image?: unknown;
  images?: unknown;
  interview?: KnowledgeTreeInterview | null;
  content?: unknown;
  links?: unknown;
  children?: unknown;
}

interface KnowledgeTreePayload {
  version?: unknown;
  meta?: KnowledgeTreeMeta | null;
  tree?: unknown;
  targetKbId?: unknown;
  targetKbName?: unknown;
}

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function textArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map(text).filter(Boolean) : [];
}

function unique(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function stableId(prefix: string, seed: string): string {
  return `${prefix}_${createHash('sha1').update(seed).digest('hex').slice(0, 18)}`;
}

function mdList(items: string[]): string {
  return items.map((item) => `- ${item}`).join('\n');
}

function escapeAlt(text: string): string {
  return text.replace(/]/g, '\\]').replace(/\s+/g, ' ').trim();
}

function normalizeImageSrc(src: string): string {
  const s = src.trim();
  if (!s) return '';
  // 支持远程图片、站内静态路径和 base64/data-uri。其他本地磁盘路径浏览器无法直接读取，导入时不伪装成功。
  if (/^\/(Users|var|private|tmp|home)\//i.test(s)) return '';
  if (/^(https?:\/\/|data:image\/|\/)/i.test(s)) return s.replace(/\s/g, '%20').replace(/\)/g, '%29');
  return '';
}

interface ImageRef {
  src: string;
  alt: string;
}

function imageRefs(raw: unknown, fallbackAlt = '图片'): ImageRef[] {
  if (!raw) return [];
  if (typeof raw === 'string') {
    const src = normalizeImageSrc(raw);
    return src ? [{ src, alt: fallbackAlt }] : [];
  }
  if (Array.isArray(raw)) return raw.flatMap((item) => imageRefs(item, fallbackAlt));
  const obj = (raw ?? {}) as Record<string, unknown>;
  const src = normalizeImageSrc(text(obj.url) || text(obj.src) || text(obj.dataUri) || text(obj.dataUrl));
  if (!src) return [];
  const alt = text(obj.alt) || text(obj.caption) || text(obj.title) || fallbackAlt;
  return [{ src, alt }];
}

function imageMarkdown(images: ImageRef[]): string {
  return images.map((img) => `![${escapeAlt(img.alt)}](${img.src})`).join('\n\n');
}

function indexNode(seed: string, title: string, content = '', children: IndexNode[] = []): IndexNode {
  return {
    id: stableId('ix', seed),
    title: title.trim() || '未命名索引',
    content: content.trim(),
    children,
  };
}

function contentNodes(raw: unknown, seed: string): IndexNode[] {
  if (typeof raw === 'string' && raw.trim()) {
    return [indexNode(`${seed}/content`, '知识内容', raw)];
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, index) => {
      const c = (item ?? {}) as KnowledgeTreeContent;
      const title = text(c.title) || `知识内容 ${index + 1}`;
      const body = text(c.body);
      const images = imageMarkdown([...imageRefs(c.image, title), ...imageRefs(c.images, title)]);
      const content = [body, images].filter(Boolean).join('\n\n');
      if (!title && !content) return null;
      return indexNode(`${seed}/content/${index}/${title}`, title, content);
    })
    .filter((node): node is IndexNode => Boolean(node));
}

function linkNode(raw: unknown, seed: string): IndexNode | null {
  if (!Array.isArray(raw)) return null;
  const lines = raw
    .map((item) => {
      const link = (item ?? {}) as KnowledgeTreeLink;
      const title = text(link.title);
      const url = text(link.url);
      if (!url) return title ? `- ${title}` : '';
      return `- [${title || url}](${url})`;
    })
    .filter(Boolean);
  return lines.length ? indexNode(`${seed}/links`, '参考链接', lines.join('\n')) : null;
}

function interviewNode(raw: unknown, seed: string): IndexNode | null {
  const iv = (raw ?? {}) as KnowledgeTreeInterview;
  const question = text(iv.question);
  const answer = text(iv.answer);
  const keyPoints = textArray(iv.keyPoints);
  const pitfalls = textArray(iv.pitfalls);
  const followUps = textArray(iv.followUps);
  if (!question && !answer && !keyPoints.length && !pitfalls.length && !followUps.length) return null;

  const children: IndexNode[] = [];
  if (keyPoints.length) children.push(indexNode(`${seed}/interview/keypoints`, '关键点', mdList(keyPoints)));
  if (pitfalls.length) children.push(indexNode(`${seed}/interview/pitfalls`, '易错点', mdList(pitfalls)));
  if (followUps.length) children.push(indexNode(`${seed}/interview/followups`, '常见追问', mdList(followUps)));

  const content = [
    question ? `**问题**：${question}` : '',
    answer,
  ].filter(Boolean).join('\n\n');
  return indexNode(`${seed}/interview`, '面试回答', content, children);
}

function hasKnowledgeShape(node: KnowledgeTreeNode): boolean {
  return Boolean(
    text(node.summary) ||
    textArray(node.tags).length ||
    textArray(node.aliases).length ||
    node.cover ||
    node.image ||
    node.images ||
    node.interview ||
    node.content ||
    node.links
  );
}

function toKnowledgeEntry(raw: KnowledgeTreeNode, opts: {
  kbId: string;
  kbName: string;
  folderId: string | null;
  path: string[];
  meta: KnowledgeTreeMeta;
}): ImportEntry {
  const title = text(raw.title) || '未命名知识点';
  const seed = `${opts.kbId}/${opts.path.concat(title).join('/')}`;
  const aliases = textArray(raw.aliases);
  const importance = text(raw.importance);
  const tags = unique([
    ...textArray(raw.tags),
    ...aliases,
    importance ? `重要度:${importance}` : '',
  ].filter(Boolean));

  const summary = text(raw.summary);
  const introParts = [
    summary,
    aliases.length ? `别名：${aliases.join('、')}` : '',
    text(opts.meta.sourceUrl) ? `来源：[${text(opts.meta.source) || '原文'}](${text(opts.meta.sourceUrl)})` : '',
  ].filter(Boolean);

  const nodes: IndexNode[] = [];
  const images = imageMarkdown([
    ...imageRefs(raw.cover, title),
    ...imageRefs(raw.image, title),
    ...imageRefs(raw.images, title),
  ]);
  if (images) nodes.push(indexNode(`${seed}/images`, '图片', images));
  const interview = interviewNode(raw.interview, seed);
  if (interview) nodes.push(interview);
  nodes.push(...contentNodes(raw.content, seed));
  const links = linkNode(raw.links, seed);
  if (links) nodes.push(links);
  if (!nodes.length && summary) nodes.push(indexNode(`${seed}/summary`, '核心结论', summary));

  return {
    id: stableId('ke', seed),
    cat: opts.kbName,
    kbId: opts.kbId,
    folderId: opts.folderId,
    title,
    py: title,
    tags,
    summary,
    intro: introParts.join('\n\n'),
    nodes,
  };
}

export function knowledgeTreeToImportPayload(input: unknown): ImportPayload {
  const payload = (input ?? {}) as KnowledgeTreePayload;
  if (!Array.isArray(payload.tree)) {
    throw new Error('tree 必须是数组');
  }

  const meta = (payload.meta ?? {}) as KnowledgeTreeMeta;
  const kbName = text(payload.targetKbName) || text(meta.title) || '知识树';
  const targetKbId = text(payload.targetKbId);
  const kbId = targetKbId || stableId('kb', kbName);
  const kbs: ImportKb[] = [{ id: kbId, name: kbName, sort: 0 }];
  const folders: ImportFolder[] = [];
  const entries: ImportEntry[] = [];

  const walk = (list: unknown[], parentId: string | null, path: string[]): void => {
    list.forEach((item, index) => {
      const node = (item ?? {}) as KnowledgeTreeNode;
      const title = text(node.title) || '未命名';
      const type = text(node.type).toLowerCase();
      const children = Array.isArray(node.children) ? node.children : [];
      const nodePath = [...path, title];
      const isKnowledge = type === 'knowledge' || (!children.length && hasKnowledgeShape(node));

      if (isKnowledge) {
        entries.push(toKnowledgeEntry(node, { kbId, kbName, folderId: parentId, path, meta }));
        return;
      }

      const folderId = stableId('fld', `${kbId}/${nodePath.join('/')}`);
      folders.push({ id: folderId, kbId, parentId, name: title, sort: index });
      if (children.length) walk(children, folderId, nodePath);
    });
  };

  walk(payload.tree, null, []);
  if (!entries.length) throw new Error('tree 中没有 type=knowledge 的知识点');
  return { kbs, folders, entries };
}
