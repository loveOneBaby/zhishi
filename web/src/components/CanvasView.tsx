import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import type { Entry, Theme } from '../types';
import { toSearchText } from '../pinyin-search';

interface Props {
  entries: Entry[];
  theme: Theme;
  onOpen: (id: string) => void;
  hasQuery: boolean;
}

type NType = 'cat' | 'entry' | 'section';

interface GNode {
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

interface HeadingNode {
  title: string;
  content: string;
  level: number;
  children: HeadingNode[];
}

interface PlacedNode {
  node: GNode;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  order: number;
}

interface TreeLayout {
  nodes: PlacedNode[];
  byId: Map<string, PlacedNode>;
  width: number;
  height: number;
}

interface Viewport {
  x: number;
  y: number;
  scale: number;
}

const MAX_VISIBLE_DEPTH = 3;
const WORLD_PADDING_X = 64;
const WORLD_PADDING_Y = 72;
const COLUMN_GAP = 156;
const ROW_GAP = 24;
const MIN_SCALE = 0.05;
const RESET_MIN_SCALE = 0.14;
const MAX_SCALE = 1.5;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function cardWidth(depth: number): number {
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

function cardHeight(node: GNode, depth: number): number {
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

function plainText(value: string): string {
  return value
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/^\s*[-*>#]+\s*/gm, ' ')
    .replace(/[*`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseHeadingTree(body: string): HeadingNode[] {
  const roots: HeadingNode[] = [];
  const stack: { node: HeadingNode; lines: string[] }[] = [];

  for (const line of (body || '').split('\n')) {
    const heading = /^(#{2,4})\s+(.+)$/.exec(line);
    if (!heading) {
      if (stack.length) stack[stack.length - 1].lines.push(line);
      continue;
    }

    const level = heading[1].length;
    const node: HeadingNode = {
      title: plainText(heading[2]),
      content: '',
      level,
      children: [],
    };

    while (stack.length && stack[stack.length - 1].node.level >= level) {
      const finished = stack.pop()!;
      finished.node.content = plainText(finished.lines.join(' '));
    }
    if (stack.length) stack[stack.length - 1].node.children.push(node);
    else roots.push(node);
    stack.push({ node, lines: [] });
  }

  while (stack.length) {
    const finished = stack.pop()!;
    finished.node.content = plainText(finished.lines.join(' '));
  }
  return roots;
}

function buildModel(entries: Entry[]): { map: Map<string, GNode>; kbs: string[] } {
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
    const headings = parseHeadingTree(entry.body);
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
        toSearchText(entry.title, entry.py, entry.tags.join(' ')),
        (entry.summary || '').toLowerCase(),
        (entry.body || '').toLowerCase(),
      ].join(' '),
      meta: entry.tags,
    });
    map.get(kbId)!.children.push(entryId);

    const addHeadings = (headings: HeadingNode[], parentId: string, path: string): void => {
      headings.forEach((heading, index) => {
        const nodePath = path ? `${path}.${index}` : String(index);
        const nodeId = `${entryId}#${nodePath}`;
        map.set(nodeId, {
          id: nodeId,
          label: heading.title,
          type: 'section',
          depth: heading.level,
          sub: heading.content,
          entryId: entry.id,
          parentId,
          children: [],
          text: [
            toSearchText(heading.title),
            (heading.content || '').toLowerCase(),
          ].join(' '),
        });
        map.get(parentId)!.children.push(nodeId);
        addHeadings(heading.children, nodeId, nodePath);
      });
    };
    addHeadings(headings, entryId, '');
  }

  return { map, kbs };
}

function collectVisible(
  map: Map<string, GNode>,
  rootId: string,
  query: string,
  expandAll: boolean,
  collapsed: Set<string>
): Set<string> {
  const visible = new Set<string>();
  const root = map.get(rootId);
  if (!root) return visible;
  const q = query.trim().toLowerCase();
  const autoExpand = expandAll || Boolean(q);
  const limit = autoExpand ? Infinity : MAX_VISIBLE_DEPTH;

  const includeSubtree = (startId: string, startDepth = 0): void => {
    const stack = [{ id: startId, depth: startDepth }];
    while (stack.length) {
      const current = stack.pop()!;
      visible.add(current.id);
      const shouldExpandChildren = current.depth < limit && (autoExpand || !collapsed.has(current.id));
      if (shouldExpandChildren) {
        for (const child of map.get(current.id)?.children ?? []) {
          stack.push({ id: child, depth: current.depth + 1 });
        }
      }
    }
  };

  if (!q) {
    includeSubtree(rootId);
    return visible;
  }

  if (root.text.includes(q)) {
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
    if (!map.get(id)?.text.includes(q)) continue;
    includeSubtree(id);
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

function buildTreeLayout(map: Map<string, GNode>, rootId: string, visible: Set<string>): TreeLayout {
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

function connectorPath(source: PlacedNode, target: PlacedNode): string {
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

export default function CanvasView({ entries, theme: t, onOpen, hasQuery }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; originX: number; originY: number } | null>(null);

  const { map: model, kbs } = useMemo(() => buildModel(entries), [entries]);
  const [kbId, setKbId] = useState('');
  const [scoped, setScoped] = useState('');
  const [immersive, setImmersive] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [viewport, setViewport] = useState<Viewport>({ x: 48, y: 48, scale: 0.9 });
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!kbId || !model.has(kbId)) {
      const aiKb = kbs.find((id) => model.get(id)?.label === 'AI');
      setKbId(aiKb ?? kbs[0] ?? '');
      setScoped('');
    }
  }, [model, kbs, kbId]);

  const currentKb = model.get(kbId) || (kbs[0] ? model.get(kbs[0]) : undefined);
  const graphRoot = currentKb;
  const searchActive = hasQuery || Boolean(scoped.trim());

  useEffect(() => {
    setCollapsed(new Set());
  }, [graphRoot?.id]);

  const visible = useMemo(
    () => graphRoot ? collectVisible(model, graphRoot.id, scoped, hasQuery, collapsed) : new Set<string>(),
    [model, graphRoot, scoped, hasQuery, collapsed]
  );
  const layout = useMemo(
    () => graphRoot ? buildTreeLayout(model, graphRoot.id, visible) : null,
    [model, graphRoot, visible]
  );

  const resetViewport = (): void => {
    const container = containerRef.current;
    if (!container || !layout || !graphRoot) return;
    const root = layout.byId.get(graphRoot.id);
    if (!root) return;
    const availableWidth = Math.max(320, container.clientWidth - 140);
    const availableHeight = Math.max(260, container.clientHeight - 140);
    const readableOverviewHeight = Math.min(layout.height, 3600);
    const scale = clamp(
      Math.min(availableWidth / layout.width, availableHeight / readableOverviewHeight),
      RESET_MIN_SCALE,
      0.88
    );
    setViewport({
      x: 48 - root.x * scale,
      y: container.clientHeight / 2 - (root.y + root.height / 2) * scale,
      scale,
    });
  };

  const zoomBy = (factor: number): void => {
    const container = containerRef.current;
    if (!container) return;
    const px = container.clientWidth / 2;
    const py = container.clientHeight / 2;
    setViewport((current) => {
      const nextScale = clamp(current.scale * factor, MIN_SCALE, MAX_SCALE);
      const worldX = (px - current.x) / current.scale;
      const worldY = (py - current.y) / current.scale;
      return {
        scale: nextScale,
        x: px - worldX * nextScale,
        y: py - worldY * nextScale,
      };
    });
  };

  const focusNode = (id: string): void => {
    const container = containerRef.current;
    const target = layout?.byId.get(id);
    if (!container || !target) return;
    setViewport((current) => ({
      ...current,
      x: Math.min(96, container.clientWidth * 0.34 - (target.x + target.width / 2) * current.scale),
      y: container.clientHeight / 2 - (target.y + target.height / 2) * current.scale,
    }));
  };

  const toggleCollapsed = (id: string): void => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openNode = (node: GNode): void => {
    if (node.entryId) onOpen(node.entryId);
  };

  const handleCardKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>, node: GNode): void => {
    if (!node.entryId || (event.target as HTMLElement).closest('[data-node-toggle]')) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onOpen(node.entryId);
  };

  useEffect(() => {
    const timer = window.setTimeout(resetViewport, 50);
    return () => window.clearTimeout(timer);
  }, [layout, graphRoot?.id, immersive]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? container.clientHeight : 1;
      const dx = event.deltaX * unit;
      const dy = event.deltaY * unit;
      const shouldPan = event.shiftKey || (Math.abs(dx) > Math.abs(dy) * 1.35 && !event.ctrlKey && !event.metaKey);
      if (!shouldPan) {
        const rect = container.getBoundingClientRect();
        const px = event.clientX - rect.left;
        const py = event.clientY - rect.top;
        setViewport((current) => {
          const nextScale = clamp(current.scale * Math.exp(-dy * 0.0018), MIN_SCALE, MAX_SCALE);
          const worldX = (px - current.x) / current.scale;
          const worldY = (py - current.y) / current.scale;
          return {
            scale: nextScale,
            x: px - worldX * nextScale,
            y: py - worldY * nextScale,
          };
        });
      } else {
        setViewport((current) => ({
          ...current,
          x: current.x - dx,
          y: current.y - dy,
        }));
      }
    };

    let threeFingerCenter: { x: number; y: number } | null = null;
    const touchCenter = (touches: TouchList): { x: number; y: number } => {
      let x = 0;
      let y = 0;
      for (let i = 0; i < touches.length; i++) {
        x += touches[i].clientX;
        y += touches[i].clientY;
      }
      return { x: x / touches.length, y: y / touches.length };
    };
    const handleTouchStart = (event: TouchEvent): void => {
      if (event.touches.length !== 3) return;
      threeFingerCenter = touchCenter(event.touches);
      event.preventDefault();
    };
    const handleTouchMove = (event: TouchEvent): void => {
      if (event.touches.length !== 3) {
        threeFingerCenter = null;
        return;
      }
      const next = touchCenter(event.touches);
      if (threeFingerCenter) {
        const dx = next.x - threeFingerCenter.x;
        const dy = next.y - threeFingerCenter.y;
        setViewport((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
      }
      threeFingerCenter = next;
      event.preventDefault();
    };
    const handleTouchEnd = (event: TouchEvent): void => {
      threeFingerCenter = event.touches.length === 3 ? touchCenter(event.touches) : null;
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    container.addEventListener('touchstart', handleTouchStart, { passive: false });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd);
    container.addEventListener('touchcancel', handleTouchEnd);
    return () => {
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [layout, graphRoot?.id]);

  const cycleKbRef = useRef<(direction: number) => void>(() => undefined);
  cycleKbRef.current = (direction: number) => {
    if (!kbs.length) return;
    const index = Math.max(0, kbs.indexOf(currentKb?.id ?? kbs[0]));
    setKbId(kbs[(index + direction + kbs.length) % kbs.length]);
    setScoped('');
  };

  const metaRef = useRef<{ code: string | null; other: boolean }>({ code: null, other: false });
  useEffect(() => {
    if (!immersive) return;
    const down = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        event.preventDefault();
        setImmersive(false);
        return;
      }
      if (event.key === 'Meta') metaRef.current = { code: event.code, other: false };
      else metaRef.current.other = true;
    };
    const up = (event: KeyboardEvent): void => {
      if (event.key !== 'Meta') return;
      const state = metaRef.current;
      if (state.code && !state.other) {
        if (state.code === 'MetaLeft') searchRef.current?.focus();
        else if (state.code === 'MetaRight') cycleKbRef.current(1);
      }
      metaRef.current = { code: null, other: false };
    };
    document.addEventListener('keydown', down, true);
    document.addEventListener('keyup', up, true);
    return () => {
      document.removeEventListener('keydown', down, true);
      document.removeEventListener('keyup', up, true);
    };
  }, [immersive]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('[data-mind-card]')) return;
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      originX: viewport.x,
      originY: viewport.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setViewport((current) => ({
      ...current,
      x: drag.originX + event.clientX - drag.x,
      y: drag.originY + event.clientY - drag.y,
    }));
  };
  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const chip = (active: boolean): CSSProperties => ({
    padding: '6px 13px',
    borderRadius: 8,
    border: '1px solid var(--bd)',
    cursor: 'pointer',
    fontSize: 12.5,
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
    background: active ? 'var(--fg)' : 'transparent',
    color: active ? 'var(--bg)' : 'var(--mut)',
    fontWeight: active ? 600 : 400,
  });
  const utilityButton: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 12px',
    fontSize: 13,
    fontFamily: 'inherit',
    cursor: 'pointer',
    background: 'var(--panel)',
    color: 'var(--mut)',
    border: '1px solid var(--bd)',
    borderRadius: 9,
    whiteSpace: 'nowrap',
  };

  if (!currentKb || !graphRoot || !layout) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--mut)', fontSize: 13 }}>暂无可展示的知识树</div>;
  }

  const toolbar = (
    <div style={{ marginBottom: 10, flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--mut)', marginRight: 2 }}>知识库</span>
          {kbs.map((id) => (
            <button key={id} style={chip(id === currentKb.id)} onClick={() => { setKbId(id); setScoped(''); }}>{model.get(id)!.label}</button>
          ))}
          <span style={{ width: 1, height: 18, background: 'var(--bd)', margin: '0 5px' }} />
          <span style={{ fontSize: 12, color: 'var(--mut)', marginRight: 2 }}>专题定位</span>
          {currentKb.children.map((id) => (
            <button key={id} style={chip(false)} onClick={() => focusNode(id)} title={`定位到 ${model.get(id)!.label}`}>
              {model.get(id)!.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ position: 'relative', minWidth: 190 }}>
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--mut)', fontSize: 13 }}>⌕</span>
            <input
              ref={searchRef}
              value={scoped}
              onChange={(event) => setScoped(event.target.value)}
              placeholder={`在「${graphRoot.label}」地图内搜索…`}
              spellCheck={false}
              style={{ width: '100%', padding: '8px 12px 8px 30px', fontSize: 13, fontFamily: 'inherit', color: 'var(--fg)', background: 'var(--panel)', border: '1px solid var(--bd)', borderRadius: 9, outline: 'none' }}
            />
          </div>
          <button style={{ ...utilityButton, minWidth: 34, justifyContent: 'center', padding: '8px 10px' }} onClick={() => zoomBy(0.82)} title="缩小画布">−</button>
          <button style={utilityButton} onClick={resetViewport} title="适配画布并回到根节点">⌖ {Math.round(viewport.scale * 100)}%</button>
          <button style={{ ...utilityButton, minWidth: 34, justifyContent: 'center', padding: '8px 10px' }} onClick={() => zoomBy(1.18)} title="放大画布">＋</button>
          <button style={utilityButton} onClick={() => setImmersive((value) => !value)} title={immersive ? '退出沉浸模式 (Esc)' : '沉浸模式'}>
            {immersive ? '⤡ 退出' : '⤢ 沉浸'}
          </button>
        </div>
      </div>
      {immersive && (
        <div style={{ marginTop: 8, display: 'flex', gap: 16, fontSize: 12, color: 'var(--mut)' }}>
          <span>拖拽 / 三指移动</span>
          <span>滚轮 / 捏合 / −＋ 缩放</span>
          <span>Shift+滚轮平移</span>
          <span>左 ⌘ 搜索</span>
          <span>右 ⌘ 切换知识库</span>
          <span>点击专题卡看详情</span>
          <span>Esc 退出</span>
        </div>
      )}
    </div>
  );

  const canvas = (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={{
        position: 'relative',
        width: '100%',
        flex: immersive ? 1 : undefined,
        minHeight: 0,
        height: immersive ? undefined : '72vh',
        overflow: 'hidden',
        border: '1px solid var(--bd)',
        borderRadius: 16,
        backgroundColor: 'var(--panel)',
        backgroundImage: 'radial-gradient(var(--bd) 1px, transparent 1px)',
        backgroundSize: '24px 24px',
        cursor: dragging ? 'grabbing' : 'grab',
        touchAction: 'none',
        userSelect: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: layout.width,
          height: layout.height,
          transformOrigin: '0 0',
          transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.scale})`,
          transition: dragging ? 'none' : 'transform 180ms cubic-bezier(.2,.8,.2,1)',
          willChange: 'transform',
        }}
      >
        <svg width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}>
          {layout.nodes.map((target) => {
            if (!target.node.parentId) return null;
            const source = layout.byId.get(target.node.parentId);
            if (!source) return null;
            return (
              <path
                key={`edge-${target.node.id}`}
                d={connectorPath(source, target)}
                fill="none"
                stroke={t.bd}
                strokeWidth={target.depth === 1 ? 2 : 1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>

        {layout.nodes.map((placed) => {
          const root = placed.depth === 0;
          const leaf = placed.depth >= 2;
          const actualChildCount = placed.node.children.length;
          const visibleChildCount = placed.node.children.filter((id) => visible.has(id)).length;
          const canToggle = actualChildCount > 0;
          const isCollapsed = collapsed.has(placed.node.id) && !searchActive;
          return (
            <div
              key={placed.node.id}
              data-mind-card
              role={placed.node.entryId ? 'button' : undefined}
              tabIndex={placed.node.entryId ? 0 : -1}
              className="ik-mind-card"
              onClick={() => openNode(placed.node)}
              onKeyDown={(event) => handleCardKeyDown(event, placed.node)}
              style={{
                position: 'absolute',
                left: placed.x,
                top: placed.y,
                width: placed.width,
                height: placed.height,
                padding: root ? '24px 26px' : leaf ? '16px 18px' : '18px 20px',
                border: root ? `1px solid ${t.fg}` : `1px solid ${t.bd}`,
                borderRadius: root ? 22 : leaf ? 14 : 17,
                background: root ? t.fg : leaf ? t.sel : t.panel,
                color: root ? t.bg : t.fg,
                boxShadow: root ? '0 22px 50px rgba(0,0,0,.18)' : '0 8px 24px rgba(0,0,0,.055)',
                textAlign: 'left',
                fontFamily: 'inherit',
                cursor: placed.node.entryId ? 'pointer' : 'default',
                overflow: 'hidden',
              }}
              aria-label={`查看 ${placed.node.label}`}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: root ? 14 : 9 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: root ? 11.5 : 10.5, fontWeight: 650, letterSpacing: '.07em', textTransform: 'uppercase', color: root ? t.bg : t.mut, opacity: root ? 0.72 : 1 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: root ? t.bg : t.fg, opacity: root ? 1 : 0.75 }} />
                  {root ? (placed.node.meta?.join(' · ') || currentKb.label) : placed.depth === 1 ? '知识树分类' : placed.depth === 2 ? '考查维度' : '高频问题'}
                </span>
                {canToggle && (
                  <button
                    type="button"
                    data-node-toggle
                    aria-label={searchActive ? `${placed.node.label}：检索中自动展开` : isCollapsed ? `展开 ${placed.node.label}` : `收起 ${placed.node.label}`}
                    aria-expanded={searchActive ? true : !isCollapsed}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (!searchActive) toggleCollapsed(placed.node.id);
                    }}
                    style={{
                      minWidth: searchActive ? 46 : 38,
                      height: 24,
                      padding: '0 8px',
                      borderRadius: 99,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 5,
                      border: `1px solid ${root ? 'rgba(255,255,255,.14)' : t.bd}`,
                      background: root ? 'rgba(255,255,255,.11)' : t.bg,
                      color: root ? t.bg : t.mut,
                      fontFamily: 'inherit',
                      fontSize: 10.5,
                      fontWeight: 700,
                      cursor: searchActive ? 'default' : 'pointer',
                      opacity: searchActive ? 0.76 : 1,
                    }}
                    title={searchActive ? '检索中自动展开' : isCollapsed ? '展开子节点' : '收起子节点'}
                  >
                    <span>{searchActive ? '自动' : isCollapsed ? '＋' : '−'}</span>
                    {!searchActive && <span>{isCollapsed ? actualChildCount : visibleChildCount}</span>}
                  </button>
                )}
              </div>
              <div style={{ fontSize: root ? 28 : leaf ? 14 : 16, lineHeight: root ? 1.08 : 1.25, fontWeight: root ? 760 : 700, letterSpacing: root ? '-.025em' : '-.01em', marginBottom: placed.node.sub ? (root ? 13 : 7) : 0 }}>
                {placed.node.label}
              </div>
              {placed.node.sub && (
                <div style={{ fontSize: root ? 13.5 : leaf ? 11.5 : 12.5, lineHeight: root ? 1.55 : 1.5, color: root ? t.bg : t.mut, opacity: root ? 0.76 : 1, overflowWrap: 'anywhere' }}>
                  {placed.node.sub}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ position: 'absolute', right: 14, bottom: 12, padding: '6px 9px', borderRadius: 8, background: 'color-mix(in srgb, var(--panel) 88%, transparent)', border: '1px solid var(--bd)', color: 'var(--mut)', fontSize: 10.5, pointerEvents: 'none' }}>
        {layout.nodes.length} 个节点 · {searchActive ? '检索中自动展开' : '点击节点右上角收起/展开'}
      </div>
    </div>
  );

  const wrapStyle: CSSProperties = immersive
    ? { position: 'fixed', inset: 0, zIndex: 45, background: 'var(--bg)', display: 'flex', flexDirection: 'column', padding: '16px 20px' }
    : {};

  return (
    <div style={wrapStyle}>
      {toolbar}
      {canvas}
    </div>
  );
}
