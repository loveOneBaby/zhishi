import type { Entry, IndexNode } from '../../types';
import { toSearchText, matchesQuery } from '../../pinyin-search';

// 画布的纯逻辑层：图模型构建、可见集合计算、布局、连线路径。无 React 依赖，便于测试与维护。

export type NType = 'cat' | 'entry' | 'section';

export interface GNode {
  id: string;
  label: string;
  type: NType;
  depth: number;
  sub?: string;
  entryId?: string;
  parentId: string | null;
  children: string[];
  text: string;
  meta?: string[];
}

export interface PlacedNode {
  node: GNode;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  order: number;
}

export interface TreeLayout {
  nodes: PlacedNode[];
  byId: Map<string, PlacedNode>;
  width: number;
  height: number;
}

export const MAX_VISIBLE_DEPTH = 3;
export const WORLD_PADDING_X = 64;
export const WORLD_PADDING_Y = 72;
export const COLUMN_GAP = 156;
export const ROW_GAP = 24;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function cardWidth(depth: number): number {
  if (depth === 0) return 340;
  if (depth === 1) return 286;
  if (depth === 2) return 256;
  return 232;
}

let textMeasureContext: CanvasRenderingContext2D | null = null;

function wrappedLineCount(text: string, maxWidth: number, font: string): number {
  if (!text) return 0;
  if (typeof document === 'undefined') return Math.max(1, Math.ceil(text.length / 18));
  if (!textMeasureContext) textMeasureContext = document.createElement('canvas').getContext('2d');
  const context = textMeasureContext;
  if (!context) return Math.max(1, Math.ceil(text.length / 18));

  context.font = font;
  let lines = 1;
  let width = 0;
  for (const character of Array.from(text)) {
    const characterWidth = context.measureText(character).width;
    if (width > 0 && width + characterWidth > maxWidth) {
      lines += 1;
      width = characterWidth;
    } else {
      width += characterWidth;
    }
  }
  return lines;
}

export function cardHeight(node: GNode, depth: number): number {
  const root = depth === 0;
  const leaf = depth >= 2;
  const horizontalPadding = root ? 26 : leaf ? 18 : 20;
  const verticalPadding = root ? 24 : leaf ? 16 : 18;
  const innerWidth = cardWidth(depth) - horizontalPadding * 2;
  const titleSize = root ? 28 : leaf ? 14 : 16;
  const titleLineHeight = titleSize * (root ? 1.08 : 1.25);
  const bodySize = root ? 13.5 : leaf ? 11.5 : 12.5;
  const bodyLineHeight = bodySize * (root ? 1.55 : 1.5);
  const titleLines = wrappedLineCount(node.label, innerWidth, `700 ${titleSize}px system-ui`);
  const bodyLines = node.sub
    ? wrappedLineCount(node.sub, innerWidth, `400 ${bodySize}px system-ui`)
    : 0;
  const metaBlock = (root ? 14 : 9) + 22;
  const titleMargin = node.sub ? (root ? 13 : 7) : 0;
  const measuredHeight = verticalPadding * 2
    + metaBlock
    + titleLines * titleLineHeight
    + titleMargin
    + bodyLines * bodyLineHeight
    + 8;
  return Math.ceil(Math.max(root ? 176 : leaf ? 112 : 136, measuredHeight));
}

function xAtDepth(depth: number): number {
  let x = WORLD_PADDING_X;
  for (let i = 0; i < depth; i++) x += cardWidth(i) + COLUMN_GAP;
  return x;
}

export function buildModel(entries: Entry[]): { map: Map<string, GNode>; kbs: string[] } {
  const map = new Map<string, GNode>();
  const kbs: string[] = [];

  for (const entry of entries) {
    const kbId = `kb::${entry.cat}`;
    if (!map.has(kbId)) {
      map.set(kbId, {
        id: kbId,
        label: entry.cat,
        type: 'cat',
        depth: 0,
        sub: entry.cat === 'AI'
          ? '面试地图按专题 → 考查维度 → 高频问题展开，所有知识树直接列在画布中。'
          : '当前知识库的知识树会直接列在画布中，可拖拽浏览并搜索定位。',
        parentId: null,
        children: [],
        text: toSearchText(entry.cat),
        meta: ['Interview Map'],
      });
      kbs.push(kbId);
    }

    const entryId = `ent::${entry.id}`;
    map.set(entryId, {
      id: entryId,
      label: entry.title,
      type: 'entry',
      depth: 1,
      sub: entry.summary,
      entryId: entry.id,
      parentId: kbId,
      children: [],
      text: [
        toSearchText(entry.cat, entry.title, entry.py, entry.tags.join(' ')),
        toSearchText(entry.summary, entry.intro),
      ].join(' '),
      meta: entry.tags,
    });
    map.get(kbId)!.children.push(entryId);

    // 直接用结构化的多级索引节点构建画布层级
    const addNodes = (nodes: IndexNode[], parentId: string, depth: number): void => {
      nodes.forEach((node) => {
        const nodeId = `${entryId}#${node.id}`;
        map.set(nodeId, {
          id: nodeId,
          label: node.title,
          type: 'section',
          depth,
          sub: node.content,
          entryId: entry.id,
          parentId,
          children: [],
          text: toSearchText(node.title, node.content),
        });
        map.get(parentId)!.children.push(nodeId);
        addNodes(node.children, nodeId, depth + 1);
      });
    };
    addNodes(entry.nodes, entryId, 2);
  }

  return { map, kbs };
}

