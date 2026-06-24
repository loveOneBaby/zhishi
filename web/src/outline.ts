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

// 在指定节点之后插入同级节点
export function addSibling(nodes: IndexNode[], id: string, sibling: IndexNode): IndexNode[] {
  const idx = nodes.findIndex((n) => n.id === id);
  if (idx >= 0) {
    const copy = nodes.slice();
    copy.splice(idx + 1, 0, sibling);
    return copy;
  }
  return nodes.map((n) => ({ ...n, children: addSibling(n.children, id, sibling) }));
}

// 从树中摘除节点（不可变），返回摘除后的树与被摘出的节点
export function pluckNode(nodes: IndexNode[], id: string): { nodes: IndexNode[]; node: IndexNode | null } {
  const idx = nodes.findIndex((n) => n.id === id);
  if (idx >= 0) {
    const node = nodes[idx];
    return { nodes: [...nodes.slice(0, idx), ...nodes.slice(idx + 1)], node };
  }
  for (const n of nodes) {
    const res = pluckNode(n.children, id);
    if (res.node) {
      return { nodes: nodes.map((x) => (x.id === n.id ? { ...x, children: res.nodes } : x)), node: res.node };
    }
  }
  return { nodes, node: null };
}

// 将 fromId 移动到 toId 之前（同级重排）。两者不在同一列表时不变。
export function moveBefore(nodes: IndexNode[], fromId: string, toId: string): IndexNode[] {
  if (fromId === toId) return nodes;
  const { nodes: without, node } = pluckNode(nodes, fromId);
  if (!node) return nodes;
  const insert = (list: IndexNode[]): IndexNode[] => {
    const idx = list.findIndex((n) => n.id === toId);
    if (idx >= 0) return [...list.slice(0, idx), node, ...list.slice(idx)];
    let touched = false;
    const next = list.map((n) => {
      const c = insert(n.children);
      if (c !== n.children) { touched = true; return { ...n, children: c }; }
      return n;
    });
    return touched ? next : list;
  };
  const res = insert(without);
  return res === without ? nodes : res;
}

// 将 fromId 移动为 toId 的末位子节点（跨级嵌套）。
export function moveAsLastChild(nodes: IndexNode[], fromId: string, toId: string): IndexNode[] {
  if (fromId === toId) return nodes;
  const { nodes: without, node } = pluckNode(nodes, fromId);
  if (!node) return nodes;
  return addChild(without, toId, node);
}

// 查找某节点的父 id；根级返回 null
export function parentIdOf(nodes: IndexNode[], id: string): string | null {
  if (nodes.some((n) => n.id === id)) return null;
  for (const n of nodes) {
    if (n.children.some((c) => c.id === id)) return n.id;
    const deeper = parentIdOf(n.children, id);
    if (deeper) return deeper;
  }
  return null;
}

// 某节点的全部后代 id（拖拽时用于禁止把节点拖进自己的子树，避免成环）
export function descendantIds(nodes: IndexNode[], id: string): Set<string> {
  const out = new Set<string>();
  const collect = (list: IndexNode[]): void => {
    for (const n of list) { out.add(n.id); collect(n.children); }
  };
  const walk = (list: IndexNode[]): boolean => {
    for (const n of list) {
      if (n.id === id) { collect(n.children); return true; }
      if (walk(n.children)) return true;
    }
    return false;
  };
  walk(nodes);
  return out;
}
