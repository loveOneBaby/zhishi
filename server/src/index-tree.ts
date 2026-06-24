// 结构化「多级索引」：知识点(一级) 下挂 nodes（二/三/四级…），每个节点含标题与内容。
// 这是知识点的一等数据结构；运行时不再解析 markdown 标题。
export interface IndexNode {
  id: string;
  title: string;
  content: string;
  children: IndexNode[];
}

export interface IndexTree {
  intro: string;
  nodes: IndexNode[];
}

let counter = 0;
function newId(): string { counter += 1; return `ix_${Date.now().toString(36)}_${counter}`; }

export function emptyIndex(): IndexTree { return { intro: '', nodes: [] }; }

// 旧 markdown 正文 → 结构化索引（仅用于导入旧种子 / 旧库的一次性转换）
export function parseBodyToIndex(body: string): IndexTree {
  const lines = (body || '').split('\n');
  const intro: string[] = [];
  const roots: IndexNode[] = [];
  const stack: { node: IndexNode; level: number; lines: string[] }[] = [];
  const flush = (frame: { node: IndexNode; lines: string[] }): void => {
    frame.node.content = frame.lines.join('\n').replace(/^\s*\n/, '').replace(/\s+$/, '');
  };
  for (const line of lines) {
    const h = /^(#{2,6})\s+(.+)$/.exec(line);
    if (!h) {
      if (stack.length) stack[stack.length - 1].lines.push(line);
      else intro.push(line);
      continue;
    }
    const level = h[1].length;
    const node: IndexNode = { id: newId(), title: h[2].trim(), content: '', children: [] };
    while (stack.length && stack[stack.length - 1].level >= level) flush(stack.pop()!);
    if (stack.length) stack[stack.length - 1].node.children.push(node);
    else roots.push(node);
    stack.push({ node, level, lines: [] });
  }
  while (stack.length) flush(stack.pop()!);
  return { intro: intro.join('\n').trim(), nodes: roots };
}

// 规范化外部传入的索引（补 id、保证字段与数组类型）
export function normalizeIndex(input: unknown): IndexTree {
  const obj = (input ?? {}) as { intro?: unknown; nodes?: unknown };
  const normNodes = (arr: unknown): IndexNode[] => {
    if (!Array.isArray(arr)) return [];
    return arr.map((raw) => {
      const n = (raw ?? {}) as Partial<IndexNode>;
      return {
        id: typeof n.id === 'string' && n.id ? n.id : newId(),
        title: String(n.title ?? '').trim() || '未命名索引',
        content: String(n.content ?? ''),
        children: normNodes(n.children),
      };
    });
  };
  return { intro: String(obj.intro ?? ''), nodes: normNodes(obj.nodes) };
}

// 结构化索引 → 可检索文本（标题 + 内容，递归）
export function indexText(tree: IndexTree): string {
  const parts: string[] = [tree.intro];
  const walk = (nodes: IndexNode[]): void => {
    for (const n of nodes) { parts.push(n.title, n.content); walk(n.children); }
  };
  walk(tree.nodes);
  return parts.filter(Boolean).join(' ');
}
