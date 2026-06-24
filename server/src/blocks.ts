// BlockNote 形态的块模型(canonical 富内容)。块对存储是「不透明 JSON」——
// 服务端不需要认识每种 type,只做两件事:抽纯文本(喂检索/画布)与降级转 markdown(过渡显示)。
// 这样用户/导入方可自由新增块类型,服务端永不丢数据(未知块的文本与子块照样保留)。

export interface Block {
  id?: string;
  type?: string;
  props?: Record<string, unknown> | null;
  content?: unknown;        // InlineContent[] | TableContent | string | undefined
  children?: Block[] | null;
}

// 行内内容 → 纯文本(兼容 BlockNote 的 styled text / link / tableContent / 纯串)
function inlineText(content: unknown): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(inlineText).join('');
  const c = content as Record<string, unknown>;
  if (typeof c.text === 'string') return c.text;
  if (c.type === 'link') return inlineText(c.content);
  if (c.type === 'tableContent' && Array.isArray(c.rows)) {
    return (c.rows as Array<{ cells?: unknown[] }>)
      .map((r) => (Array.isArray(r.cells) ? r.cells.map(inlineText).join(' ') : ''))
      .join(' ');
  }
  return '';
}

function blockProps(b: Block): Record<string, unknown> {
  return (b.props ?? {}) as Record<string, unknown>;
}

// 块树 → 纯文本(标题/正文/图片 caption/alt/表格文字 + 递归子块)。未知块也尽量取其文本。
export function extractText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return '';
  const out: string[] = [];
  for (const raw of blocks) {
    const b = (raw ?? {}) as Block;
    const p = blockProps(b);
    out.push(inlineText(b.content));
    if (typeof p.caption === 'string') out.push(p.caption);
    if (typeof p.alt === 'string') out.push(p.alt);
    if (typeof p.name === 'string') out.push(p.name); // 文件名等
    if (Array.isArray(b.children)) out.push(extractText(b.children));
  }
  return out.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

const HEADING_HASH: Record<number, string> = { 1: '##', 2: '###', 3: '####' };
const CALLOUT_ICON: Record<string, string> = {
  warn: '⚠️', warning: '⚠️', danger: '🔴', error: '🔴', success: '✅', tip: '💡', info: '💡',
};

// 块 → markdown(无损降级:补齐 heading/quote/divider/table,避免丢块)。仅作过渡渲染用。
export function blocksToMarkdown(blocks: unknown): string {
  if (!Array.isArray(blocks)) return '';
  const lines: string[] = [];
  const walk = (list: Block[], indent = 0): void => {
    for (const raw of list) {
      const b = (raw ?? {}) as Block;
      const p = blockProps(b);
      const type = String(b.type ?? 'paragraph');
      const text = inlineText(b.content);
      switch (type) {
        case 'heading': {
          const level = Number(p.level ?? 1);
          lines.push(`${HEADING_HASH[level] ?? '##'} ${text}`);
          break;
        }
        case 'bulletListItem':
          lines.push(`${'  '.repeat(indent)}- ${text}`);
          break;
        case 'numberedListItem':
          lines.push(`${'  '.repeat(indent)}1. ${text}`);
          break;
        case 'checkListItem':
          lines.push(`${'  '.repeat(indent)}- [${p.checked ? 'x' : ' '}] ${text}`);
          break;
        case 'image': {
          const url = String(p.url ?? '');
          const cap = String(p.caption ?? p.alt ?? '图片');
          if (url) lines.push(`![${cap}](${url})`);
          else if (cap) lines.push(`🖼 ${cap}`);
          break;
        }
        case 'codeBlock':
          lines.push('```' + String(p.language ?? '') + '\n' + text + '\n```');
          break;
        case 'quote':
          lines.push(`> ${text}`);
          break;
        case 'callout': {
          const icon = CALLOUT_ICON[String(p.tone ?? p.type ?? 'info').toLowerCase()] ?? '💡';
          lines.push(`${icon} ${text}`);
          break;
        }
        case 'divider':
          lines.push('---');
          break;
        case 'table': {
          const tc = (b.content ?? {}) as { rows?: Array<{ cells?: unknown[] }> };
          const rows = Array.isArray(tc.rows) ? tc.rows : [];
          rows.forEach((r, i) => {
            const cells = Array.isArray(r.cells) ? r.cells.map((c) => inlineText(c)) : [];
            lines.push(`| ${cells.join(' | ')} |`);
            if (i === 0) lines.push(`| ${cells.map(() => '---').join(' | ')} |`);
          });
          break;
        }
        default:
          // paragraph 及未知块:输出文本,子块继续
          if (text) lines.push(text);
          if (Array.isArray(b.children) && b.children.length) walk(b.children, indent);
          continue;
      }
      if (Array.isArray(b.children) && b.children.length && type !== 'table') {
        walk(b.children, type.endsWith('ListItem') ? indent + 1 : indent);
      }
    }
  };
  walk(blocks);
  // 块之间空行分隔(过渡渲染用)
  return lines.filter((l) => l.length > 0).join('\n\n').trim();
}
