import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  CSSProperties,
  ReactNode,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import type { Entry, Theme, Folder, KnowledgeBase } from '../types';
import { highlightText } from '../highlight';
import { renderMd } from '../markdown';
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
const KEY_GRID_LABELS = '1234567890QWERTYUIOPASDFGHJKLZXCVBNM'.split('');

export default function CanvasView({ entries, folders, kbs: kbList, theme: t, onOpen, hasQuery, query }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; originX: number; originY: number } | null>(null);

  const { map: model, kbs } = useMemo(() => buildModel(entries, folders, kbList), [entries, folders, kbList]);
  const [kbId, setKbId] = useState('');
  const [scoped, setScoped] = useState('');
  const [immersive, setImmersive] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [viewport, setViewport] = useState<Viewport>({ x: 48, y: 48, scale: 0.9 });
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [showFullTree, setShowFullTree] = useState(false);
  const [keyGridOpen, setKeyGridOpen] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const FIXED_SCALE = 0.9; // 保持约 90% 缩放，避免字太小

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
  // 关键点网格：展示当前知识库「整棵树」的全部关键点（不受折叠 / 深度限制影响）
  const keyPointItems = useMemo(
    () => {
      if (!graphRoot) return [];
      const items: { id: string; label: string; depth: number }[] = [];
      const walk = (id: string, depth: number): void => {
        const node = model.get(id);
        if (!node) return;
        // 关键点网格只收录知识点 / 索引，跳过文件夹节点
        if (node.type !== 'cat' && node.type !== 'folder') items.push({ id, label: node.label, depth });
        for (const child of node.children) walk(child, depth + 1);
      };
      for (const child of graphRoot.children) walk(child, 1);
      return items.slice(0, 240).map((item, index) => ({
        id: item.id,
        label: item.label,
        kind: item.depth === 1 ? '专题' : item.depth === 2 ? '维度' : '面试点',
        key: KEY_GRID_LABELS[index % KEY_GRID_LABELS.length],
      }));
    },
    [model, graphRoot]
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
  const focusKeyPoint = (id: string): void => {
    setKeyGridOpen(false);
    if (layout?.byId.has(id)) {
      window.setTimeout(() => focusNode(id), 0);
      return;
    }
    // 目标当前被折叠 / 超出可见深度：先展开全部，再在布局更新后定位
    pendingFocusRef.current = id;
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

  const collapseAllNodes = (): void => {
    setKeyGridOpen(false);
    setShowFullTree(false);
    setCollapsed(new Set(collapsibleNodeIds));
  };

  const expandAllNodes = (): void => {
    setKeyGridOpen(false);
    setShowFullTree(true);
    setCollapsed(new Set());
  };

  const toggleCollapsed = (id: string): void => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // 点击节点：预览该处知识 + 手风琴展开（同级互斥）+ 居中（保持缩放）
  const activateNode = (node: GNode): void => {
    if (node.depth === 0) return; // 根节点（知识库）不预览/不折叠
    setPreviewId(node.id);
    if (!searchActive && node.children.length > 0) {
      setCollapsed((cur) => {
        const next = new Set(cur);
        const siblings = node.parentId ? (model.get(node.parentId)?.children ?? []) : [];
        const branchSiblings = siblings.filter((sid) => sid !== node.id && (model.get(sid)?.children.length ?? 0) > 0);
        const selfOpen = !next.has(node.id);
        const othersOpen = branchSiblings.some((sid) => !next.has(sid));
        if (selfOpen && !othersOpen) {
          next.add(node.id); // 同级仅自己展开时，再次点击则收起
        } else {
          next.delete(node.id); // 展开自己
          for (const sid of branchSiblings) next.add(sid); // 收起同级其它
        }
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

  // 预览面板：渲染某节点的内容及其下级（索引末端即知识点内容）
  const renderPreviewNode = (id: string, depth: number): ReactNode => {
    const node = model.get(id);
    if (!node) return null;
    return (
      <div key={id} style={{ marginTop: depth === 0 ? 0 : 12, paddingLeft: depth <= 1 ? 0 : 12, borderLeft: depth <= 1 ? 'none' : '2px solid var(--bd)' }}>
        {depth > 0 && <div style={{ fontWeight: 700, fontSize: depth === 1 ? 14 : 13, margin: '0 0 5px' }}>{node.label}</div>}
        {(node.sub ?? '').trim() ? <div style={{ fontSize: 13, lineHeight: 1.75 }}>{renderMd(node.sub ?? '')}</div> : null}
        {node.children.map((c) => renderPreviewNode(c, depth + 1))}
      </div>
    );
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
          <button style={utilityButton} onClick={collapseAllNodes} title="收起当前知识树的全部下级分支">
            − 收起全部
          </button>
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
            title="查看关键知识点并点击定位"
          >
            ⌘ 关键点
          </button>
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
          <span>收起/展开全部</span>
          <span>关键点网格定位</span>
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
          const cardClickable = !root; // 非根节点均可点击：预览 + 展开/收起
          const isPreviewing = previewId === placed.node.id;
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
                padding: root ? '24px 26px' : leaf ? '16px 18px' : '18px 20px',
                border: isPreviewing ? `2px solid ${t.accent}` : root ? `1px solid ${t.fg}` : `1px solid ${t.bd}`,
                borderRadius: root ? 22 : leaf ? 14 : 17,
                background: root ? t.fg : leaf ? t.sel : t.panel,
                color: root ? t.bg : t.fg,
                boxShadow: root ? '0 22px 50px rgba(0,0,0,.18)' : '0 8px 24px rgba(0,0,0,.055)',
                textAlign: 'left',
                fontFamily: 'inherit',
                cursor: cardClickable ? 'pointer' : 'default',
                overflow: 'hidden',
              }}
              aria-label={cardClickable ? `${isCollapsed ? '展开' : '收起'} ${placed.node.label}` : placed.node.label}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: root ? 14 : 9 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: root ? 11.5 : 10.5, fontWeight: 650, letterSpacing: '.07em', textTransform: 'uppercase', color: root ? t.bg : t.mut, opacity: root ? 0.72 : 1 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: root ? t.bg : t.fg, opacity: root ? 1 : 0.75 }} />
                  {root ? (placed.node.meta?.join(' · ') || currentKb.label) : placed.node.type === 'folder' ? '文件夹' : placed.node.type === 'entry' ? '知识点' : placed.depth === 2 ? '考查维度' : '高频问题'}
                </span>
                {canToggle && !root && (
                  <button
                    type="button"
                    data-node-toggle
                    aria-label={searchActive ? `${placed.node.label}：搜索态只展示关键链路` : isCollapsed ? `展开 ${placed.node.label}` : `收起 ${placed.node.label}`}
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
                    title={searchActive ? '搜索态只展示关键链路' : isCollapsed ? '展开子节点' : '收起子节点'}
                  >
                    <span>{searchActive ? '链路' : isCollapsed ? '＋' : '−'}</span>
                    {!searchActive && <span>{isCollapsed ? actualChildCount : visibleChildCount}</span>}
                  </button>
                )}
              </div>
              <div style={{ fontSize: root ? 28 : leaf ? 14 : 16, lineHeight: root ? 1.08 : 1.25, fontWeight: root ? 760 : 700, letterSpacing: root ? '-.025em' : '-.01em', marginBottom: placed.node.sub ? (root ? 13 : 7) : 0 }}>
                {highlightText(placed.node.label, activeQuery)}
              </div>
              {placed.node.sub && (
                <div style={{ fontSize: root ? 13.5 : leaf ? 11.5 : 12.5, lineHeight: root ? 1.55 : 1.5, color: root ? t.bg : t.mut, opacity: root ? 0.76 : 1, overflowWrap: 'anywhere' }}>
                  {highlightText(placed.node.sub, activeQuery)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ position: 'absolute', right: 14, bottom: 12, padding: '6px 9px', borderRadius: 8, background: 'color-mix(in srgb, var(--panel) 88%, transparent)', border: '1px solid var(--bd)', color: 'var(--mut)', fontSize: 10.5, pointerEvents: 'none' }}>
        {layout.nodes.length} 个节点 · {searchActive ? '只显示命中关键链路' : '点击节点：预览知识 + 展开（同级互斥）'}
      </div>

      {previewId && model.get(previewId) && (() => {
        const node = model.get(previewId)!;
        const entry = node.entryId ? entries.find((e) => e.id === node.entryId) : undefined;
        const kind = node.type === 'folder' ? '文件夹' : node.type === 'entry' ? '知识点' : node.depth === 2 ? '二级索引' : node.depth === 3 ? '三级索引' : '四级索引';
        const intro = node.type === 'entry' ? (entry?.intro ?? '') : '';
        const hasBody = Boolean(intro.trim()) || Boolean((node.sub ?? '').trim()) || node.children.length > 0;
        // 索引路径（从知识库一路到当前节点的上一级）
        const pathLabels: string[] = [];
        let pcur = node.parentId;
        while (pcur) { const p = model.get(pcur); if (!p) break; pathLabels.unshift(p.label); pcur = p.parentId; }
        return (
          <div
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{ position: 'absolute', top: 14, right: 14, bottom: 14, width: 'min(380px, 42%)', zIndex: 9, display: 'flex', flexDirection: 'column', overflow: 'hidden', border: '1px solid var(--bd)', borderRadius: 18, background: 'color-mix(in srgb, var(--panel) 92%, transparent)', boxShadow: '0 24px 60px rgba(0,0,0,.2)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', animation: 'ik-pop .16s ease' }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '16px 18px', borderBottom: '1px solid var(--bd)' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11, color: 'var(--mut)', marginBottom: 5, lineHeight: 1.5, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
                  {pathLabels.map((lbl, i) => (
                    <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      {i > 0 && <span style={{ opacity: 0.5 }}>/</span>}
                      <span>{lbl}</span>
                    </span>
                  ))}
                  <span style={{ marginLeft: pathLabels.length ? 4 : 0, padding: '1px 7px', border: '1px solid var(--bd)', borderRadius: 6 }}>{kind}</span>
                </div>
                <div style={{ fontSize: 18, fontWeight: 760, letterSpacing: '-.01em', lineHeight: 1.2 }}>{node.label}</div>
              </div>
              <button onClick={() => setPreviewId(null)} style={{ ...utilityButton, padding: '6px 10px', flexShrink: 0 }}>关闭</button>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: '14px 18px', fontSize: 13.5 }}>
              {intro.trim() ? <div style={{ marginBottom: 14, color: 'var(--mut)', lineHeight: 1.7 }}>{renderMd(intro)}</div> : null}
              {renderPreviewNode(node.id, 0)}
              {!hasBody && <div style={{ color: 'var(--mut)', fontSize: 12.5 }}>（该索引暂无内容，可在「管理」中补充）</div>}
            </div>
          </div>
        );
      })()}

      {keyGridOpen && (
        <div
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
                关键知识点
              </div>
              <div style={{ marginTop: 5, fontSize: 12.5, color: 'var(--mut)' }}>
                点击格子定位到画布节点 · 当前显示 {keyPointItems.length} 个
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

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))',
              gap: 12,
              maxHeight: 'min(54vh, 520px)',
              overflow: 'auto',
              paddingRight: 3,
            }}
          >
            {keyPointItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => focusKeyPoint(item.id)}
                title={`定位到 ${item.label}`}
                style={{
                  position: 'relative',
                  minHeight: 78,
                  padding: '13px 14px 22px',
                  border: '1px solid color-mix(in srgb, var(--bd) 86%, white)',
                  borderRadius: 15,
                  background: 'color-mix(in srgb, var(--sel) 68%, transparent)',
                  color: 'var(--fg)',
                  fontFamily: 'inherit',
                  textAlign: 'left',
                  cursor: 'pointer',
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,.14), 0 10px 24px rgba(0,0,0,.055)',
                }}
              >
                <span style={{ display: 'block', fontSize: 10.5, color: 'var(--mut)', marginBottom: 7 }}>{item.kind}</span>
                <span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', fontSize: 14.5, lineHeight: 1.25, fontWeight: 720 }}>
                  {highlightText(item.label, activeQuery)}
                </span>
                <span style={{ position: 'absolute', right: 9, bottom: 7, fontSize: 10.5, color: 'var(--mut)', fontWeight: 760 }}>{item.key}</span>
              </button>
            ))}
          </div>
        </div>
      )}
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
