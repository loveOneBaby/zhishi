// 知识库「块结构」导入（kb-import-2）→ 扁平字符串模型的转换。
// 现有存储用「intro 为字符串、节点 content 为字符串」的轻量 markdown 模型，
// 这里把富块结构折叠成该模型可渲染的 markdown（renderMd 支持的子集：
// 段落 / ```代码块``` / ## 标题 / - 列表 / [文本](链接) / **加粗** / `行内代码`）。
import type { IndexNode } from './index-tree.js';
import type { ImportEntry } from './db.js';

export interface Asset {
  id: string;
  type?: string;
  url?: string;
  width?: number;
  height?: number;
  alt?: string;
}

interface RawBlock {
  id?: string;
  type?: string;
  data?: Record<string, unknown> | null;
  children?: RawBlock[] | null;
}

// 依据 assetId 从资源表解析图片 url；缺失则退回 data.url
function resolveImageUrl(data: Record<string, unknown>, assets: Asset[]): string {
  const assetId = String(data.assetId ?? '').trim();
  if (assetId) {
    const a = assets.find((x) => x.id === assetId);
    if (a?.url) return a.url;
  }
  return typeof data.url === 'string' ? data.url : '';
}

// callout 的语气 → emoji 前缀（渲染器不支持 blockquote，用 emoji 区分）
const CALLOUT_ICON: Record<string, string> = {
  warn: '⚠️', warning: '⚠️',
  danger: '🔴', error: '🔴',
  success: '✅', tip: '💡', info: '💡',
};

// 单个块 → markdown 文本
function blockToMarkdown(block: unknown, assets: Asset[]): string {
  const b = (block ?? {}) as RawBlock;
  const type = typeof b.type === 'string' ? b.type : '';
  const data = (b.data ?? {}) as Record<string, unknown>;
  const text = typeof data.text === 'string' ? data.text : '';
  switch (type) {
    case 'paragraph':
      return text.trim();
    case 'image': {
      const url = resolveImageUrl(data, assets);
      const caption = String(data.caption ?? data.alt ?? '').trim();
      if (!url) return caption ? `🖼 ${caption}` : '';
      return `[🖼 ${caption || '图片'}](${url})`;
    }
    case 'code': {
      const lang = String(data.lang ?? '').trim();
      const body = text.replace(/```/g, '').replace(/\s+$/, '');
      return '```' + lang + '\n' + body + '\n```';
    }
    case 'callout': {
      const tone = String(data.tone ?? 'info').toLowerCase();
      const icon = CALLOUT_ICON[tone] ?? '💡';
      const t = text.trim();
      return t ? `${icon} ${t}` : '';
    }
    case 'toggle': {
      const head = text.trim();
      const kids = Array.isArray(b.children) ? blocksToMarkdown(b.children, assets) : '';
      return [head ? `### ${head}` : '', kids].filter(Boolean).join('\n\n');
    }
    case 'list': {
      const items = Array.isArray(data.items)
        ? data.items.map((i) => String(i)).filter((s) => s.length > 0)
        : [];
      if (!items.length) return '';
      if (data.ordered) return items.map((it, i) => `${i + 1}. ${it}`).join('\n');
      return items.map((it) => `- ${it}`).join('\n');
    }
    default:
      // 未知块类型：尽量保留其 text，否则丢弃
      return text.trim();
  }
}

// 块数组 → markdown（块之间空行分隔，保证 renderMd 独立成段）
export function blocksToMarkdown(blocks: unknown, assets: Asset[] = []): string {
  if (!Array.isArray(blocks)) return '';
  return blocks
    .map((b) => blockToMarkdown(b, assets))
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join('\n\n')
    .trim();
}

interface RawNode {
  id?: string;
  title?: string;
  blocks?: unknown;
  content?: string;
  children?: RawNode[] | null;
}

// 块节点 → 扁平 IndexNode（content 由 blocks 折叠；已是字符串则原样保留）
function convertNode(raw: RawNode, assets: Asset[]): IndexNode {
  const title = String(raw.title ?? '').trim();
  let content: string;
  if (Array.isArray(raw.blocks)) content = blocksToMarkdown(raw.blocks, assets);
  else if (typeof raw.content === 'string') content = raw.content;
  else content = '';
  const children = Array.isArray(raw.children) ? raw.children.map((c) => convertNode(c, assets)) : [];
  return { id: typeof raw.id === 'string' ? raw.id : '', title, content, children };
}

interface RawIntro {
  blocks?: unknown;
}

interface RawEntry {
  id?: string;
  cat?: string;
  kbId?: string;
  folderId?: string | null;
  title?: string;
  py?: string;
  tags?: string[];
  summary?: string;
  intro?: string | RawIntro;
  nodes?: RawNode[] | null;
  body?: string;
  doc?: unknown;          // 直接给 BlockNote 块文档(优先)
  searchText?: string;
}

// 把一条 kb-import-2 条目（或旧的扁平条目）统一转成 ImportEntry。
// 对扁平结构是直通（intro 为字符串、nodes.content 为字符串），故 v1/v2 可混用。
export function convertEntry(raw: unknown, assets: Asset[] = []): ImportEntry {
  const e = (raw ?? {}) as RawEntry;
  let intro: string;
  if (typeof e.intro === 'string') intro = e.intro;
  else if (e.intro && Array.isArray(e.intro.blocks)) intro = blocksToMarkdown(e.intro.blocks, assets);
  else intro = '';

  // searchText 为可选检索补充词；并入 intro 使其可被检索到（模型无独立隐藏字段）
  if (typeof e.searchText === 'string' && e.searchText.trim()) {
    intro = (intro ? intro + '\n\n' : '') + e.searchText.trim();
  }

  const nodes = Array.isArray(e.nodes) ? e.nodes.map((n) => convertNode(n, assets)) : undefined;
  return {
    id: e.id,
    cat: e.cat,
    kbId: e.kbId,
    folderId: e.folderId,
    title: e.title,
    py: e.py,
    tags: Array.isArray(e.tags) ? e.tags : undefined,
    summary: e.summary,
    intro,
    nodes,
    body: e.body,
    doc: Array.isArray(e.doc) ? (e.doc as ImportEntry['doc']) : undefined,
  };
}
