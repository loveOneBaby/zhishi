import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Folder, Hash, Library, Search, X } from 'lucide-react';
import { Tree, type NodeRendererProps } from 'react-arborist';
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';
import type { Entry, KbCategory, KnowledgeBase } from '../types';

interface Props {
  query: string;
  onQuery: (v: string) => void;
  onClear: () => void;
  kbs: KnowledgeBase[];
  categories: KbCategory[];
  searchKb: string | null;
  onScopeKb: (id: string | null) => void;
  inputRef: RefObject<HTMLInputElement>;
  kpEntries: Entry[];
  kpOpen: boolean;
  setKpOpen: (next: boolean | ((v: boolean) => boolean)) => void;
  onPickTag: (tag: string) => void;
  viewType: 'list' | 'canvas';
  onViewType: (v: 'list' | 'canvas') => void;
  doubleCommandEnabled?: boolean;
  enableScopeShortcutPicker?: boolean;
  showScopeButton?: boolean;
  keyPointShortcutLabel?: string;
}

function normalizeSearchInput(value: string): string {
  return value.replace(/。/g, '.');
}

type KbPickerNode =
  | {
      id: string;
      type: 'category';
      name: string;
      count: number;
      children: KbPickerNode[];
      synthetic?: boolean;
    }
  | {
      id: string;
      type: 'kb';
      name: string;
      kb: KnowledgeBase;
    };

const locale = 'zh-Hans-CN';

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function bySortThenName<T extends { sort?: number; name: string }>(a: T, b: T): number {
  return (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name, locale);
}

function countKbs(nodes: KbPickerNode[]): number {
  return nodes.reduce((sum, node) => sum + (node.type === 'kb' ? 1 : node.count), 0);
}

function prepareCategoryNode(node: KbPickerNode): KbPickerNode | null {
  if (node.type === 'kb') return node;
  const children = node.children
    .map(prepareCategoryNode)
    .filter((child): child is KbPickerNode => Boolean(child));
  const count = countKbs(children);
  if (count === 0) return null;
  return { ...node, children, count };
}

function filterPickerNodes(nodes: KbPickerNode[], needle: string): KbPickerNode[] {
  if (!needle) return nodes;
  const next: KbPickerNode[] = [];
  for (const node of nodes) {
    const nameHit = node.name.toLowerCase().includes(needle);
    if (node.type === 'kb') {
      if (nameHit) next.push(node);
      continue;
    }
    const children = nameHit ? node.children : filterPickerNodes(node.children, needle);
    if (children.length > 0) next.push({ ...node, children, count: countKbs(children) });
  }
  return next;
}

function flattenPickerKbs(nodes: KbPickerNode[]): KnowledgeBase[] {
  const result: KnowledgeBase[] = [];
  const walk = (items: KbPickerNode[]): void => {
    for (const item of items) {
      if (item.type === 'kb') result.push(item.kb);
      else walk(item.children);
    }
  };
  walk(nodes);
  return result;
}

function countPickerRows(nodes: KbPickerNode[]): number {
  return nodes.reduce((sum, node) => sum + 1 + (node.type === 'category' ? countPickerRows(node.children) : 0), 0);
}

function buildKbPickerTree(categories: KbCategory[], kbs: KnowledgeBase[], token: string): KbPickerNode[] {
  const categoryNodes = new Map<string, Extract<KbPickerNode, { type: 'category' }>>();
  for (const category of [...categories].sort(bySortThenName)) {
    categoryNodes.set(category.id, {
      id: `cat:${category.id}`,
      type: 'category',
      name: category.name,
      count: 0,
      children: [],
    });
  }

  const roots: KbPickerNode[] = [];
  for (const category of [...categories].sort(bySortThenName)) {
    const node = categoryNodes.get(category.id);
    if (!node) continue;
    const parent = category.parentId ? categoryNodes.get(category.parentId) : null;
    if (parent && parent.id !== node.id) parent.children.push(node);
    else roots.push(node);
  }

  const uncategorized: KbPickerNode[] = [];
  for (const kb of [...kbs].sort(bySortThenName)) {
    const kbNode: KbPickerNode = { id: `kb:${kb.id}`, type: 'kb', name: kb.name, kb };
    const categoryNode = kb.categoryId ? categoryNodes.get(kb.categoryId) : null;
    if (categoryNode) categoryNode.children.push(kbNode);
    else uncategorized.push(kbNode);
  }

  if (uncategorized.length > 0) {
    roots.push({
      id: 'cat:__uncategorized',
      type: 'category',
      name: categories.length > 0 ? '未分类' : '全部知识库',
      count: 0,
      children: uncategorized,
      synthetic: true,
    });
  }

  const prepared = roots
    .map(prepareCategoryNode)
    .filter((node): node is KbPickerNode => Boolean(node));
  return filterPickerNodes(prepared, normalizeToken(token));
}

