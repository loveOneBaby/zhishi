import { forwardRef, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Entry, Theme } from '../types';
import type { SearchSuggestion } from '../search';
import { seg2 } from '../ui';
import { highlightText } from '../highlight';
import CanvasView from './CanvasView';
import DetailSidePanel from './DetailSidePanel';

interface Props {
  query: string;
  onInput: (v: string) => void;
  results: Entry[];
  suggestions: SearchSuggestion[];
  sel: number;
  total: number;
  viewType: 'list' | 'canvas';
  setViewType: (v: 'list' | 'canvas') => void;
  theme: Theme;
  selectedEntry: Entry | null;
  selectedId: string | null;
  onClear: () => void;
  onSuggest: (suggestion: SearchSuggestion) => void;
  onOpen: (id: string, index?: number) => void;
  onOpenAI: () => void;
}

const rowBase: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
  borderRadius: 11, cursor: 'pointer', border: '1px solid transparent', transition: 'background .1s, border-color .1s, transform .1s',
};

const suggestionButton: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 7,
  maxWidth: '100%',
  padding: '7px 10px',
  borderRadius: 999,
  border: '1px solid var(--bd)',
  background: 'var(--panel)',
  color: 'var(--fg)',
  fontFamily: 'inherit',
  fontSize: 12.5,
  cursor: 'pointer',
};

const FOLDER_ORDER = ['前端', 'Java', 'AI', '基础', '算法', '自定义'];

interface ResultGroup {
  cat: string;
  items: { item: Entry; index: number }[];
}

function groupResults(results: Entry[]): ResultGroup[] {
  const map = new Map<string, ResultGroup>();
  results.forEach((item, index) => {
    const cat = item.cat || '未分类';
    if (!map.has(cat)) map.set(cat, { cat, items: [] });
    map.get(cat)!.items.push({ item, index });
  });
  return Array.from(map.values()).sort((a, b) => {
    const ai = FOLDER_ORDER.indexOf(a.cat);
    const bi = FOLDER_ORDER.indexOf(b.cat);
    if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    return a.cat.localeCompare(b.cat);
  });
}

function FolderIcon({ open, active }: { open: boolean; active: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        position: 'relative',
        width: 25,
        height: 18,
        borderRadius: 5,
        border: '1px solid var(--bd)',
        background: active ? 'var(--fg)' : 'var(--sel)',
        boxShadow: active ? '0 8px 18px rgba(0,0,0,.12)' : 'inset 0 1px 0 rgba(255,255,255,.25)',
        flexShrink: 0,
        transform: open ? 'translateY(1px)' : 'none',
      }}
    >
      <span
        style={{
          position: 'absolute',
          left: 3,
          top: -5,
          width: 11,
          height: 6,
          border: '1px solid var(--bd)',
          borderBottom: 0,
          borderRadius: '4px 4px 0 0',
          background: active ? 'var(--fg)' : 'var(--sel)',
        }}
      />
    </span>
  );
}

