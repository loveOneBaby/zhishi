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
}

// 顶栏搜索框:输入 "/" 唤起知识库选择,选中后检索锁定到该库;空输入按退格解除锁定。
export default function SearchBox({ query, onQuery, onClear, kbs, searchKb, onScopeKb, inputRef, kpEntries, kpOpen, setKpOpen, onPickTag, viewType, onViewType }: Props) {
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

  return (
    <div style={{ position: 'relative', width: '100%' }} onClick={(e) => e.stopPropagation()}>
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
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
        />
        {query && (
          <button type="button" className="ik-searchbox-btn" onClick={onClear} aria-label="清空">清空</button>
        )}
        <button
          type="button"
          className={`ik-searchbox-btn ${kpOpen ? 'is-active' : ''}`}
          title="关键点(标签) · ⌘/"
          aria-label="关键点"
          onClick={() => setKpOpen((v) => !v)}
        >
          <Hash size={14} strokeWidth={2.2} />
        </button>
        <span className="ik-searchbox-divider" aria-hidden="true" />
        <div className="ik-searchbox-seg" role="group" aria-label="视图切换">
          <button type="button" className={viewType === 'list' ? 'is-active' : ''} onClick={() => onViewType('list')}>列表</button>
          <button type="button" className={viewType === 'canvas' ? 'is-active' : ''} onClick={() => onViewType('canvas')}>画布</button>
        </div>
      </div>

      {kpOpen && !open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 31, width: 340, maxHeight: 380, overflow: 'auto', border: '1px solid var(--bd)', borderRadius: 12, background: 'var(--panel)', boxShadow: '0 20px 50px rgba(0,0,0,.16)', padding: 12, animation: 'ik-pop .12s ease' }}>
          <div style={{ fontSize: 11.5, color: 'var(--mut)', padding: '0 2px 9px' }}>关键点 · 点击标签筛选 · 共 {kpTags.length} 个</div>
          {kpTags.length === 0 ? (
            <div style={{ padding: '14px 4px', fontSize: 13, color: 'var(--mut)' }}>当前范围内的知识点还没有标签。</div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
              {kpTags.map(([tag, count]) => (
                <button
                  key={tag}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); onPickTag(tag); }}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 999, border: '1px solid var(--bd)', background: 'color-mix(in srgb, var(--sel) 60%, transparent)', color: 'var(--fg)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
                >
                  {tag}<span style={{ fontSize: 11, color: 'var(--mut)' }}>{count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 30, border: '1px solid var(--bd)', borderRadius: 12, background: 'var(--panel)', boxShadow: '0 20px 50px rgba(0,0,0,.16)', overflow: 'hidden', animation: 'ik-fade .12s' }}>
          <div style={{ fontSize: 11, color: 'var(--mut)', padding: '8px 12px', borderBottom: '1px solid var(--bd)' }}>选择知识库 · 限定检索范围</div>
          {matches.length === 0 ? (
            <div style={{ padding: '12px', fontSize: 13, color: 'var(--mut)' }}>没有匹配「{token}」的知识库</div>
          ) : (
            matches.map((kb, i) => {
              const active = kb.id === searchKb;
              return (
                <div
                  key={kb.id}
                  onMouseEnter={() => setSel(i)}
                  onMouseDown={(e) => { e.preventDefault(); pick(kb); }}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '9px 12px', cursor: 'pointer', background: i === sel ? 'var(--sel)' : 'transparent' }}
                >
                  <span style={{ fontSize: 13.5, fontWeight: active || i === sel ? 640 : 500, color: 'var(--fg)' }}>{kb.name}</span>
                  {active ? <span style={{ fontSize: 11, color: 'var(--accent)' }}>当前 ✓</span> : i === sel ? <span style={{ fontSize: 11, color: 'var(--mut)' }}>↵ 选定</span> : null}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
