import { useEffect, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';
import type { KnowledgeBase } from '../types';

interface Props {
  query: string;
  onQuery: (v: string) => void;
  onClear: () => void;
  kbs: KnowledgeBase[];
  searchKb: string | null;
  onScopeKb: (id: string | null) => void;
  inputRef: RefObject<HTMLInputElement>;
}

// 顶栏搜索框:输入 "/" 唤起知识库选择,选中后检索锁定到该库;空输入按退格解除锁定。
export default function SearchBox({ query, onQuery, onClear, kbs, searchKb, onScopeKb, inputRef }: Props) {
  const scopeName = searchKb ? (kbs.find((k) => k.id === searchKb)?.name ?? null) : null;
  const slashActive = query.startsWith('/');
  const token = slashActive ? query.slice(1).trimStart() : '';
  const matches = slashActive
    ? kbs.filter((k) => !token || k.name.toLowerCase().includes(token.toLowerCase()))
    : [];
  const open = slashActive && kbs.length > 0;
  const [sel, setSel] = useState(0);
  useEffect(() => { setSel(0); }, [token, slashActive]);

  const pick = (kb?: KnowledgeBase): void => {
    if (!kb) return;
    onScopeKb(kb.id);
    onQuery('');
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (open) {
      if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setSel((s) => Math.min(s + 1, matches.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setSel((s) => Math.max(0, s - 1)); return; }
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); pick(matches[sel]); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onQuery(''); return; }
    }
    if (e.key === 'Backspace' && query === '' && searchKb) {
      e.preventDefault();
      e.stopPropagation();
      onScopeKb(null);
    }
  };

  const placeholder = scopeName ? `在「${scopeName}」中搜索…` : '搜索知识点（输入 / 选择知识库）';

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 38, padding: '0 10px', background: 'var(--panel)', border: '1px solid var(--bd)', borderRadius: 10 }}>
        <span style={{ color: 'var(--mut)', fontSize: 14, flexShrink: 0 }}>⌕</span>
        {scopeName && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0, fontSize: 12.5, fontWeight: 600, color: 'var(--bg)', background: 'var(--fg)', borderRadius: 7, padding: '3px 5px 3px 9px' }}>
            {scopeName}
            <button
              type="button"
              aria-label="解除知识库限定"
              onClick={() => { onScopeKb(null); inputRef.current?.focus(); }}
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 15, height: 15, padding: 0, border: 'none', borderRadius: 999, background: 'transparent', color: 'var(--bg)', cursor: 'pointer', fontSize: 13, lineHeight: 1 }}
            >
              ×
            </button>
          </span>
        )}
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', color: 'var(--fg)', fontSize: 14, fontFamily: 'inherit' }}
        />
        {query ? (
          <button type="button" onClick={onClear} aria-label="清空" style={{ flexShrink: 0, padding: '4px 9px', borderRadius: 7, border: '1px solid var(--bd)', background: 'var(--sel)', color: 'var(--mut)', fontFamily: 'inherit', fontSize: 11.5, cursor: 'pointer' }}>清空</button>
        ) : (
          <span style={{ flexShrink: 0, color: 'var(--mut)', fontSize: 11, border: '1px solid var(--bd)', borderRadius: 6, padding: '2px 6px' }}>⌘K</span>
        )}
      </div>

      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 30, border: '1px solid var(--bd)', borderRadius: 12, background: 'var(--panel)', boxShadow: '0 20px 50px rgba(0,0,0,.16)', overflow: 'hidden', animation: 'ik-fade .12s' }}>
          <div style={{ fontSize: 11, color: 'var(--mut)', padding: '8px 12px', borderBottom: '1px solid var(--bd)' }}>选择知识库 · 限定检索范围</div>
          {matches.length === 0 ? (
            <div style={{ padding: '12px', fontSize: 13, color: 'var(--mut)' }}>没有匹配「{token}」的知识库</div>
          ) : (
            matches.map((kb, i) => (
              <div
                key={kb.id}
                onMouseEnter={() => setSel(i)}
                onMouseDown={(e) => { e.preventDefault(); pick(kb); }}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '9px 12px', cursor: 'pointer', background: i === sel ? 'var(--sel)' : 'transparent' }}
              >
                <span style={{ fontSize: 13.5, fontWeight: i === sel ? 640 : 500 }}>{kb.name}</span>
                {i === sel && <span style={{ fontSize: 11, color: 'var(--mut)' }}>↵ 选定</span>}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
