import type { IndexNode } from './types';

// 多级索引的树操作（不可变）。索引是知识点的一等结构化数据，不再由 markdown 解析。
export const MAX_INDEX_DEPTH = 2; // depth 0/1/2 → 二/三/四级索引

let counter = 0;
export function newNode(title = '新索引'): IndexNode {
  counter += 1;
  return { id: `ix_${Date.now().toString(36)}_${counter}`, title, content: '', children: [] };
}

export function patchNode(nodes: IndexNode[], id: string, patch: Partial<IndexNode>): IndexNode[] {
  return nodes.map((n) =>
    n.id === id ? { ...n, ...patch } : { ...n, children: patchNode(n.children, id, patch) }
  );
}

export function removeNode(nodes: IndexNode[], id: string): IndexNode[] {
  return nodes.filter((n) => n.id !== id).map((n) => ({ ...n, children: removeNode(n.children, id) }));
}

// 同级移动：dir = -1 上移，+1 下移
export function moveNode(nodes: IndexNode[], id: string, dir: number): IndexNode[] {
  const idx = nodes.findIndex((n) => n.id === id);
  if (idx >= 0) {
    const j = idx + dir;
    if (j < 0 || j >= nodes.length) return nodes;
    const copy = nodes.slice();
    [copy[idx], copy[j]] = [copy[j], copy[idx]];
    return copy;
  }
  return nodes.map((n) => ({ ...n, children: moveNode(n.children, id, dir) }));
}

export function addChild(nodes: IndexNode[], parentId: string, child: IndexNode): IndexNode[] {
  return nodes.map((n) =>
    n.id === parentId
      ? { ...n, children: [...n.children, child] }
      : { ...n, children: addChild(n.children, parentId, child) }
  );
}
