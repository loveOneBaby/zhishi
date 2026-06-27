// 知识点的 canonical 内容 = BlockNote「块文档」(doc: Block[])。
// 本模块负责:① 友好简写 → 合法 BlockNote 块(normalizeDocBlocks);
// ② 块文档 → 多级索引(splitDocToIndex,按标题块切分);③ markdown → 块(种子/旧数据)。
import { extractText, blocksToMarkdown, type Block } from './blocks.js';
import type { IndexNode, IndexTree } from './types.js';

let seq = 0;
function blockId(): string { seq += 1; return `bk_${Date.now().toString(36)}_${seq}`; }
function nodeId(): string { seq += 1; return `ix_${Date.now().toString(36)}_${seq}`; }

// content 简写 → BlockNote 行内内容(字符串 → 单个 text run;已是数组则原样)
function toInline(content: unknown): unknown {
  if (Array.isArray(content)) return content;
  if (typeof content === 'string' && content) return [{ type: 'text', text: content, styles: {} }];
  return [];
}

// 行内 markdown → BlockNote 行内内容:解析 **粗体** / `代码` / [文本](链接) / *斜体*。
// 仅用于 markdownToDocBlocks(把 AI/种子里的行内标记渲染成样式,避免出现裸 ** 或 ###)。
type InlineRun =
  | { type: 'text'; text: string; styles: Record<string, boolean> }
  | { type: 'link'; href: string; content: Array<{ type: 'text'; text: string; styles: Record<string, boolean> }> };

