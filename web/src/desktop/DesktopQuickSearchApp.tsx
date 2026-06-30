import { useEffect, useMemo, useRef, useState } from 'react';
import SearchBox from '../components/SearchBox';
import { apiGetKey } from '../api/client';
import { fetchBootstrap } from '../api/bootstrap';
import { filterEntries, suggestQueries, type SearchSuggestion } from '../search';
import { highlightText } from '../highlight';
import { renderMd } from '../markdown';
import { THEMES, themeVars } from '../themes';
import type { Entry, Folder, KbCategory, KnowledgeBase } from '../types';

const maxResults = 80;
const favoriteKbLimit = 8;
const theme = THEMES.mono;

function initialKeyPointOpen(): boolean {
  const hashQuery = window.location.hash.split('?')[1] ?? '';
  return new URLSearchParams(hashQuery).get('kp') === '1';
}

function renderNode(node: Entry['nodes'][number], query: string, depth = 0): JSX.Element {
  return (
    <section className={depth ? 'ik-dqs-node is-child' : 'ik-dqs-node'} key={node.id}>
      <h3>{node.title || '未命名小节'}</h3>
      {node.content?.trim() ? <div className="ik-dqs-md">{renderMd(node.content, query)}</div> : null}
      {node.children.map((child) => renderNode(child, query, depth + 1))}
    </section>
  );
}

function DetailPane({ entry, query, loading }: { entry: Entry | null; query: string; loading: boolean }) {
  if (loading) {
    return (
      <aside className="ik-surface ik-dqs-detail">
        <div className="ik-dqs-empty">正在加载知识点...</div>
      </aside>
    );
  }
  if (!entry) {
    return (
      <aside className="ik-surface ik-dqs-detail">
        <div className="ik-dqs-empty">选择左侧知识点，在这里查看完整内容</div>
      </aside>
    );
  }

  return (
    <aside className="ik-surface ik-dqs-detail">
      <div className="ik-dqs-detail-head">
        <h2>{highlightText(entry.title, query)}</h2>
        <div className="ik-dqs-tags">
          {[entry.cat, ...entry.tags].filter(Boolean).slice(0, 8).map((tag) => (
            <span key={tag}>{highlightText(tag, query)}</span>
          ))}
        </div>
        {entry.summary ? <p>{highlightText(entry.summary, query)}</p> : null}
      </div>
      <div className="ik-dqs-detail-body">
        {entry.intro?.trim() ? <div className="ik-dqs-intro">{renderMd(entry.intro, query)}</div> : null}
        {entry.nodes?.length ? entry.nodes.map((node) => renderNode(node, query)) : (
          <div className="ik-dqs-empty">这个知识点暂无结构化详情。</div>
        )}
      </div>
    </aside>
  );
}

