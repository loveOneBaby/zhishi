import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { ReactNode } from 'react';
import type { Block, Entry, IndexNode } from '../types';
import { highlightText } from '../highlight';
import BlockEditor from './BlockEditor';

interface Props {
  entry: Entry | null;
  query?: string;
  contextLabel?: string;
  actions?: ReactNode;
  loading?: boolean;
}

function ActionBar({ label, actions }: { label?: string; actions?: ReactNode }) {
  return (
    <div className="ik-action-bar">
      <span className="ik-action-spacer">
        {label && <span className="ik-action-crumb" title={label}>{label}</span>}
      </span>
      {actions}
    </div>
  );
}

interface OutlineItem {
  id: string;
  title: string;
  level: number;
  depth: number;
}

function inlineText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(inlineText).filter(Boolean).join('');
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return inlineText(obj.text ?? obj.content ?? obj.href ?? obj.url ?? '');
  }
  return '';
}

function collectDocOutline(blocks?: Block[]): OutlineItem[] {
  const out: OutlineItem[] = [];
  const walk = (list?: Block[]): void => {
    if (!Array.isArray(list)) return;
    for (const block of list) {
      if (block.type === 'heading') {
        const title = inlineText(block.content).trim();
        if (title) {
          const rawLevel = Number(block.props?.level ?? 1);
          out.push({
            id: typeof block.id === 'string' && block.id ? block.id : `heading-${out.length}`,
            title,
            level: Number.isFinite(rawLevel) ? Math.max(1, Math.min(4, rawLevel)) : 1,
            depth: 1,
          });
        }
      }
      walk(block.children);
    }
  };
  walk(blocks);
  return out;
}

function normalizeOutlineDepth(items: OutlineItem[]): OutlineItem[] {
  const stack: number[] = [];
  return items.map((item) => {
    while (stack.length && stack[stack.length - 1] >= item.level) stack.pop();
    stack.push(item.level);
    return { ...item, depth: Math.max(1, Math.min(4, stack.length)) };
  });
}

function collectNodeOutline(nodes?: IndexNode[], baseLevel = 1): OutlineItem[] {
  const out: OutlineItem[] = [];
  const walk = (list: IndexNode[] | undefined, level: number): void => {
    if (!Array.isArray(list)) return;
    for (const node of list) {
      const title = node.title.trim();
      const depth = Math.max(1, Math.min(4, level));
      if (title) out.push({ id: node.id, title, level: depth, depth });
      walk(node.children, level + 1);
    }
  };
  walk(nodes, baseLevel);
  return out;
}

function entryOutline(entry: Entry): OutlineItem[] {
  const fromDoc = collectDocOutline(entry.doc);
  return fromDoc.length ? normalizeOutlineDepth(fromDoc) : collectNodeOutline(entry.nodes);
}

function cssEscape(value: string): string {
  return window.CSS?.escape ? window.CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
}

function sameHeadingText(a: string | null | undefined, b: string): boolean {
  return (a ?? '').replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();
}