// 顶栏搜索框:默认输入 "." / "。" 唤起知识库选择,选中后检索锁定到该库;空输入按退格解除锁定。
export default function SearchBox({
  query,
  onQuery,
  onClear,
  kbs,
  categories,
  searchKb,
  onScopeKb,
  inputRef,
  kpEntries,
  kpOpen,
  setKpOpen,
  onPickTag,
  viewType,
  onViewType,
  doubleCommandEnabled = true,
  enableScopeShortcutPicker = true,
  showScopeButton = false,
  keyPointShortcutLabel = '⌘/ Ctrl+/',
}: Props) {
  const kpTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of kpEntries) for (const raw of e.tags) { const t = raw.trim(); if (t) counts.set(t, (counts.get(t) ?? 0) + 1); }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hans-CN'));
  }, [kpEntries]);
  useEffect(() => {
    if (!kpOpen) return;
    const close = (): void => setKpOpen(false);
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setKpOpen(false); };
    document.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('click', close); document.removeEventListener('keydown', onKey); };
  }, [kpOpen, setKpOpen]);
  const scopeName = searchKb ? (kbs.find((k) => k.id === searchKb)?.name ?? null) : null;
  const scopeShortcutActive = enableScopeShortcutPicker && (query.startsWith('.') || query.startsWith('。'));
  const token = scopeShortcutActive ? query.slice(1).trimStart() : '';
  // 点击范围胶囊也能打开知识库选择器(切换知识库)
  const [pickerOpen, setPickerOpen] = useState(false);
  const open = (scopeShortcutActive || pickerOpen) && kbs.length > 0;
  const pickerTree = useMemo(() => buildKbPickerTree(categories, kbs, token), [categories, kbs, token]);
  const visibleKbs = useMemo(() => flattenPickerKbs(pickerTree), [pickerTree]);
  const pickerRows = useMemo(() => countPickerRows(pickerTree), [pickerTree]);
  const pickerTreeHeight = Math.min(320, Math.max(92, pickerRows * 34));
  const [sel, setSel] = useState(0);
  useEffect(() => { setSel(0); }, [token, scopeShortcutActive, pickerOpen]);
  useEffect(() => {
    setSel((current) => Math.min(current, Math.max(0, visibleKbs.length - 1)));
  }, [visibleKbs.length]);
  useEffect(() => {
    if (kpOpen) setPickerOpen(false);
  }, [kpOpen]);

  // 选择器(点胶囊)打开时,点外部关闭
  useEffect(() => {
    if (!pickerOpen) return;
    const close = (): void => setPickerOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [pickerOpen]);

  const pick = (kb?: KnowledgeBase): void => {
    if (!kb) return;
    onScopeKb(kb.id);
    onQuery('');
    setPickerOpen(false);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (open) {
      if (visibleKbs.length === 0) {
        if (['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); return; }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onQuery(''); setPickerOpen(false); return; }
      }
      if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setSel((s) => Math.min(s + 1, visibleKbs.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setSel((s) => Math.max(0, s - 1)); return; }
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); pick(visibleKbs[sel]); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onQuery(''); setPickerOpen(false); return; }
    }
    if (e.key === 'Backspace' && query === '' && searchKb) {
      e.preventDefault();
      e.stopPropagation();
      onScopeKb(null);
    }
  };

  const placeholder = scopeName
    ? `在「${scopeName}」中搜索…`
    : enableScopeShortcutPicker
      ? '搜索知识点（输入 . 或 。选择知识库）'
      : '搜索知识点';
  const toggleKeyPoints = (): void => {
    setPickerOpen(false);
    if (scopeShortcutActive) onQuery('');
    setKpOpen((v) => !v);
  };
  const selectedKbId = visibleKbs[sel]?.id ?? null;

  const PickerTreeNode = ({ node, style }: NodeRendererProps<KbPickerNode>) => {
    const data = node.data;
    const isCategory = data.type === 'category';
    const active = data.type === 'kb' && data.kb.id === searchKb;
    const highlighted = data.type === 'kb' && data.kb.id === selectedKbId;
    const hasChildren = Boolean(isCategory && node.children?.length);

    return (
      <div style={style} className="ik-kb-picker-node-shell">
        <div
          className={[
            'ik-kb-picker-node',
            isCategory ? 'is-category' : 'is-kb',
            active ? 'is-active' : '',
            highlighted ? 'is-hover' : '',
          ].filter(Boolean).join(' ')}
          onMouseEnter={() => {
            if (data.type === 'kb') {
              const index = visibleKbs.findIndex((kb) => kb.id === data.kb.id);
              if (index >= 0) setSel(index);
            }
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (data.type === 'category') {
              if (hasChildren) node.toggle();
              return;
            }
            pick(data.kb);
          }}
        >
          {isCategory ? (
            <>
              <span className="ik-kb-picker-node-toggle" aria-hidden="true">
                {hasChildren ? (node.isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : null}
              </span>
              <span className="ik-kb-picker-node-icon" aria-hidden="true">
                <Folder size={15} strokeWidth={2.05} />
              </span>
              <span className="ik-kb-picker-node-name">{data.name}</span>
              <span className="ik-kb-picker-node-count">{data.count}</span>
            </>
          ) : (
            <>
              <span className="ik-kb-picker-node-spacer" aria-hidden="true" />
              <span className="ik-kb-picker-node-icon" aria-hidden="true">
                <Library size={15} strokeWidth={2.05} />
              </span>
              <span className="ik-kb-picker-node-name">{data.name}</span>
              {active ? <span className="ik-kb-picker-node-state">当前</span> : highlighted ? <span className="ik-kb-picker-node-state">↵</span> : null}
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="ik-searchbox-wrap" onClick={(e) => e.stopPropagation()}>
      <div className="ik-searchbox ik-surface">
        <span className="ik-searchbox-icon" aria-hidden="true"><Search size={17} strokeWidth={2.1} /></span>
        {scopeName && (
          <span className="ik-scope-chip">
            <button
              type="button"
              className="ik-scope-name"
              title="点击切换知识库"
              onClick={() => { setPickerOpen((v) => !v); inputRef.current?.focus(); }}
            >
              {scopeName}
              <ChevronDown size={12} strokeWidth={2.4} />
            </button>
            <button
              type="button"
              className="ik-scope-x"
              aria-label="解除知识库限定"
              onClick={() => { onScopeKb(null); setPickerOpen(false); inputRef.current?.focus(); }}
            >
              <X size={13} strokeWidth={2.4} />
            </button>
          </span>
        )}
        <input
          ref={inputRef}
          className="ik-searchbox-input"
          value={query}
          onChange={(e) => onQuery(normalizeSearchInput(e.target.value))}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
        />
        {!query && (
          <span className="ik-searchbox-kbd" title={doubleCommandEnabled ? '快速按两次 Command 进入搜索' : 'Command + K 进入搜索'}>
            {doubleCommandEnabled ? '⌘⌘' : '⌘K'}
          </span>
        )}
        {query && (
          <button type="button" className="ik-searchbox-btn" onClick={onClear} aria-label="清空">清空</button>
        )}
        {!scopeName && showScopeButton && kbs.length > 0 && (
          <button
            type="button"
            className="ik-searchbox-btn"
            title="选择知识库"
            aria-label="选择知识库"
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => { setPickerOpen((v) => !v); inputRef.current?.focus(); }}
          >
            <Library size={14} strokeWidth={2.1} />
          </button>
        )}
        <span className="ik-kp-anchor">
          <button
            type="button"
            className={`ik-searchbox-btn ik-kp-trigger ${kpOpen ? 'is-active' : ''}`}
            title={`关键点(标签) · ${keyPointShortcutLabel}`}
            aria-label="关键点"
            aria-haspopup="dialog"
            aria-expanded={kpOpen}
            onClick={toggleKeyPoints}
          >
            <Hash size={14} strokeWidth={2.2} />
          </button>
          {kpOpen && !open && (
            <div className="ik-kp-popover" role="dialog" aria-label="关键点筛选">
              <div className="ik-kp-head">
                <div className="ik-kp-title">
                  <span>关键点</span>
                  <kbd>{keyPointShortcutLabel}</kbd>
                </div>
                <b>{kpTags.length} 个</b>
              </div>
              {kpTags.length === 0 ? (
                <div className="ik-kp-empty">当前范围内的知识点还没有标签。</div>
              ) : (
                <div className="ik-kp-grid">
                  {kpTags.map(([tag, count]) => (
                    <button
                      key={tag}
                      type="button"
                      className="ik-kp-chip"
                      title={`筛选标签：${tag}`}
                      onMouseDown={(e) => { e.preventDefault(); onPickTag(tag); }}
                    >
                      <span className="ik-kp-chip-name">{tag}</span>
                      <span className="ik-kp-chip-count">{count}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </span>
        <span className="ik-searchbox-divider" aria-hidden="true" />
        <div className="ik-searchbox-seg" role="group" aria-label="视图切换">
          <button type="button" className={viewType === 'list' ? 'is-active' : ''} onClick={() => onViewType('list')}>列表</button>
          <button type="button" className={viewType === 'canvas' ? 'is-active' : ''} onClick={() => onViewType('canvas')}>画布</button>
        </div>
      </div>

      {open && (
        <div className="ik-kb-picker">
          <div className="ik-kb-picker-head">
            <span>选择知识库 · 分类树</span>
            <b>{visibleKbs.length} 个</b>
          </div>
          {pickerTree.length === 0 ? (
            <div className="ik-kb-picker-empty">没有匹配「{token}」的知识库</div>
          ) : (
            <Tree
              data={pickerTree}
              width="100%"
              height={pickerTreeHeight}
              rowHeight={34}
              indent={18}
              overscanCount={6}
              openByDefault
              idAccessor="id"
              childrenAccessor={(item) => (item.type === 'category' ? item.children : null)}
              className="ik-kb-picker-tree"
            >
              {PickerTreeNode}
            </Tree>
          )}
        </div>
      )}
    </div>
  );
}