const SearchMode = forwardRef<HTMLInputElement, Props>(function SearchMode(
  { query, onInput, results, suggestions, sel, total, viewType, setViewType, theme, selectedEntry, selectedId, onClear, onSuggest, onOpen, onOpenAI },
  inputRef
) {
  const isList = viewType === 'list';
  const isCanvas = viewType === 'canvas';
  const hasQuery = query.trim().length > 0;
  const selClamped = Math.min(sel, Math.max(0, results.length - 1));
  const resultCount = hasQuery ? `${results.length} 个结果` : `共 ${total} 条知识 · 支持拼音 / 缩写检索`;
  const noMatch = hasQuery && results.length === 0;
  const groupedResults = useMemo(() => groupResults(results), [results]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setExpandedFolders(new Set(groupedResults.map((group) => group.cat)));
  }, [groupedResults]);

  useEffect(() => {
    if (!selectedEntry?.cat) return;
    setExpandedFolders((current) => {
      if (current.has(selectedEntry.cat)) return current;
      const next = new Set(current);
      next.add(selectedEntry.cat);
      return next;
    });
  }, [selectedEntry?.cat]);

  const toggleFolder = (cat: string): void => {
    setExpandedFolders((current) => {
      const next = new Set(current);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  return (
    <div style={{ padding: '28px 0 60px' }}>
      <div style={{ position: 'relative', marginBottom: 8 }}>
        <span style={{ position: 'absolute', left: 18, top: '50%', transform: 'translateY(-50%)', color: 'var(--mut)', fontSize: 17 }}>⌕</span>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => onInput(e.target.value)}
          placeholder="输入关键词、拼音或缩写…（如 bibao、scws、gc）"
          spellCheck={false}
          autoComplete="off"
          style={{ width: '100%', padding: hasQuery ? '18px 88px 18px 46px' : '18px 18px 18px 46px', fontSize: 19, fontFamily: 'inherit', color: 'var(--fg)', background: 'var(--panel)', border: '1px solid var(--bd)', borderRadius: 14, outline: 'none' }}
        />
        {hasQuery && (
          <button
            type="button"
            onClick={onClear}
            aria-label="清空输入和检索结果"
            style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', padding: '7px 12px', borderRadius: 9, border: '1px solid var(--bd)', background: 'var(--sel)', color: 'var(--mut)', fontFamily: 'inherit', fontSize: 12.5, cursor: 'pointer' }}
          >
            清空
          </button>
        )}
      </div>

      {hasQuery && suggestions.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '10px 2px 12px', animation: 'ik-fade .15s' }}>
          {suggestions.map((suggestion) => (
            <button
              key={`${suggestion.kind}-${suggestion.label}-${suggestion.hint}`}
              type="button"
              onClick={() => onSuggest(suggestion)}
              style={suggestionButton}
              title={`${suggestion.kind} · ${suggestion.hint}`}
            >
              <span style={{ fontSize: 10.5, color: 'var(--mut)', border: '1px solid var(--bd)', borderRadius: 999, padding: '1px 6px', flexShrink: 0 }}>{suggestion.kind}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{highlightText(suggestion.label, query)}</span>
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 4px 18px' }}>
        <span style={{ fontSize: 12, color: 'var(--mut)' }}>{resultCount}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {isList && (
            <span style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--mut)' }}>
              <span>点击文件夹收起/展开</span><span>↑ ↓ 选择</span><span>↵ 查看</span><span>esc 清空</span>
            </span>
          )}
          {isCanvas && (
            <span style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--mut)' }}>
              <span>三指移动画布</span><span>点击知识点查看详情</span><span>⤢ 沉浸模式</span>
            </span>
          )}
          <div style={{ display: 'flex', gap: 2, background: 'var(--sel)', padding: 3, borderRadius: 8 }}>
            <button style={seg2(isList)} onClick={() => setViewType('list')}>列表</button>
            <button style={seg2(isCanvas)} onClick={() => setViewType('canvas')}>画布</button>
          </div>
        </div>
      </div>

      {isList && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(360px, 430px)', gap: 24, alignItems: 'start' }}>
          <div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {groupedResults.map((group) => {
                const open = expandedFolders.has(group.cat);
                const activeInGroup = group.items.some(({ item, index }) => item.id === selectedId || (!selectedId && index === selClamped));
                return (
                  <section key={group.cat} style={{ animation: 'ik-fade .16s' }}>
                    <button
                      type="button"
                      onClick={() => toggleFolder(group.cat)}
                      aria-expanded={open}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '12px 14px',
                        borderRadius: 14,
                        border: `1px solid ${activeInGroup ? 'var(--bd)' : 'transparent'}`,
                        background: activeInGroup ? 'var(--sel)' : 'color-mix(in srgb, var(--panel) 72%, transparent)',
                        color: 'var(--fg)',
                        fontFamily: 'inherit',
                        textAlign: 'left',
                        cursor: 'pointer',
                        boxShadow: activeInGroup ? '0 10px 30px rgba(0,0,0,.045)' : 'none',
                      }}
                    >
                      <FolderIcon open={open} active={activeInGroup} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 15, fontWeight: 720 }}>{highlightText(group.cat, query)}</span>
                          <span style={{ color: 'var(--mut)', fontSize: 11 }}>{open ? '已展开' : '已收起'}</span>
                        </div>
                        <div style={{ marginTop: 2, fontSize: 12, color: 'var(--mut)' }}>
                          {hasQuery ? '命中文件夹' : '知识库文件夹'} · {group.items.length} 个知识点
                        </div>
                      </div>
                      <span style={{ fontSize: 12, color: activeInGroup ? 'var(--fg)' : 'var(--mut)', border: '1px solid var(--bd)', borderRadius: 999, padding: '3px 8px' }}>{group.items.length}</span>
                      <span style={{ color: 'var(--mut)', fontSize: 13 }}>{open ? '⌄' : '›'}</span>
                    </button>

                    {open && (
                      <div style={{ marginLeft: 25, padding: '7px 0 2px 18px', borderLeft: '1px solid var(--bd)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {group.items.map(({ item, index }) => {
                          const active = item.id === selectedId || (!selectedId && index === selClamped);
                          return (
                            <div
                              key={item.id}
                              onClick={() => onOpen(item.id, index)}
                              style={{ ...rowBase, background: active ? 'var(--sel)' : 'transparent', borderColor: active ? 'var(--bd)' : 'transparent', boxShadow: active ? '0 8px 24px rgba(0,0,0,.045)' : 'none' }}
                              onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'color-mix(in srgb, var(--sel) 58%, transparent)'; }}
                              onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                            >
                              <span style={{ width: 20, height: 22, border: '1px solid var(--bd)', borderRadius: 5, background: 'var(--panel)', flexShrink: 0, position: 'relative' }}>
                                <span style={{ position: 'absolute', right: -1, top: -1, width: 7, height: 7, borderLeft: '1px solid var(--bd)', borderBottom: '1px solid var(--bd)', borderRadius: '0 4px 0 3px', background: 'var(--bg)' }} />
                              </span>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 3 }}>{highlightText(item.title, query)}</div>
                                <div style={{ fontSize: 13, color: 'var(--mut)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{highlightText(item.summary, query)}</div>
                              </div>
                              <span style={{ fontSize: 11, color: 'var(--mut)', flexShrink: 0 }}>{highlightText(item.tags[0] || '', query)}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
            {noMatch && (
              <div onClick={onOpenAI} style={{ marginTop: 8, padding: 22, border: '1px dashed var(--bd)', borderRadius: 14, cursor: 'pointer', textAlign: 'center', animation: 'ik-fade .2s' }}>
                <div style={{ fontSize: 14, marginBottom: 6 }}>没有匹配「<span style={{ fontWeight: 600 }}>{query}</span>」的知识点</div>
                <div style={{ fontSize: 13, color: 'var(--mut)' }}>按 <span style={{ fontWeight: 600, color: 'var(--fg)' }}>↵</span> 让 AI 回答</div>
              </div>
            )}
          </div>
          <DetailSidePanel entry={selectedEntry} query={query} />
        </div>
      )}

      {isCanvas && <CanvasView entries={results} theme={theme} onOpen={onOpen} hasQuery={hasQuery} query={query} />}
    </div>
  );
});

export default SearchMode;
