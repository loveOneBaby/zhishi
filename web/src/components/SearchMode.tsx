import { useEffect, useMemo, useRef } from 'react';
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

export default function SearchMode(
  { query, results, sel, viewType, theme, selectedEntry, selectedId, onOpen, onOpenAI, kbs, folders }: Props
) {
  const isList = viewType === 'list';
  const isCanvas = viewType === 'canvas';
  const hasQuery = query.trim().length > 0;
  const selClamped = Math.min(sel, Math.max(0, results.length - 1));
  const noMatch = hasQuery && results.length === 0;
  const kbNameOf = useMemo(() => new Map(kbs.map((k) => [k.id, k.name] as const)), [kbs]);

  // 当前高亮行(键盘 ↑↓ 或点击)滚动进可视区
  const activeRowRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selClamped, selectedId]);

  return (
    <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', paddingTop: 16 }}>
      {isList && (
        <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 0.8fr) minmax(540px, 1.35fr)', gap: 22, alignItems: 'stretch', paddingBottom: 18 }}>
          <div style={{ border: '1px solid var(--bd)', borderRadius: 14, background: 'var(--panel)', overflow: 'hidden', height: '100%', overflowY: 'auto' }}>
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
              results.map((item, index) => {
                const active = item.id === selectedId || (!selectedId && index === selClamped);
                const path = folderPathName(folders, item.folderId);
                return (
                  <div
                    key={item.id}
                    ref={active ? activeRowRef : undefined}
                    className={`ik-result-row ${active ? 'is-active' : ''}`}
                    onClick={() => onOpen(item.id, index)}
                    style={{
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
              })
            )}
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