export function collectVisible(
  map: Map<string, GNode>,
  rootId: string,
  query: string,
  searchActive: boolean,
  collapsed: Set<string>,
  showFullTree: boolean
): Set<string> {
  const visible = new Set<string>();
  const root = map.get(rootId);
  if (!root) return visible;
  const trimmed = query.trim();
  const showKeyPathOnly = searchActive && Boolean(trimmed);
  const limit = showKeyPathOnly || showFullTree ? Infinity : MAX_VISIBLE_DEPTH;

  const includeSubtree = (startId: string, startDepth = 0): void => {
    const stack = [{ id: startId, depth: startDepth }];
    while (stack.length) {
      const current = stack.pop()!;
      visible.add(current.id);
      const shouldExpandChildren = current.depth < limit && !collapsed.has(current.id);
      if (shouldExpandChildren) {
        for (const child of map.get(current.id)?.children ?? []) {
          stack.push({ id: child, depth: current.depth + 1 });
        }
      }
    }
  };

  if (!trimmed) {
    includeSubtree(rootId);
    return visible;
  }

  const descendants: string[] = [];
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    descendants.push(id);
    for (const child of map.get(id)?.children ?? []) stack.push(child);
  }

  for (const id of descendants) {
    if (!matchesQuery(map.get(id)?.text ?? '', trimmed)) continue;
    let current: string | null = id;
    while (current) {
      visible.add(current);
      if (current === rootId) break;
      current = map.get(current)?.parentId ?? null;
    }
  }
  visible.add(rootId);
  return visible;
}

export function buildTreeLayout(map: Map<string, GNode>, rootId: string, visible: Set<string>): TreeLayout {
  const subtreeHeights = new Map<string, number>();

  const measure = (id: string, depth: number): number => {
    const children = (map.get(id)?.children ?? []).filter((child) => visible.has(child));
    const node = map.get(id)!;
    const ownHeight = cardHeight(node, depth);
    if (!children.length) {
      subtreeHeights.set(id, ownHeight);
      return ownHeight;
    }
    const childrenHeight = children.reduce((sum, child) => sum + measure(child, depth + 1), 0)
      + ROW_GAP * (children.length - 1);
    const height = Math.max(ownHeight, childrenHeight);
    subtreeHeights.set(id, height);
    return height;
  };

  const treeHeight = measure(rootId, 0);
  const nodes: PlacedNode[] = [];
  const byId = new Map<string, PlacedNode>();
  let maxRight = 0;

  const place = (id: string, depth: number, top: number, order: number): void => {
    const node = map.get(id)!;
    const subtreeHeight = subtreeHeights.get(id) ?? cardHeight(node, depth);
    const width = cardWidth(depth);
    const height = cardHeight(node, depth);
    const placed: PlacedNode = {
      node,
      x: xAtDepth(depth),
      y: top + (subtreeHeight - height) / 2,
      width,
      height,
      depth,
      order,
    };
    nodes.push(placed);
    byId.set(id, placed);
    maxRight = Math.max(maxRight, placed.x + width);

    const children = node.children.filter((child) => visible.has(child));
    if (!children.length) return;
    const childrenHeight = children.reduce((sum, child) => sum + (subtreeHeights.get(child) ?? 0), 0)
      + ROW_GAP * (children.length - 1);
    let childTop = top + (subtreeHeight - childrenHeight) / 2;
    children.forEach((child, index) => {
      place(child, depth + 1, childTop, index);
      childTop += (subtreeHeights.get(child) ?? 0) + ROW_GAP;
    });
  };

  place(rootId, 0, WORLD_PADDING_Y, 0);
  return {
    nodes,
    byId,
    width: maxRight + WORLD_PADDING_X,
    height: treeHeight + WORLD_PADDING_Y * 2,
  };
}

export function connectorPath(source: PlacedNode, target: PlacedNode): string {
  const sx = source.x + source.width;
  const sy = source.y + source.height / 2;
  const tx = target.x;
  const ty = target.y + target.height / 2;
  if (Math.abs(ty - sy) < 1) return `M ${sx} ${sy} H ${tx}`;

  const mid = sx + (tx - sx) * 0.48;
  const radius = Math.min(16, Math.abs(ty - sy) / 2, (tx - sx) / 4);
  const direction = ty > sy ? 1 : -1;
  return [
    `M ${sx} ${sy}`,
    `H ${mid - radius}`,
    `Q ${mid} ${sy} ${mid} ${sy + direction * radius}`,
    `V ${ty - direction * radius}`,
    `Q ${mid} ${ty} ${mid + radius} ${ty}`,
    `H ${tx}`,
  ].join(' ');
}
