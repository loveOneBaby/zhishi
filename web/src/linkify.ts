import type { Block } from './types';

// 把块文档里「纯文本中的裸 URL」转成 BlockNote 的 link 行内节点,
// 这样只读预览里也能点击(导入的内容常把链接写成纯文本)。
const URL_RE = /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"，。；：！？、）】])/g;

interface TextInline { type: 'text'; text: string; styles?: Record<string, unknown>; }

function isTextInline(v: unknown): v is TextInline {
  return Boolean(v) && (v as { type?: string }).type === 'text' && typeof (v as { text?: unknown }).text === 'string';
}

function splitText(item: TextInline): unknown[] {
  const text = item.text;
  URL_RE.lastIndex = 0;
  if (!URL_RE.test(text)) return [item];
  URL_RE.lastIndex = 0;
  const styles = item.styles ?? {};
  const out: unknown[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(text)) !== null) {
    const url = m[1];
    if (m.index > last) out.push({ type: 'text', text: text.slice(last, m.index), styles });
    out.push({ type: 'link', href: url, content: [{ type: 'text', text: url, styles }] });
    last = m.index + url.length;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last), styles });
  return out;
}

function linkifyContent(content: unknown): unknown {
  if (!Array.isArray(content)) return content;
  return content.flatMap((it) => (isTextInline(it) ? splitText(it) : [it]));
}

export function linkifyBlocks(blocks?: Block[]): Block[] | undefined {
  if (!Array.isArray(blocks)) return blocks;
  return blocks.map((b) => {
    const next: Block = { ...b };
    if (Array.isArray(b.content)) next.content = linkifyContent(b.content);
    if (Array.isArray(b.children)) next.children = linkifyBlocks(b.children);
    return next;
  });
}
