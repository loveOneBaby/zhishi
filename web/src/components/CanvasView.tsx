import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  CSSProperties,
  ReactNode,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import type { Entry, Theme, Folder, KnowledgeBase } from '../types';
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
  // 关键点 = 当前知识库下所有知识点的标签（按出现次数排序，点击可筛选画布）
  const keyPointItems = useMemo(
    () => {
      if (!graphRoot) return [];
      const kbRealId = graphRoot.id.replace(/^kb::/, '');
      const counts = new Map<string, number>();
      for (const entry of entries) {
        if (entry.kbId !== kbRealId) continue;
        for (const raw of entry.tags) {
          const tag = raw.trim();
          if (!tag) continue;
          counts.set(tag, (counts.get(tag) ?? 0) + 1);
        }
      }
      return Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hans-CN'))
        .slice(0, 240)
        .map(([tag, count]) => ({ tag, count }));
    },
    [entries, graphRoot]
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
  // 点击关键点(标签):用该标签筛选当前画布
  const searchByTag = (tag: string): void => {
    setKeyGridOpen(false);
    setScoped(tag);
    setShowFullTree(true);
    setCollapsed(new Set());
  };

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

  const toolbar = (
    <div style={{ marginBottom: 10, flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13.5, fontWeight: 740 }}>{graphRoot.label}</span>
        <span style={{ fontSize: 12, color: 'var(--mut)', marginRight: 4 }}>{layout.nodes.length} 个节点</span>
        <button style={{ ...utilityButton, minWidth: 34, justifyContent: 'center', padding: '8px 10px' }} onClick={() => zoomBy(0.82)} title="缩小画布">−</button>
        <button style={utilityButton} onClick={resetViewport} title="适配画布并回到根节点">⌖ {Math.round(viewport.scale * 100)}%</button>
        <button style={{ ...utilityButton, minWidth: 34, justifyContent: 'center', padding: '8px 10px' }} onClick={() => zoomBy(1.18)} title="放大画布">＋</button>
        <button style={utilityButton} onClick={collapseAllNodes} title="收起当前知识树的全部下级分支">− 收起全部</button>
        <button
          style={{
            ...utilityButton,
            background: showFullTree && !searchActive ? 'var(--sel)' : utilityButton.background,
            color: showFullTree && !searchActive ? 'var(--fg)' : utilityButton.color,
          }}
          onClick={expandAllNodes}
          title="展开当前知识树的全部节点"
        >
          ＋ 展开全部
        </button>
        <button
          style={{
            ...utilityButton,
            background: keyGridOpen ? 'var(--fg)' : utilityButton.background,
            color: keyGridOpen ? 'var(--bg)' : utilityButton.color,
            fontWeight: keyGridOpen ? 650 : 400,
          }}
          onClick={() => setKeyGridOpen((value) => !value)}
          title="查看关键点(标签)"
        >
          ⌘ 关键点
        </button>
        <span style={{ fontSize: 11.5, color: 'var(--mut)', marginLeft: 'auto', whiteSpace: 'nowrap' }}>按 F 进入沉浸 · 双指滚动平移</span>
      </div>
      {immersive && (
        <div style={{ marginTop: 8, display: 'flex', gap: 16, fontSize: 12, color: 'var(--mut)' }}>
          <span>拖拽 / 双指滚动平移</span>
          <span>捏合 / ⌘+滚轮 / −＋ 缩放</span>
          <span>右 ⌘ 切换知识库</span>
          <span>关键点筛选</span>
          <span>知识点根节点看详情</span>
          <span>F 切换沉浸 · Esc 退出</span>
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
                padding: root ? '22px 24px' : leaf ? '11px 14px' : '13px 16px',
                border: isPreviewing ? `2px solid ${t.accent}` : root ? `1px solid ${t.fg}` : isEntry ? `1px solid color-mix(in srgb, ${t.accent} 55%, ${t.bd})` : `1px solid ${t.bd}`,
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                {isEntry && <span style={{ width: 7, height: 7, borderRadius: '50%', background: t.accent, flexShrink: 0 }} />}
                <div style={{ fontSize: root ? 26 : leaf ? 13 : 14.5, lineHeight: root ? 1.1 : 1.28, fontWeight: root ? 760 : 700, letterSpacing: root ? '-.025em' : '-.01em', marginBottom: root && placed.node.sub ? 10 : 0 }}>
                  {highlightText(placed.node.label, activeQuery)}
                </div>
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

      {keyGridOpen && (
        <div
          data-canvas-overlay
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          style={{
            position: 'absolute',
            inset: '22px 22px auto 22px',
            maxHeight: 'calc(100% - 44px)',
            zIndex: 8,
            border: '1px solid color-mix(in srgb, var(--bd) 78%, white)',
            borderRadius: 24,
            background: 'color-mix(in srgb, var(--panel) 82%, transparent)',
            boxShadow: '0 28px 80px rgba(0,0,0,.18)',
            backdropFilter: 'blur(18px)',
            WebkitBackdropFilter: 'blur(18px)',
            padding: 22,
            animation: 'ik-pop .16s ease',
            overflow: 'hidden',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 18 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 22, fontWeight: 760, letterSpacing: '-.02em' }}>
                <span style={{ width: 9, height: 9, borderRadius: 99, background: 'var(--accent)' }} />
                关键点（标签）
              </div>
              <div style={{ marginTop: 5, fontSize: 12.5, color: 'var(--mut)' }}>
                当前知识库共 {keyPointItems.length} 个标签 · 点击标签筛选画布
              </div>
            </div>
            <button
              type="button"
              onClick={() => setKeyGridOpen(false)}
              style={{ ...utilityButton, padding: '8px 11px', background: 'var(--sel)' }}
            >
              关闭
            </button>
          </div>

          {keyPointItems.length === 0 ? (
            <div style={{ padding: '28px 8px', textAlign: 'center', color: 'var(--mut)', fontSize: 13 }}>
              当前知识库的知识点还没有标签。在编辑知识点时添加标签即可在这里聚合。
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 10,
                maxHeight: 'min(54vh, 520px)',
                overflow: 'auto',
                paddingRight: 3,
              }}
            >
              {keyPointItems.map((item) => (
                <button
                  key={item.tag}
                  type="button"
                  onClick={() => searchByTag(item.tag)}
                  title={`用「${item.tag}」筛选画布`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 7,
                    padding: '9px 14px',
                    border: '1px solid color-mix(in srgb, var(--bd) 86%, white)',
                    borderRadius: 999,
                    background: 'color-mix(in srgb, var(--sel) 68%, transparent)',
                    color: 'var(--fg)',
                    fontFamily: 'inherit',
                    fontSize: 13.5,
                    fontWeight: 640,
                    cursor: 'pointer',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,.14), 0 8px 18px rgba(0,0,0,.05)',
                  }}
                >
                  {highlightText(item.tag, activeQuery)}
                  <span style={{ fontSize: 11, color: 'var(--mut)', fontWeight: 600 }}>{item.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );

  const wrapStyle: CSSProperties = immersive
    ? { position: 'fixed', inset: 0, zIndex: 45, background: 'var(--bg)', display: 'flex', flexDirection: 'column', padding: '16px 20px' }
    : { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' };

  // 点击知识点 → 右侧大预览(脱离画布,原生 BlockNote 渲染,链接可点)
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

  return (
    <div style={wrapStyle}>
      {toolbar}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 14 }}>
        {canvas}
        {previewEntry && (
          <div style={{ width: 'min(540px, 42%)', flexShrink: 0, minWidth: 0 }}>
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
      </div>
    </div>
  );
}