function DetailOutline({
  items,
  activeId,
  onJump,
  listRef,
}: {
  items: OutlineItem[];
  activeId: string | null;
  onJump: (index: number) => void;
  listRef: RefObject<HTMLDivElement>;
}): ReactNode {
  if (!items.length) return null;
  return (
    <nav className="ik-detail-outline" aria-label="知识点大纲">
      <div className="ik-detail-outline-head">
        <span>大纲</span>
        <b>{items.length}</b>
      </div>
      <div ref={listRef} className="ik-detail-outline-list">
        {items.map((item, index) => (
          <button
            type="button"
            key={`${item.id}-${index}`}
            className={`ik-detail-outline-item ${activeId === item.id ? 'is-active' : ''}`}
            data-outline-id={item.id}
            data-level={item.level}
            data-depth={item.depth}
            onClick={() => onJump(index)}
            title={item.title}
          >
            <span>{item.title}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

export default function DetailSidePanel({ entry, query = '', contextLabel, actions, loading = false }: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<HTMLDivElement>(null);
  const outlineListRef = useRef<HTMLDivElement>(null);
  const outline = useMemo(() => (entry ? entryOutline(entry) : []), [entry]);
  const [activeOutlineId, setActiveOutlineId] = useState<string | null>(null);

  const headingElements = useCallback((): HTMLElement[] => (
    Array.from(docRef.current?.querySelectorAll<HTMLElement>('[data-content-type="heading"]') ?? [])
  ), []);

  const headingElementFor = useCallback((item: OutlineItem | undefined, index: number): HTMLElement | null => {
    if (!item || !docRef.current) return headingElements()[index] ?? null;
    const id = cssEscape(item.id);
    const byOutlineId = docRef.current.querySelector<HTMLElement>(`[data-outline-target-id="${id}"]`);
    if (byOutlineId) return byOutlineId;
    const byId = docRef.current.querySelector<HTMLElement>(`[data-id="${id}"][data-content-type="heading"]`)
      ?? docRef.current.querySelector<HTMLElement>(`[data-id="${id}"] [data-content-type="heading"]`)
      ?? docRef.current.querySelector<HTMLElement>(`[data-node-id="${id}"][data-content-type="heading"]`)
      ?? docRef.current.querySelector<HTMLElement>(`[data-node-id="${id}"] [data-content-type="heading"]`);
    if (byId) return byId;
    return docRef.current.querySelector<HTMLElement>(`[data-node-type="blockOuter"][data-id="${id}"] [data-content-type="heading"]`)
      ?? docRef.current.querySelector<HTMLElement>(`[data-node-type="blockContainer"][data-id="${id}"] [data-content-type="heading"]`)
      ?? headingElements()[index]
      ?? headingElements().find((heading) => sameHeadingText(heading.textContent, item.title))
      ?? null;
  }, [headingElements]);

  const syncActiveOutline = useCallback((): void => {
    if (!outline.length) {
      setActiveOutlineId(null);
      return;
    }
    const body = bodyRef.current;
    const headings = headingElements();
    if (!body || !headings.length) {
      setActiveOutlineId(outline[0]?.id ?? null);
      return;
    }
    const bodyTop = body.getBoundingClientRect().top;
    const anchorLine = bodyTop + 72;
    let activeIndex = 0;
    for (let i = 0; i < outline.length; i += 1) {
      const heading = headingElementFor(outline[i], i);
      if (!heading) continue;
      if (heading.getBoundingClientRect().top <= anchorLine) activeIndex = i;
      else break;
    }
    setActiveOutlineId(outline[activeIndex]?.id ?? null);
  }, [headingElementFor, headingElements, outline]);

  useEffect(() => {
    if (!entry) {
      setActiveOutlineId(null);
      return undefined;
    }
    setActiveOutlineId(outline[0]?.id ?? null);
    if (loading || !outline.length) return undefined;
    const body = bodyRef.current;
    if (!body) return undefined;
    const onScroll = (): void => syncActiveOutline();
    const frame = window.requestAnimationFrame(syncActiveOutline);
    const later = window.setTimeout(syncActiveOutline, 160);
    body.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(later);
      body.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [entry, loading, outline, syncActiveOutline]);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body || !outline.length) return undefined;
    const syncHeight = (): void => {
      const style = window.getComputedStyle(body);
      const paddingY = Number.parseFloat(style.paddingTop || '0') + Number.parseFloat(style.paddingBottom || '0');
      const height = Math.max(140, body.clientHeight - paddingY);
      body.style.setProperty('--ik-detail-outline-height', `${height}px`);
    };
    syncHeight();
    const observer = new ResizeObserver(syncHeight);
    observer.observe(body);
    window.addEventListener('resize', syncHeight);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', syncHeight);
      body.style.removeProperty('--ik-detail-outline-height');
    };
  }, [outline.length]);

  useEffect(() => {
    if (!outline.length) return undefined;
    const markTargets = (): void => {
      headingElements().forEach((heading) => heading.removeAttribute('data-outline-target-id'));
      outline.forEach((item, index) => {
        const target = headingElementFor(item, index);
        target?.setAttribute('data-outline-target-id', item.id);
      });
    };
    const frame = window.requestAnimationFrame(markTargets);
    const timers = [
      window.setTimeout(markTargets, 80),
      window.setTimeout(markTargets, 240),
    ];
    return () => {
      window.cancelAnimationFrame(frame);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [headingElementFor, headingElements, outline]);

  useEffect(() => {
    if (!activeOutlineId) return;
    const list = outlineListRef.current;
    const active = list?.querySelector<HTMLElement>(`[data-outline-id="${cssEscape(activeOutlineId)}"]`);
    if (!list || !active) return;
    const listRect = list.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    const topOverflow = activeRect.top - listRect.top;
    const bottomOverflow = activeRect.bottom - listRect.bottom;
    if (topOverflow < 0) list.scrollTop += topOverflow - 6;
    else if (bottomOverflow > 0) list.scrollTop += bottomOverflow + 6;
  }, [activeOutlineId]);

  const jumpToOutline = useCallback((index: number): void => {
    const item = outline[index];
    if (item) setActiveOutlineId(item.id);
    const scroll = (behavior: ScrollBehavior): boolean => {
      const body = bodyRef.current;
      const target = headingElementFor(item, index);
      if (!body || !target) return false;
      const bodyTop = body.getBoundingClientRect().top;
      const targetTop = target.getBoundingClientRect().top;
      body.scrollTo({
        top: body.scrollTop + targetTop - bodyTop - 12,
        behavior,
      });
      return true;
    };
    if (scroll('smooth')) return;
    window.requestAnimationFrame(() => {
      if (!scroll('smooth')) window.setTimeout(() => scroll('auto'), 120);
    });
  }, [headingElementFor, outline]);

  if (!entry) {
    return (
      <aside
        className="ik-surface ik-detail-panel ik-detail-panel-empty"
        style={{
          position: 'relative',
          height: '100%',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          color: 'var(--mut)',
          fontSize: 13,
          textAlign: 'center',
          overflow: 'hidden',
        }}
      >
        {(contextLabel || actions) && <ActionBar label={contextLabel} actions={actions} />}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
          点击左侧知识点，在这里查看完整内容
        </div>
      </aside>
    );
  }

  return (
    <aside
      className="ik-surface ik-detail-panel"
      style={{
        position: 'relative',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {(contextLabel || actions) && <ActionBar label={contextLabel} actions={actions} />}
      <div className="ik-detail-head">
        <div className="ik-detail-title">{highlightText(entry.title, query)}</div>
        {entry.tags.length > 0 && (
          <div className="ik-detail-meta">
            <span>标签</span>
            {entry.tags.slice(0, 6).map((tag, index) => (
              <span key={tag} className="ik-detail-meta-item">
                {index > 0 && <i>/</i>}
                {highlightText(tag, query)}
              </span>
            ))}
          </div>
        )}
      </div>

      <div ref={bodyRef} className={`ik-detail-body ${outline.length ? 'has-outline' : ''}`}>
        {loading ? (
          <div className="ik-detail-loading" role="status" aria-live="polite">
            <span className="ik-detail-loading-dot" />
            <span>正在加载知识点...</span>
          </div>
        ) : (
          <div className="ik-detail-reading">
            <DetailOutline items={outline} activeId={activeOutlineId} onJump={jumpToOutline} listRef={outlineListRef} />
            <div ref={docRef} className="ik-detail-doc">
              {/* 原生 BlockNote 只读渲染:图片/表格/代码/标题等都按块原样显示 */}
              <BlockEditor key={`${entry.id}:${entry.doc ? 'full' : 'lite'}`} editable={false} initialBlocks={entry.doc} />
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
