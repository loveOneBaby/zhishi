import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Hash, Search, X } from 'lucide-react';
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';
import type { Entry, KnowledgeBase } from '../types';

interface Props {
  query: string;
  onQuery: (v: string) => void;
  onClear: () => void;
  kbs: KnowledgeBase[];
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
}

function normalizeSearchInput(value: string): string {
  return value.replace(/、/g, '/');
}

// 顶栏搜索框:输入 "/" 唤起知识库选择,选中后检索锁定到该库;空输入按退格解除锁定。
export default function SearchBox({ query, onQuery, onClear, kbs, searchKb, onScopeKb, inputRef, kpEntries, kpOpen, setKpOpen, onPickTag, viewType, onViewType, doubleCommandEnabled = true }: Props) {
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
  const slashActive = query.startsWith('/');
  const token = slashActive ? query.slice(1).trimStart() : '';
  // 点击范围胶囊也能打开知识库选择器(切换知识库)
  const [pickerOpen, setPickerOpen] = useState(false);
  const matches = slashActive
    ? kbs.filter((k) => !token || k.name.toLowerCase().includes(token.toLowerCase()))
    : kbs;
  const open = (slashActive || pickerOpen) && kbs.length > 0;
  const [sel, setSel] = useState(0);
  useEffect(() => { setSel(0); }, [token, slashActive, pickerOpen]);
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
      if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setSel((s) => Math.min(s + 1, matches.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setSel((s) => Math.max(0, s - 1)); return; }
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); pick(matches[sel]); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onQuery(''); setPickerOpen(false); return; }
    }
    if (e.key === 'Backspace' && query === '' && searchKb) {
      e.preventDefault();
      e.stopPropagation();
      onScopeKb(null);
    }
  };

  const placeholder = scopeName ? `在「${scopeName}」中搜索…` : '搜索知识点（输入 / 选择知识库）';
  const toggleKeyPoints = (): void => {
    setPickerOpen(false);
    if (slashActive) onQuery('');
    setKpOpen((v) => !v);
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
        <span className="ik-kp-anchor">
          <button
            type="button"
            className={`ik-searchbox-btn ik-kp-trigger ${kpOpen ? 'is-active' : ''}`}
            title="关键点(标签) · ⌘/ 或 Ctrl+/"
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
                  <kbd>⌘/ Ctrl+/</kbd>
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
          <div className="ik-kb-picker-head">选择知识库 · 限定检索范围</div>
          {matches.length === 0 ? (
            <div className="ik-kb-picker-empty">没有匹配「{token}」的知识库</div>
          ) : (
            matches.map((kb, i) => {
              const active = kb.id === searchKb;
              return (
                <div
                  key={kb.id}
                  className={`ik-kb-picker-row ${i === sel ? 'is-hover' : ''} ${active ? 'is-active' : ''}`}
                  onMouseEnter={() => setSel(i)}
                  onMouseDown={(e) => { e.preventDefault(); pick(kb); }}
                >
                  <span>{kb.name}</span>
                  {active ? <b>当前</b> : i === sel ? <small>↵ 选定</small> : null}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