function parseInline(text: string): InlineRun[] {
  if (!text) return [];
  const patterns: Array<{ re: RegExp; make: (m: RegExpExecArray) => InlineRun }> = [
    { re: /\*\*([^*\n]+?)\*\*/, make: (m) => ({ type: 'text', text: m[1], styles: { bold: true } }) },
    { re: /__([^_\n]+?)__/, make: (m) => ({ type: 'text', text: m[1], styles: { bold: true } }) },
    { re: /`([^`\n]+?)`/, make: (m) => ({ type: 'text', text: m[1], styles: { code: true } }) },
    { re: /\[([^\]\n]+?)\]\(([^)\s]+?)\)/, make: (m) => ({ type: 'link', href: m[2], content: [{ type: 'text', text: m[1], styles: {} }] }) },
    { re: /\*([^*\n]+?)\*/, make: (m) => ({ type: 'text', text: m[1], styles: { italic: true } }) },
    { re: /(?<![A-Za-z0-9])_([^_\n]+?)_(?![A-Za-z0-9])/, make: (m) => ({ type: 'text', text: m[1], styles: { italic: true } }) },
  ];
  const out: InlineRun[] = [];
  let rest = text;
  while (rest) {
    let best: { idx: number; len: number; node: InlineRun } | null = null;
    for (const p of patterns) {
      const m = p.re.exec(rest);
      if (m && (best === null || m.index < best.idx)) best = { idx: m.index, len: m[0].length, node: p.make(m) };
    }
    if (!best) { out.push({ type: 'text', text: rest, styles: {} }); break; }
    if (best.idx > 0) out.push({ type: 'text', text: rest.slice(0, best.idx), styles: {} });
    out.push(best.node);
    rest = rest.slice(best.idx + best.len);
  }
  return out;
}

const VOID_TYPES = new Set(['image', 'table', 'divider', 'file', 'video', 'audio']);

// 友好简写 / 外部块 → 合法 BlockNote 块(补 id、props、行内内容;未知类型保留)
export function normalizeDocBlocks(raw: unknown): Block[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const b = (item ?? {}) as Block & { url?: unknown; src?: unknown; caption?: unknown; alt?: unknown };
    const type = typeof b.type === 'string' && b.type ? b.type : 'paragraph';
    const props: Record<string, unknown> = { ...(b.props ?? {}) };
    if (type === 'image') {
      // 允许把 url/src/caption/alt 写在顶层或 props 里
      const url = String(props.url ?? props.src ?? b.url ?? b.src ?? '');
      if (url) props.url = url;
      const caption = props.caption ?? b.caption ?? props.alt ?? b.alt;
      if (caption != null) props.caption = String(caption);
    }
    const block: Block = {
      id: typeof b.id === 'string' && b.id ? b.id : blockId(),
      type,
      props,
      children: Array.isArray(b.children) ? normalizeDocBlocks(b.children) : [],
    };
    if (VOID_TYPES.has(type)) {
      if (b.content !== undefined) block.content = b.content; // 如 table 的 tableContent
    } else {
      block.content = toInline(b.content);
    }
    return block;
  });
}

function headingLevel(b: Block): number | null {
  if (b.type !== 'heading') return null;
  const lvl = Number((b.props ?? {}).level ?? 1);
  return lvl >= 1 && lvl <= 6 ? lvl : 1;
}

// 块文档 → { intro, nodes }:标题块切分为多级索引;每个索引节点带 blocks 切片与 content(markdown 投影)
export function splitDocToIndex(doc: Block[]): IndexTree {
  const introBlocks: Block[] = [];
  const roots: IndexNode[] = [];
  const stack: { node: IndexNode; level: number; blocks: Block[] }[] = [];
  const flush = (frame: { node: IndexNode; blocks: Block[] }): void => {
    frame.node.blocks = frame.blocks;
    frame.node.content = blocksToMarkdown(frame.blocks);
  };
  for (const b of doc) {
    const level = headingLevel(b);
    if (level == null) {
      if (stack.length) stack[stack.length - 1].blocks.push(b);
      else introBlocks.push(b);
      continue;
    }
    const node: IndexNode = { id: nodeId(), title: extractText([b]) || '未命名索引', content: '', blocks: [], children: [] };
    while (stack.length && stack[stack.length - 1].level >= level) flush(stack.pop()!);
    if (stack.length) stack[stack.length - 1].node.children.push(node);
    else roots.push(node);
    stack.push({ node, level, blocks: [] });
  }
  while (stack.length) flush(stack.pop()!);
  return { intro: blocksToMarkdown(introBlocks), nodes: roots };
}

// 整篇可检索文本(标题 + 全文)
export function docText(doc: Block[]): string {
  return extractText(doc);
}

// 索引树 → 块文档(供旧数据/种子喂给 BlockNote 加载)。顶层索引 → 标题 level1。
export function treeToDoc(tree: IndexTree): Block[] {
  const out: Block[] = [];
  out.push(...markdownToDocBlocks(tree.intro));
  const walk = (nodes: IndexNode[], depth: number): void => {
    for (const n of nodes) {
      out.push({ id: blockId(), type: 'heading', props: { level: Math.min(depth, 3) }, content: toInline(n.title), children: [] });
      if (Array.isArray(n.blocks) && n.blocks.length) out.push(...normalizeDocBlocks(n.blocks));
      else out.push(...markdownToDocBlocks(n.content));
      walk(n.children, depth + 1);
    }
  };
  walk(tree.nodes, 1);
  return out;
}

// ── markdown → 块(种子 / 旧数据 / 友好导入)。结构化子集,行内不解析样式(保留纯文本)。──
export function markdownToDocBlocks(md: string): Block[] {
  const lines = (md || '').split('\n');
  const out: Block[] = [];
  const para = (text: string): Block => ({ id: blockId(), type: 'paragraph', props: {}, content: parseInline(text), children: [] });
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    const image = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/.exec(line);
    const code = /^```(\w*)\s*$/.exec(line);
    if (code) {
      const lang = code[1] || '';
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { body.push(lines[i]); i += 1; }
      i += 1;
      out.push({ id: blockId(), type: 'codeBlock', props: { language: lang }, content: toInline(body.join('\n')), children: [] });
      continue;
    }
    if (heading) {
      // 去掉标题里残留的 markdown 标记(模型偶尔把 ### 写进标题字段,导致出现 "## ### 标题")
      const headingText = heading[2].trim().replace(/^#{1,6}\s*/, '').replace(/\s*#+\s*$/, '');
      out.push({ id: blockId(), type: 'heading', props: { level: Math.min(heading[1].length, 3) }, content: parseInline(headingText), children: [] });
      i += 1;
      continue;
    }
    if (image) {
      out.push({ id: blockId(), type: 'image', props: { url: image[2].trim(), caption: image[1].trim() }, children: [] });
      i += 1;
      continue;
    }
    const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
    if (bullet) {
      out.push({ id: blockId(), type: 'bulletListItem', props: {}, content: parseInline(bullet[1].trim()), children: [] });
      i += 1;
      continue;
    }
    const ordered = /^\s*\d+\.\s+(.+)$/.exec(line);
    if (ordered) {
      out.push({ id: blockId(), type: 'numberedListItem', props: {}, content: parseInline(ordered[1].trim()), children: [] });
      i += 1;
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      out.push({ id: blockId(), type: 'quote', props: {}, content: parseInline(quote[1].trim()), children: [] });
      i += 1;
      continue;
    }
    if (line.trim() === '') { i += 1; continue; }
    out.push(para(line.trim()));
    i += 1;
  }
  return out;
}
