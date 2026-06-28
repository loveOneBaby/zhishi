import { useEffect, useMemo, useRef, useState } from 'react';
import type { Entry, Theme, KnowledgeBase, Folder } from '../types';
import { folderPathName } from '../tree';
import type { SearchSuggestion } from '../search';
import { highlightText } from '../highlight';
import CanvasView from './CanvasView';
import DetailSidePanel from './DetailSidePanel';

interface Props {
  query: string;
  onInput: (v: string) => void;
  results: Entry[];
  suggestions: SearchSuggestion[];
  sugSel: number;
  onSugHover: (i: number) => void;
  onSugActivate: (i: number) => void;
  onSummon: () => void;
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
  kbs: KnowledgeBase[];
  folders: Folder[];
  searchKb: string | null;
  onScopeKb: (id: string | null) => void;
}

const RESULT_ROW_HEIGHT = 74;
const RESULT_OVERSCAN = 8;

export default function SearchMode(
  { query, results, suggestions, sel, viewType, theme, selectedEntry, selectedId, onOpen, onOpenAI, onSuggest, kbs, folders, searchKb }: Props
) {
  const isList = viewType === 'list';
  const isCanvas = viewType === 'canvas';
  const hasQuery = query.trim().length > 0;
  const selClamped = Math.min(sel, Math.max(0, results.length - 1));
  const noMatch = hasQuery && results.length === 0;
  const kbNameOf = useMemo(() => new Map(kbs.map((k) => [k.id, k.name] as const)), [kbs]);
  const activeIndex = selectedId ? results.findIndex((entry) => entry.id === selectedId) : selClamped;
  const listRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const visibleStart = Math.max(0, Math.floor(scrollTop / RESULT_ROW_HEIGHT) - RESULT_OVERSCAN);
  const visibleEnd = Math.min(results.length, Math.ceil((scrollTop + viewportHeight) / RESULT_ROW_HEIGHT) + RESULT_OVERSCAN);
  const visibleResults = results.slice(visibleStart, visibleEnd);
  const topPad = visibleStart * RESULT_ROW_HEIGHT;
  const bottomPad = Math.max(0, (results.length - visibleEnd) * RESULT_ROW_HEIGHT);
  const suggestionChips = hasQuery ? suggestions.filter((item) => item.value !== query).slice(0, 5) : [];
  const scopedKbName = searchKb ? kbNameOf.get(searchKb) : null;

  useEffect(() => {
    if (!isList) return undefined;
    const el = listRef.current;
    if (!el) return undefined;
    const update = (): void => setViewportHeight(el.clientHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [isList]);

  useEffect(() => {
    if (!isList) return;
    const el = listRef.current;
    if (!el || activeIndex < 0) return;
    const rowTop = activeIndex * RESULT_ROW_HEIGHT;
    const rowBottom = rowTop + RESULT_ROW_HEIGHT;
    if (rowTop < el.scrollTop) el.scrollTop = rowTop;
    else if (rowBottom > el.scrollTop + el.clientHeight) el.scrollTop = rowBottom - el.clientHeight;
  }, [activeIndex, isList, results.length]);

  return (
    <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', paddingTop: 16 }}>
      {isList && (
        <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 0.8fr) minmax(540px, 1.35fr)', gap: 22, alignItems: 'stretch', paddingBottom: 18 }}>
          <div className="ik-results-panel">
            <div className="ik-search-result-head">
              <span>{hasQuery ? `找到 ${results.length} 条` : `共 ${results.length} 条`}{scopedKbName ? ` · ${scopedKbName}` : ''}</span>
              {suggestionChips.length > 0 && (
                <div className="ik-search-suggest-chips">
                  {suggestionChips.map((suggestion) => (
                    <button type="button" key={`${suggestion.kind}-${suggestion.value}`} onClick={() => onSuggest(suggestion)}>
                      <b>{suggestion.kind}</b>{suggestion.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div
              ref={listRef}
              className="ik-results-scroll"
              onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
            >
            {results.length === 0 ? (
              noMatch ? (
                <div onClick={onOpenAI} style={{ padding: 26, cursor: 'pointer', textAlign: 'center' }}>
                  <div style={{ fontSize: 14, marginBottom: 6 }}>没有匹配「<span style={{ fontWeight: 600 }}>{query}</span>」的知识点</div>
                  <div style={{ fontSize: 13, color: 'var(--mut)' }}>按 <span style={{ fontWeight: 600, color: 'var(--fg)' }}>↵</span> 让 AI 回答</div>
                </div>
              ) : (
                <div style={{ padding: 26, textAlign: 'center', color: 'var(--mut)', fontSize: 13 }}>暂无知识点</div>
              )
            ) : (
              <>
                {topPad > 0 && <div style={{ height: topPad }} />}
                {visibleResults.map((item, offset) => {
                const index = visibleStart + offset;
                const active = item.id === selectedId || (!selectedId && index === selClamped);
                const path = folderPathName(folders, item.folderId);
                return (
                  <div
                    key={item.id}
                    className={`ik-result-row ${active ? 'is-active' : ''}`}
                    onClick={() => onOpen(item.id, index)}
                    style={{
                      height: RESULT_ROW_HEIGHT,
                      borderLeft: `3px solid ${active ? 'var(--accent)' : 'transparent'}`,
                      borderBottom: index === results.length - 1 ? 'none' : '1px solid color-mix(in srgb, var(--bd) 60%, transparent)',
                    }}
                  >
                    <div className="ik-result-main">
                      <div className="ik-result-title">{highlightText(item.title, query)}</div>
                      <div className="ik-result-summary">{highlightText(item.summary, query)}</div>
                    </div>
                    <div className="ik-result-meta">
                      <span className="ik-result-kb">{kbNameOf.get(item.kbId) ?? item.cat}</span>
                      {path && <span className="ik-result-path" title={path}>{path}</span>}
                    </div>
                  </div>
                );
              })}
                {bottomPad > 0 && <div style={{ height: bottomPad }} />}
              </>
            )}
            </div>
          </div>
          <DetailSidePanel entry={selectedEntry} query={query} />
        </div>
      )}

      {isCanvas && (
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', paddingBottom: 14 }}>
          <CanvasView entries={results} folders={folders} kbs={kbs} theme={theme} onOpen={onOpen} hasQuery={hasQuery} query={query} />
        </div>
      )}
    </div>
  );
}
