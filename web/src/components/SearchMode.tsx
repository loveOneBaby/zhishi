import { forwardRef } from 'react';
import type { CSSProperties } from 'react';
import type { Entry, Theme } from '../types';
import { seg2 } from '../ui';
import CanvasView from './CanvasView';
import DetailSidePanel from './DetailSidePanel';

interface Props {
  query: string;
  onInput: (v: string) => void;
  results: Entry[];
  sel: number;
  total: number;
  viewType: 'list' | 'canvas';
  setViewType: (v: 'list' | 'canvas') => void;
  theme: Theme;
  selectedEntry: Entry | null;
  selectedId: string | null;
  onOpen: (id: string, index?: number) => void;
  onOpenAI: () => void;
}

const rowBase: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px',
  borderRadius: 11, cursor: 'pointer', border: '1px solid transparent', transition: 'background .1s',
};

const SearchMode = forwardRef<HTMLInputElement, Props>(function SearchMode(
  { query, onInput, results, sel, total, viewType, setViewType, theme, selectedEntry, selectedId, onOpen, onOpenAI },
  inputRef
) {
  const isList = viewType === 'list';
  const isCanvas = viewType === 'canvas';
  const hasQuery = query.trim().length > 0;
  const selClamped = Math.min(sel, Math.max(0, results.length - 1));
  const resultCount = hasQuery ? `${results.length} 个结果` : `共 ${total} 条知识 · 支持拼音 / 缩写检索`;
  const noMatch = hasQuery && results.length === 0;

  return (
    <div style={{ padding: '40px 0 60px' }}>
      <div style={{ position: 'relative', marginBottom: 8 }}>
        <span style={{ position: 'absolute', left: 18, top: '50%', transform: 'translateY(-50%)', color: 'var(--mut)', fontSize: 17 }}>⌕</span>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => onInput(e.target.value)}
          placeholder="输入关键词、拼音或缩写…（如 bibao、scws、gc）"
          spellCheck={false}
          autoComplete="off"
          style={{ width: '100%', padding: '18px 18px 18px 46px', fontSize: 19, fontFamily: 'inherit', color: 'var(--fg)', background: 'var(--panel)', border: '1px solid var(--bd)', borderRadius: 14, outline: 'none' }}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 4px 18px' }}>
        <span style={{ fontSize: 12, color: 'var(--mut)' }}>{resultCount}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {isList && (
            <span style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--mut)' }}>
              <span>↑ ↓ 选择</span><span>↵ 展开</span><span>esc 清空</span>
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {results.map((item, idx) => {
                const active = item.id === selectedId || (!selectedId && idx === selClamped);
                return (
                  <div
                    key={item.id}
                    onClick={() => onOpen(item.id, idx)}
                    style={{ ...rowBase, background: active ? 'var(--sel)' : 'transparent', borderColor: active ? 'var(--bd)' : 'transparent' }}
                    onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--sel)'; }}
                    onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <span style={{ fontSize: 11, color: 'var(--mut)', width: 40, flexShrink: 0 }}>{item.cat}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 2 }}>{item.title}</div>
                      <div style={{ fontSize: 13, color: 'var(--mut)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.summary}</div>
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--mut)', flexShrink: 0 }}>{item.tags[0] || ''}</span>
                  </div>
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
          <DetailSidePanel entry={selectedEntry} />
        </div>
      )}

      {isCanvas && <CanvasView entries={results} theme={theme} onOpen={onOpen} hasQuery={hasQuery} />}
    </div>
  );
});

export default SearchMode;