function FavoriteKbBar({
  kbs,
  searchKb,
  onSelect,
  onClear,
}: {
  kbs: KnowledgeBase[];
  searchKb: string | null;
  onSelect: (id: string) => void;
  onClear: () => void;
}) {
  const favoriteKbs = useMemo(
    () => [...kbs]
      .filter((kb) => Boolean(kb.favorite))
      .sort((a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name, 'zh-Hans-CN'))
      .slice(0, favoriteKbLimit),
    [kbs],
  );

  if (favoriteKbs.length === 0) return null;

  return (
    <div className="ik-dqs-favorites" aria-label="收藏知识库">
      <span className="ik-dqs-fav-label">收藏</span>
      <div className="ik-dqs-fav-chips">
        <button
          type="button"
          className={`ik-dqs-fav-chip ${searchKb ? '' : 'is-active'}`}
          onClick={onClear}
          title="搜索全部知识库"
        >
          全部
        </button>
        {favoriteKbs.map((kb) => (
          <button
            type="button"
            key={kb.id}
            className={`ik-dqs-fav-chip ${searchKb === kb.id ? 'is-active' : ''}`}
            onClick={() => onSelect(kb.id)}
            title={kb.name}
          >
            {kb.name}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function DesktopQuickSearchApp() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [kbCategories, setKbCategories] = useState<KbCategory[]>([]);
  const [query, setQuery] = useState('');
  const [searchKb, setSearchKb] = useState<string | null>(null);
  const [kpOpen, setKpOpen] = useState(initialKeyPointOpen);
  const [viewType, setViewType] = useState<'list' | 'canvas'>('list');
  const [selected, setSelected] = useState(0);
  const [selectedEntry, setSelectedEntry] = useState<Entry | null>(null);
  const [selectedLoading, setSelectedLoading] = useState(false);
  const detailSeq = useRef(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const selectedRowRef = useRef<HTMLButtonElement | null>(null);

  const scopedEntries = useMemo(
    () => (searchKb ? entries.filter((entry) => entry.kbId === searchKb) : entries),
    [entries, searchKb],
  );
  const results = useMemo(
    () => filterEntries(scopedEntries, query).slice(0, maxResults),
    [scopedEntries, query],
  );
  const suggestions = useMemo(() => suggestQueries(scopedEntries, query), [scopedEntries, query]);
  const kbNameOf = useMemo(() => new Map(kbs.map((kb) => [kb.id, kb.name] as const)), [kbs]);

  async function openEntry(id: string, index?: number): Promise<void> {
    if (typeof index === 'number') setSelected(index);
    const seq = ++detailSeq.current;
    setSelectedLoading(true);
    try {
      const entry = await apiGetKey<Entry>(`/entries/${encodeURIComponent(id)}`, 'entry');
      if (seq !== detailSeq.current) return;
      setSelectedEntry(entry);
    } catch (err) {
      if (seq !== detailSeq.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === detailSeq.current) setSelectedLoading(false);
    }
  }

  function focusInput(): void {
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  function handleScopeKb(id: string | null): void {
    setSearchKb(id);
    setKpOpen(false);
    setQuery((current) => (current.startsWith('.') || current.startsWith('。') ? '' : current));
    focusInput();
  }

  function handleSuggest(suggestion: SearchSuggestion): void {
    setQuery(suggestion.value);
    if (suggestion.entryId) {
      const index = results.findIndex((entry) => entry.id === suggestion.entryId);
      void openEntry(suggestion.entryId, index >= 0 ? index : undefined);
    }
  }

  useEffect(() => {
    let cancelled = false;
    fetchBootstrap()
      .then((data) => {
        if (cancelled) return;
        setEntries(data.entries || []);
        setKbs(data.kbs || []);
        setFolders(data.folders || []);
        setKbCategories(data.kbCategories || []);
        setError('');
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          focusInput();
        }
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setSelected(0);
    if (results[0]) void openEntry(results[0].id, 0);
    else setSelectedEntry(null);
  }, [query, searchKb, loading]);

  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selected, results.length]);

  useEffect(() => {
    const onCommand = (event: Event): void => {
      const detail = (event as CustomEvent<{ type?: string; open?: boolean }>).detail;
      if (detail?.type === 'keypoints') {
        setKpOpen((current) => (detail.open ? true : !current));
      } else {
        setKpOpen(false);
      }
      focusInput();
    };
    window.addEventListener('ikDesktopQuickSearchCommand', onCommand);
    return () => window.removeEventListener('ikDesktopQuickSearchCommand', onCommand);
  }, []);

  function handleKeyDown(event: React.KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      window.close();
      return;
    }
    if (kpOpen) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = Math.min(selected + 1, Math.max(0, results.length - 1));
      setSelected(next);
      if (results[next]) void openEntry(results[next].id, next);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const next = Math.max(0, selected - 1);
      setSelected(next);
      if (results[next]) void openEntry(results[next].id, next);
      return;
    }
    if (event.key === 'Enter' && results[selected]) {
      event.preventDefault();
      void openEntry(results[selected].id, selected);
    }
  }

  const resultCountLabel = query.trim() ? `找到 ${results.length} 条` : `共 ${results.length} 条`;
  const scopedName = searchKb ? kbNameOf.get(searchKb) : null;
  const visibleSuggestions = query.trim() ? suggestions.filter((item) => item.value !== query).slice(0, 5) : [];

  return (
    <div
      className="ik-dqs-root ik-theme-mono"
      style={themeVars(theme)}
      onKeyDown={handleKeyDown}
    >
      <style>{desktopQuickSearchCss}</style>
      <section className="ik-dqs-shell" role="dialog" aria-label="桌面知识检索">
        <div className="ik-dqs-top">
          <SearchBox
            query={query}
            onQuery={setQuery}
            onClear={() => setQuery('')}
            kbs={kbs}
            categories={kbCategories}
            searchKb={searchKb}
            onScopeKb={handleScopeKb}
            inputRef={inputRef}
            kpEntries={scopedEntries}
            kpOpen={kpOpen}
            setKpOpen={setKpOpen}
            onPickTag={(tag) => { setQuery(tag); setKpOpen(false); }}
            viewType={viewType}
            onViewType={setViewType}
            doubleCommandEnabled={false}
            showScopeButton
            keyPointShortcutLabel="Alt+J"
          />
          <button type="button" className="ik-dqs-close" onClick={() => window.close()} aria-label="关闭">关闭</button>
        </div>

        <FavoriteKbBar
          kbs={kbs}
          searchKb={searchKb}
          onSelect={handleScopeKb}
          onClear={() => handleScopeKb(null)}
        />

        {error ? <div className="ik-dqs-error">{error}</div> : null}
        {loading ? <div className="ik-dqs-loading">正在连接知识库...</div> : null}

        <div className="ik-dqs-body">
          <div className="ik-results-panel">
            <div className="ik-search-result-head">
              <span>{resultCountLabel}{scopedName ? ` · ${scopedName}` : ''}</span>
              {visibleSuggestions.length > 0 && (
                <div className="ik-search-suggest-chips">
                  {visibleSuggestions.map((suggestion) => (
                    <button type="button" key={`${suggestion.kind}-${suggestion.value}`} onClick={() => handleSuggest(suggestion)}>
                      <b>{suggestion.kind}</b>{suggestion.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="ik-results-scroll">
              {results.length === 0 ? (
                <div className="ik-dqs-empty">{query.trim() ? `没有匹配「${query}」的知识点` : '输入关键词开始搜索'}</div>
              ) : results.map((entry, index) => {
                const active = index === selected;
                return (
                  <button
                    type="button"
                    key={entry.id}
                    ref={active ? selectedRowRef : undefined}
                    className={`ik-result-row ${active ? 'is-active' : ''}`}
                    onMouseEnter={() => setSelected(index)}
                    onClick={() => void openEntry(entry.id, index)}
                  >
                    <span className="ik-result-title">{highlightText(entry.title, query)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <DetailPane entry={selectedEntry} query={query} loading={selectedLoading} />
        </div>
        <div className="ik-dqs-footer">Alt+K 呼出/收起，Alt+J 关键点，↑ ↓ 切换，Enter 查看，Esc 关闭。输入 . 或 。选择知识库。</div>
      </section>
    </div>
  );
}

const desktopQuickSearchCss = `
  html, body, #root {
    width: 100%;
    height: 100%;
    margin: 0;
    overflow: hidden;
    background: transparent !important;
  }
  body {
    font-family: var(--font);
    -webkit-font-smoothing: antialiased;
  }
  .ik-dqs-root,
  .ik-dqs-root * {
    box-sizing: border-box;
  }
  .ik-dqs-root {
    width: 100vw;
    height: 100vh;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 10px;
    color: var(--fg);
    background: transparent;
  }
  .ik-dqs-shell {
    width: 100%;
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    border: 1px solid rgba(24,24,27,.16);
    border-radius: 13px;
    background: rgba(251,251,250,.86);
    box-shadow: 0 18px 54px rgba(0,0,0,.20);
  }
  .ik-dqs-top {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
    align-items: center;
  }
  .ik-searchbox {
    height: 36px;
    gap: 7px;
    padding: 0 7px 0 11px;
    border-radius: 10px;
    background: rgba(255,255,255,.78);
  }
  .ik-searchbox-wrap {
    min-width: 0;
  }
  .ik-searchbox-input {
    font-size: 13px;
  }
  .ik-searchbox-icon svg {
    width: 15px;
    height: 15px;
  }
  .ik-searchbox-btn {
    height: 24px;
    min-width: 24px;
    padding: 0 7px;
    border-radius: 7px;
    font-size: 11px;
  }
  .ik-scope-chip {
    height: 24px;
    border-radius: 7px;
  }
  .ik-scope-name {
    height: 20px;
    font-size: 11px;
  }
  .ik-kp-popover,
  .ik-kb-picker {
    background: rgba(255,255,255,.94);
  }
  .ik-dqs-root .ik-kp-anchor {
    position: static;
  }
  .ik-dqs-root .ik-kp-trigger.is-active {
    border-color: color-mix(in srgb, var(--accent) 24%, var(--bd));
    background: color-mix(in srgb, var(--accent) 12%, rgba(255,255,255,.8));
    color: var(--accent);
  }
  .ik-dqs-root .ik-kp-trigger.is-active:hover {
    background: color-mix(in srgb, var(--accent) 16%, rgba(255,255,255,.9));
    color: var(--accent);
  }
  .ik-dqs-root .ik-kp-popover {
    position: absolute;
    top: calc(100% + 7px);
    left: 0;
    right: 0;
    width: auto;
    max-height: min(386px, calc(100vh - 138px));
    padding: 10px;
    transform: none;
  }
  .ik-dqs-root .ik-kp-popover::before {
    display: none;
  }
  .ik-dqs-root .ik-kp-head {
    top: -10px;
    margin: -10px -10px 9px;
    padding: 10px 12px 9px;
  }
  .ik-dqs-root .ik-kp-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 7px;
  }
  .ik-dqs-root .ik-kp-chip {
    height: 28px;
    border-radius: 9px;
    font-size: 11.5px;
  }
  .ik-dqs-close {
    height: 36px;
    padding: 0 11px;
    border: 1px solid var(--bd);
    border-radius: 10px;
    background: rgba(255,255,255,.78);
    color: var(--mut);
    cursor: pointer;
    font: inherit;
    font-size: 12px;
    font-weight: 650;
  }
  .ik-dqs-close:hover {
    color: var(--fg);
    background: var(--sel);
  }
  .ik-searchbox-kbd,
  .ik-searchbox-divider,
  .ik-searchbox-seg {
    display: none;
  }
  .ik-dqs-favorites {
    display: flex;
    align-items: center;
    gap: 7px;
    min-height: 26px;
    overflow: hidden;
    color: var(--mut);
    font-size: 10.5px;
    font-weight: 760;
  }
  .ik-dqs-fav-label {
    flex: 0 0 auto;
    width: 28px;
    white-space: nowrap;
    line-height: 1;
  }
  .ik-dqs-fav-chips {
    min-width: 0;
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    gap: 6px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .ik-dqs-fav-chips::-webkit-scrollbar {
    display: none;
  }
  .ik-dqs-fav-chip {
    flex: 0 0 auto;
    max-width: 150px;
    height: 25px;
    padding: 0 9px;
    overflow: hidden;
    border: 1px solid rgba(24,24,27,.13);
    border-radius: 999px;
    background: rgba(255,255,255,.66);
    color: var(--mut);
    cursor: pointer;
    font: inherit;
    font-size: 11px;
    font-weight: 680;
    line-height: 23px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ik-dqs-fav-chip:hover {
    color: var(--fg);
    background: rgba(255,255,255,.9);
  }
  .ik-dqs-fav-chip.is-active {
    border-color: transparent;
    background: var(--accent);
    color: #fff;
  }
  .ik-dqs-body {
    flex: 1 1 auto;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(320px, .9fr) minmax(0, 1.1fr);
    gap: 9px;
  }
  .ik-results-panel,
  .ik-dqs-detail {
    min-height: 0;
    overflow: hidden;
    border: 1px solid rgba(24,24,27,.12);
    border-radius: 11px;
    background: rgba(255,255,255,.76);
  }
  .ik-search-result-head {
    min-height: 36px;
    padding: 6px 9px 6px 11px;
  }
  .ik-search-result-head > span {
    font-size: 11px;
  }
  .ik-search-suggest-chips button {
    height: 24px;
    max-width: 112px;
    padding: 0 7px;
    font-size: 11px;
  }
  .ik-results-scroll {
    height: 100%;
    overflow: auto;
  }
  .ik-result-row {
    width: 100%;
    display: grid;
    align-items: center;
    border: 0;
    border-bottom: 1px solid color-mix(in srgb, var(--bd) 60%, transparent);
    text-align: left;
    font: inherit;
    min-height: 46px;
    height: auto;
    padding: 8px 12px;
    grid-template-columns: minmax(0, 1fr);
    gap: 0;
  }
  .ik-result-title {
    display: -webkit-box;
    overflow: hidden;
    color: var(--fg);
    font-size: 13px;
    line-height: 1.35;
    font-weight: 760;
    text-overflow: ellipsis;
    white-space: normal;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .ik-dqs-detail {
    display: flex;
    flex-direction: column;
  }
  .ik-dqs-detail-head {
    flex-shrink: 0;
    padding: 12px 14px 9px;
    border-bottom: 1px solid color-mix(in srgb, var(--bd) 70%, transparent);
  }
  .ik-dqs-detail-head h2 {
    margin: 0;
    color: var(--fg);
    font-size: 17px;
    line-height: 1.25;
    font-weight: 780;
  }
  .ik-dqs-detail-head p {
    margin: 7px 0 0;
    color: var(--mut);
    font-size: 11.5px;
    line-height: 1.6;
  }
  .ik-dqs-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-top: 7px;
  }
  .ik-dqs-tags span {
    padding: 2px 7px;
    border: 1px solid var(--bd);
    border-radius: 999px;
    color: var(--mut);
    background: var(--sel);
    font-size: 10.5px;
    line-height: 1.2;
  }
  .ik-dqs-detail-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 12px 14px 22px;
  }
  .ik-dqs-intro,
  .ik-dqs-md {
    color: var(--fg);
    font-size: 11.5px;
    line-height: 1.68;
  }
  .ik-dqs-detail-body p,
  .ik-dqs-detail-body ul {
    font-size: 11.5px;
  }
  .ik-dqs-detail-body img {
    max-height: 260px !important;
    border-radius: 9px !important;
  }
  .ik-dqs-node {
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid color-mix(in srgb, var(--bd) 70%, transparent);
  }
  .ik-dqs-node.is-child {
    margin-left: 10px;
    padding-left: 10px;
    border-left: 2px solid color-mix(in srgb, var(--accent) 18%, transparent);
  }
  .ik-dqs-node h3 {
    margin: 0 0 6px;
    color: var(--fg);
    font-size: 12.5px;
    line-height: 1.4;
    font-weight: 720;
  }
  .ik-dqs-empty,
  .ik-dqs-loading,
  .ik-dqs-error {
    padding: 18px;
    color: var(--mut);
    font-size: 11.5px;
    line-height: 1.6;
    text-align: center;
  }
  .ik-dqs-error {
    padding: 10px 12px;
    border: 1px solid color-mix(in srgb, var(--danger) 28%, var(--bd));
    border-radius: 12px;
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 8%, var(--panel));
    text-align: left;
  }
  .ik-dqs-footer {
    color: var(--mut);
    font-size: 10.5px;
    line-height: 1.4;
    text-align: center;
  }
`;
