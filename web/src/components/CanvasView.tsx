import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  CSSProperties,
  ReactNode,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import type { Entry, Theme, Folder, KnowledgeBase } from '../types';
import { Minus, Plus, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { highlightText } from '../highlight';
import DetailSidePanel from './DetailSidePanel';
import {
  type GNode,
  type PlacedNode,
  type TreeLayout,
  clamp,
  buildModel,
  collectVisible,
  buildTreeLayout,
  connectorPath,
} from './canvas/model';

interface Props {
  entries: Entry[];
  folders: Folder[];
  kbs: KnowledgeBase[];
  theme: Theme;
  onOpen: (id: string) => void;
  hasQuery: boolean;
  query: string;
}

interface Viewport {
  x: number;
  y: number;
  scale: number;
}

const MIN_SCALE = 0.05;
const MAX_SCALE = 1.5;

export default function CanvasView({ entries, folders, kbs: kbList, theme: t, onOpen, hasQuery, query }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; originX: number; originY: number } | null>(null);

  const { map: model, kbs } = useMemo(() => buildModel(entries, folders, kbList), [entries, folders, kbList]);
  const [kbId, setKbId] = useState('');
  const [scoped, setScoped] = useState('');
  const [immersive, setImmersive] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [viewport, setViewport] = useState<Viewport>({ x: 48, y: 48, scale: 1.1 });
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [showFullTree, setShowFullTree] = useState(false);
  const [keyGridOpen, setKeyGridOpen] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const FIXED_SCALE = 1.1; // 默认缩放,字号更舒适

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
  const activeQuery = scoped.trim() || (hasQuery ? query : '');

  useEffect(() => {
    setCollapsed(new Set());
    setShowFullTree(false);
    setPreviewId(null);
  }, [graphRoot?.id]);

  const visible = useMemo(
    () => graphRoot ? collectVisible(model, graphRoot.id, activeQuery, searchActive, collapsed, showFullTree) : new Set<string>(),
    [model, graphRoot, activeQuery, searchActive, collapsed, showFullTree]
  );
  const layout = useMemo(
    () => graphRoot ? buildTreeLayout(model, graphRoot.id, visible) : null,
    [model, graphRoot, visible]
  );
  const collapsibleNodeIds = useMemo(
    () => {
      if (!graphRoot) return [];
      const ids: string[] = [];
      const stack = [...graphRoot.children];
      while (stack.length) {
        const id = stack.pop()!;
        const node = model.get(id);
        if (!node) continue;
        if (node.children.length) ids.push(id);
        for (const child of node.children) stack.push(child);
      }
      return ids;
    },
    [model, graphRoot]
  );

  useEffect(() => {
    setKeyGridOpen(false);
  }, [graphRoot?.id, activeQuery]);

  // 固定 ~90% 缩放，把根节点放在左侧、垂直居中（不再为了塞下整棵树而缩小）
  const resetViewport = (): void => {
    const container = containerRef.current;
    if (!container || !layout || !graphRoot) return;
    const root = layout.byId.get(graphRoot.id);
    if (!root) return;
    const scale = FIXED_SCALE;
    setViewport({
      x: 64 - root.x * scale,
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

  const pendingFocusRef = useRef<string | null>(null);

  // 布局更新后，把待定位的节点居中（保持当前缩放）
  useEffect(() => {
    const id = pendingFocusRef.current;
    if (id && layout?.byId.has(id)) {
      pendingFocusRef.current = null;
      const timer = window.setTimeout(() => focusNode(id), 0);
      return () => window.clearTimeout(timer);
    }
  }, [layout]);

  // 收起/展开全部后,布局重算,需把视口复位到根节点(否则可能偏出可视区)
  const pendingResetRef = useRef(false);
  const collapseAllNodes = (): void => {
    setKeyGridOpen(false);
    setShowFullTree(false);
    setCollapsed(new Set(collapsibleNodeIds));
    pendingResetRef.current = true;
  };

  // 展开到知识点为止:把所有「知识点」节点折叠,避免展开其内部详情(详情看预览面板)
  const entryCollapseIds = useMemo(() => {
    const ids: string[] = [];
    for (const id of collapsibleNodeIds) {
      if (model.get(id)?.type === 'entry') ids.push(id);
    }
    return ids;
  }, [collapsibleNodeIds, model]);

  const expandAllNodes = (): void => {
    setKeyGridOpen(false);
    setShowFullTree(true);
    setCollapsed(new Set(entryCollapseIds));
    pendingResetRef.current = true;
  };

  useEffect(() => {
    if (!pendingResetRef.current) return;
    pendingResetRef.current = false;
    const timer = window.setTimeout(resetViewport, 0);
    return () => window.clearTimeout(timer);
  }, [layout]);

  // 全局检索词变化时,清掉画布内的标签筛选,统一由全局搜索驱动
  useEffect(() => { setScoped(''); }, [query]);

  // 快捷键 F:进入/退出沉浸模式(输入框聚焦时不触发)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== 'f' && e.key !== 'F') return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      e.preventDefault();
      setImmersive((v) => !v);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // 点击节点：只有知识点根节点展示详情；索引 / 文件夹节点只负责展开收起。
  const activateNode = (node: GNode): void => {
    if (node.depth === 0) return; // 知识库根节点不处理

    if (node.type === 'entry') {
      setPreviewId(node.id);
      pendingFocusRef.current = node.id;
      window.setTimeout(() => focusNode(node.id), 0);
      return;
    }

    if (!searchActive && node.children.length > 0) {
      setCollapsed((cur) => {
        const next = new Set(cur);
        if (next.has(node.id)) next.delete(node.id);
        else next.add(node.id);
        return next;
      });
    }
    pendingFocusRef.current = node.id;
    window.setTimeout(() => focusNode(node.id), 0);
  };

  const handleCardKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>, node: GNode): void => {
    if ((event.target as HTMLElement).closest('[data-node-toggle]')) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (node.depth === 0) return;
    event.preventDefault();
    activateNode(node);
  };

  // 仅在切换知识库 / 进出沉浸时复位视口；展开收起不再触发自动缩放
  useEffect(() => {
    const timer = window.setTimeout(resetViewport, 50);
    return () => window.clearTimeout(timer);
  }, [graphRoot?.id, immersive]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (event: WheelEvent): void => {
      // 滚动发生在浮层(预览 / 关键点)内部时,让浮层自己滚动,不平移画布
      if ((event.target as HTMLElement)?.closest?.('[data-canvas-overlay]')) return;
      // 阻止浏览器把横向滚动当成「前进/后退」导航
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? container.clientHeight : 1;
      const dx = event.deltaX * unit;
      const dy = event.deltaY * unit;
      // 触控板捏合 / ⌘ / Ctrl + 滚动 = 缩放;其余(双指滚动)= 平移
      if (event.ctrlKey || event.metaKey) {
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
        if (keyGridOpen) {
          setKeyGridOpen(false);
          return;
        }
        setImmersive(false);
        return;
      }
      if (event.key === 'Meta') metaRef.current = { code: event.code, other: false };
      else metaRef.current.other = true;
    };
    const up = (event: KeyboardEvent): void => {
      if (event.key !== 'Meta') return;
      const state = metaRef.current;
      if (state.code === 'MetaRight' && !state.other) {
        cycleKbRef.current(1);
      }
      metaRef.current = { code: null, other: false };
    };
    document.addEventListener('keydown', down, true);
    document.addEventListener('keyup', up, true);
    return () => {
      document.removeEventListener('keydown', down, true);
      document.removeEventListener('keyup', up, true);
    };
  }, [immersive, keyGridOpen]);

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

  const iconBtn: CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
    height: 30, minWidth: 30, padding: '0 8px', borderRadius: 8,
    border: '1px solid var(--bd)', background: 'var(--panel)', color: 'var(--mut)',
    cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', whiteSpace: 'nowrap',
  };
  const ctrlDivider = <span style={{ width: 1, height: 18, background: 'var(--bd)', margin: '0 2px' }} />;
  // 悬浮在画布左上角的图标控制条
  const controls = (
    <div
      data-canvas-overlay
      onPointerDown={(e) => e.stopPropagation()}
      style={{ position: 'absolute', top: 12, left: 12, zIndex: 8, display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 12, border: '1px solid var(--bd)', background: 'color-mix(in srgb, var(--panel) 86%, transparent)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', boxShadow: '0 10px 30px rgba(0,0,0,.08)' }}
    >
      <span style={{ fontSize: 12.5, fontWeight: 740, paddingLeft: 2 }}>{graphRoot.label}</span>
      <span style={{ fontSize: 11, color: 'var(--mut)' }}>{layout.nodes.length}</span>
      {ctrlDivider}
      <button style={iconBtn} onClick={() => zoomBy(0.82)} title="缩小"><Minus size={15} strokeWidth={2.1} /></button>
      <button style={iconBtn} onClick={resetViewport} title="适配并回到根节点">{Math.round(viewport.scale * 100)}%</button>
      <button style={iconBtn} onClick={() => zoomBy(1.18)} title="放大"><Plus size={15} strokeWidth={2.1} /></button>
      {ctrlDivider}
      <button style={iconBtn} onClick={collapseAllNodes} title="收起全部"><ChevronsDownUp size={15} strokeWidth={2.1} /></button>
      <button style={{ ...iconBtn, ...(showFullTree && !searchActive ? { background: 'var(--sel)', color: 'var(--fg)' } : {}) }} onClick={expandAllNodes} title="展开全部(到知识点为止)"><ChevronsUpDown size={15} strokeWidth={2.1} /></button>
    </div>
  );

  // 点击知识点 → 悬浮在画布右侧的大预览(原生 BlockNote,链接可点)
  const previewNode = previewId ? model.get(previewId) ?? null : null;
  const previewEntry = previewNode?.type === 'entry' && previewNode.entryId
    ? entries.find((e) => e.id === previewNode.entryId) ?? null
    : null;
  let previewPath = '';
  if (previewNode) {
    const labels: string[] = [];
    let p = previewNode.parentId;
    while (p) { const n = model.get(p); if (!n) break; labels.unshift(n.label); p = n.parentId; }
    previewPath = labels.join(' / ');
  }

  const canvas = (
    <div
      ref={containerRef}
      className="ik-surface"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={{
        position: 'relative',
        width: '100%',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
        border: '1px solid var(--bd)',
        borderRadius: 16,
        backgroundColor: 'var(--panel)',
        backgroundImage: 'radial-gradient(var(--bd) 1px, transparent 1px)',
        backgroundSize: '24px 24px',
        cursor: dragging ? 'grabbing' : 'grab',
        touchAction: 'none',
        overscrollBehavior: 'none',
        userSelect: 'none',
      }}
    >
      {controls}
      {previewEntry && (
        <div
          data-canvas-overlay
          onPointerDown={(e) => e.stopPropagation()}
          style={{ position: 'absolute', top: 12, right: 12, bottom: 12, width: 'min(560px, 46%)', zIndex: 9, boxShadow: '0 24px 60px rgba(0,0,0,.22)', borderRadius: 12, animation: 'ik-pop .16s ease' }}
        >
          <DetailSidePanel
            entry={previewEntry}
            query={activeQuery}
            contextLabel={previewPath || undefined}
            actions={(
              <button type="button" onClick={() => setPreviewId(null)} style={{ ...utilityButton, padding: '6px 11px' }}>关闭</button>
            )}
          />
        </div>
      )}
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
          const isEntry = placed.node.type === 'entry';   // 知识点:用强调色突出,和文件夹/索引区分
          const cardClickable = !root;
          const isPreviewing = previewId === placed.node.id && placed.node.type === 'entry';
          return (
            <div
              key={placed.node.id}
              data-mind-card
              role={cardClickable ? 'button' : undefined}
              tabIndex={cardClickable ? 0 : -1}
              className="ik-mind-card"
              onClick={() => activateNode(placed.node)}
              onKeyDown={(event) => handleCardKeyDown(event, placed.node)}
              style={{
                position: 'absolute',
                left: placed.x,
                top: placed.y,
                width: placed.width,
                height: placed.height,
                boxSizing: 'border-box',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                padding: root ? '20px 24px' : leaf ? '10px 14px' : '12px 16px',
                border: `2px solid ${isPreviewing ? t.accent : 'transparent'}`,
                borderRadius: root ? 20 : leaf ? 12 : 14,
                background: root ? t.fg : isEntry ? `color-mix(in srgb, ${t.accent} 9%, ${t.panel})` : leaf ? t.sel : t.panel,
                color: root ? t.bg : t.fg,
                boxShadow: root ? '0 22px 50px rgba(0,0,0,.18)' : '0 8px 24px rgba(0,0,0,.055)',
                textAlign: 'left',
                fontFamily: 'inherit',
                cursor: cardClickable ? 'pointer' : 'default',
                overflow: 'hidden',
              }}
              aria-label={cardClickable ? `${isEntry ? '查看详情' : '展开/收起'} ${placed.node.label}` : placed.node.label}
            >
              {root && (
                <div style={{ fontSize: 11, fontWeight: 650, letterSpacing: '.06em', textTransform: 'uppercase', color: t.bg, opacity: 0.72, marginBottom: 10 }}>
                  {placed.node.meta?.join(' · ') || currentKb.label}
                </div>
              )}
              <div style={{ fontSize: root ? 26 : leaf ? 13 : 14.5, lineHeight: root ? 1.1 : 1.32, fontWeight: root ? 760 : 700, letterSpacing: root ? '-.025em' : '-.01em', marginBottom: root && placed.node.sub ? 10 : 0 }}>
                {highlightText(placed.node.label, activeQuery)}
              </div>
              {root && placed.node.sub && (
                <div style={{ fontSize: 12.5, lineHeight: 1.55, color: t.bg, opacity: 0.76, overflowWrap: 'anywhere' }}>
                  {highlightText(placed.node.sub, activeQuery)}
                </div>
              )}
            </div>
          );
        })}
      </div>

    </div>
  );

  const wrapStyle: CSSProperties = immersive
    ? { position: 'fixed', inset: 0, zIndex: 45, background: 'var(--bg)', display: 'flex', flexDirection: 'column', padding: '16px 20px' }
    : { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' };

  return <div style={wrapStyle}>{canvas}</div>;
}
