import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import SearchBox from '../components/SearchBox';
import { filterEntries, suggestQueries, type SearchSuggestion } from '../search';
import { highlightText } from '../highlight';
import { folderPathName } from '../tree';
import { THEMES, themeVars } from '../themes';
import type { Entry, Folder, KbCategory, KnowledgeBase } from '../types';
import searchCss from '../styles/search.css?raw';

declare const chrome: {
  runtime: {
    lastError?: { message?: string };
    onMessage: {
      addListener(listener: (message: unknown) => void): void;
      removeListener(listener: (message: unknown) => void): void;
    };
    sendMessage(message: unknown, callback: (response: RuntimeResponse) => void): void;
  };
};

interface RuntimeResponse {
  ok?: boolean;
  data?: unknown;
  error?: string;
}

interface BootstrapPayload {
  entries: Entry[];
  kbs: KnowledgeBase[];
  folders: Folder[];
  kbCategories: KbCategory[];
}

interface ApiConfig {
  base: string;
}

declare global {
  interface Window {
    __IK_QUICK_SEARCH_INSTALLED__?: boolean;
  }
}

const theme = THEMES.mono;
const maxResults = 80;

function sendApi<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'ikQuickSearchApi', action, ...payload }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message || '扩展通信失败'));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error || '请求失败'));
        return;
      }
      resolve(response.data as T);
    });
  });
}

function text(value: unknown): string {
  return value == null ? '' : String(value);
}

function resolveImageSrc(src: string, apiBase: string): string {
  const value = src.trim();
  if (!value || /^\/(Users|var|private|tmp|home)\//i.test(value)) return '';
  if (/^data:image\//i.test(value) || /^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/api/')) return `${apiBase.replace(/\/api$/, '')}${value}`;
  return '';
}

function ImageFigure({ src, alt, apiBase }: { src: string; alt: string; apiBase: string }) {
  const safe = resolveImageSrc(src, apiBase);
  if (!safe) return <span className="ik-qs-muted">{alt || '图片地址不可用'}</span>;
  return (
    <figure className="ik-qs-image">
      <img src={safe} alt={alt} loading="lazy" />
      {alt ? <figcaption>{alt}</figcaption> : null}
    </figure>
  );
}

function renderInline(value: string, query: string, apiBase: string): JSX.Element[] {
  const out: JSX.Element[] = [];
  const re = /!\[([^\]]*)]\(([^)]+)\)|!\((https?:\/\/[^)]+)\)|\[([^\]]+)]\((https?:\/\/[^)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  let key = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value))) {
    if (match.index > last) {
      out.push(<span key={key++}>{highlightText(value.slice(last, match.index), query)}</span>);
    }
    if (match[2] || match[3]) {
      out.push(<ImageFigure key={key++} src={match[2] || match[3]} alt={match[1] || ''} apiBase={apiBase} />);
    } else if (match[4]) {
      out.push(<a key={key++} href={match[5]} target="_blank" rel="noreferrer">{highlightText(match[4], query)}</a>);
    } else if (match[6]) {
      out.push(<strong key={key++}>{highlightText(match[6], query)}</strong>);
    } else if (match[7]) {
      out.push(<code key={key++}>{highlightText(match[7], query)}</code>);
    }
    last = re.lastIndex;
  }
  if (last < value.length) out.push(<span key={key++}>{highlightText(value.slice(last), query)}</span>);
  return out;
}

function renderMarkdown(md: string, query: string, apiBase: string): JSX.Element[] {
  const lines = text(md).split('\n');
  const out: JSX.Element[] = [];
  let index = 0;
  let key = 0;
  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    const image = /^!\[([^\]]*)]\((.+)\)$/.exec(trimmed) || /^!\((https?:\/\/[^)]+)\)$/.exec(trimmed);
    if (image) {
      out.push(<ImageFigure key={key++} src={image[2] || image[1]} alt={image[2] ? image[1] : ''} apiBase={apiBase} />);
      index++;
      continue;
    }
    if (trimmed.startsWith('```')) {
      const code: string[] = [];
      index++;
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        code.push(lines[index]);
        index++;
      }
      index++;
      out.push(<pre key={key++} className="ik-qs-code">{code.join('\n')}</pre>);
      continue;
    }
    const heading = /^(#{2,4})\s+(.+)$/.exec(trimmed);
    if (heading) {
      out.push(<h4 key={key++} className="ik-qs-md-heading">{renderInline(heading[2], query, apiBase)}</h4>);
      index++;
      continue;
    }
    if (trimmed.startsWith('- ')) {
      const items: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith('- ')) {
        items.push(lines[index].trim().slice(2));
        index++;
      }
      out.push(
        <ul key={key++} className="ik-qs-list">
          {items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item, query, apiBase)}</li>)}
        </ul>,
      );
      continue;
    }
    if (!trimmed) {
      index++;
      continue;
    }
    out.push(<p key={key++} className="ik-qs-text">{renderInline(line, query, apiBase)}</p>);
    index++;
  }
  return out;
}

function renderNode(node: Entry['nodes'][number], query: string, apiBase: string, depth = 0): JSX.Element {
  return (
    <section className={depth ? 'ik-qs-node is-child' : 'ik-qs-node'} key={node.id}>
      <h3>{node.title || '未命名小节'}</h3>
      {node.content?.trim() ? renderMarkdown(node.content, query, apiBase) : null}
      {node.children.map((child) => renderNode(child, query, apiBase, depth + 1))}
    </section>
  );
}

function DetailPane({ entry, query, loading, apiBase }: { entry: Entry | null; query: string; loading: boolean; apiBase: string }) {
  if (loading) {
    return (
      <aside className="ik-surface ik-qs-detail">
        <div className="ik-qs-empty">正在加载知识点...</div>
      </aside>
    );
  }
  if (!entry) {
    return (
      <aside className="ik-surface ik-qs-detail">
        <div className="ik-qs-empty">选择左侧知识点，在这里查看完整内容</div>
      </aside>
    );
  }
  return (
    <aside className="ik-surface ik-qs-detail">
      <div className="ik-qs-detail-head">
        <h2>{highlightText(entry.title, query)}</h2>
        <div className="ik-qs-tags">
          {[entry.cat, ...entry.tags].filter(Boolean).slice(0, 8).map((tag) => (
            <span key={tag}>{highlightText(tag, query)}</span>
          ))}
        </div>
        {entry.summary ? <p>{highlightText(entry.summary, query)}</p> : null}
      </div>
      <div className="ik-qs-detail-body">
        {entry.intro?.trim() ? <div className="ik-qs-intro">{renderMarkdown(entry.intro, query, apiBase)}</div> : null}
        {entry.nodes?.length ? entry.nodes.map((node) => renderNode(node, query, apiBase)) : (
          <div className="ik-qs-empty">这个知识点暂无结构化详情。</div>
        )}
      </div>
    </aside>
  );
}

function QuickSearchApp() {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [kbCategories, setKbCategories] = useState<KbCategory[]>([]);
  const [apiBase, setApiBase] = useState('http://localhost:5173/api');
  const [query, setQuery] = useState('');
  const [searchKb, setSearchKb] = useState<string | null>(null);
  const [kpOpen, setKpOpen] = useState(false);
  const [viewType, setViewType] = useState<'list' | 'canvas'>('list');
  const [selected, setSelected] = useState(0);
  const [selectedEntry, setSelectedEntry] = useState<Entry | null>(null);
  const [selectedLoading, setSelectedLoading] = useState(false);
  const detailSeq = useRef(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

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

  async function ensureLoaded(): Promise<void> {
    if (loaded || loading) return;
    setLoading(true);
    setError('');
    try {
      const [config, data] = await Promise.all([
        sendApi<ApiConfig>('config'),
        sendApi<BootstrapPayload>('bootstrap'),
      ]);
      if (config.base) setApiBase(config.base);
      setEntries(data.entries || []);
      setKbs(data.kbs || []);
      setFolders(data.folders || []);
      setKbCategories(data.kbCategories || []);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function openEntry(id: string, index?: number): Promise<void> {
    if (typeof index === 'number') setSelected(index);
    const seq = ++detailSeq.current;
    setSelectedLoading(true);
    try {
      const data = await sendApi<{ entry: Entry }>('entry', { id });
      if (seq !== detailSeq.current) return;
      setSelectedEntry(data.entry);
    } catch (err) {
      if (seq !== detailSeq.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === detailSeq.current) setSelectedLoading(false);
    }
  }

  function show(): void {
    setOpen(true);
    void ensureLoaded();
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  function close(): void {
    setOpen(false);
    setKpOpen(false);
  }

  function toggle(): void {
    if (open) close();
    else show();
  }

  function toggleKeyPoints(): void {
    setOpen(true);
    void ensureLoaded();
    setKpOpen((current) => (open ? !current : true));
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  useEffect(() => {
    const listener = (message: unknown): void => {
      if ((message as { type?: string })?.type === 'ikQuickSearchToggle') toggle();
      if ((message as { type?: string })?.type === 'ikQuickSearchToggleKeyPoints') toggleKeyPoints();
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [open, loaded, loading]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        event.stopPropagation();
        toggle();
      }
      if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.key.toLowerCase() === 'j') {
        event.preventDefault();
        event.stopPropagation();
        toggleKeyPoints();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, loaded, loading]);

  useEffect(() => {
    setSelected(0);
    if (results[0]) void openEntry(results[0].id, 0);
    else setSelectedEntry(null);
  }, [query, searchKb, loaded]);

  function handleKeyDown(event: React.KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
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

  function handleSuggest(suggestion: SearchSuggestion): void {
    setQuery(suggestion.value);
    if (suggestion.entryId) {
      const index = results.findIndex((entry) => entry.id === suggestion.entryId);
      void openEntry(suggestion.entryId, index >= 0 ? index : undefined);
    }
  }

  const resultCountLabel = query.trim() ? `找到 ${results.length} 条` : `共 ${results.length} 条`;
  const scopedName = searchKb ? kbNameOf.get(searchKb) : null;
  const visibleSuggestions = query.trim() ? suggestions.filter((item) => item.value !== query).slice(0, 5) : [];

  return (
    <div
      className={`ik-qs-root ik-theme-mono ${open ? 'is-open' : ''}`}
      style={themeVars(theme)}
      onKeyDown={handleKeyDown}
    >
      <div className="ik-qs-backdrop" onMouseDown={close} />
      <section className="ik-qs-shell" role="dialog" aria-label="知识检索悬浮框">
        <div className="ik-qs-top">
          <SearchBox
            query={query}
            onQuery={setQuery}
            onClear={() => setQuery('')}
            kbs={kbs}
            categories={kbCategories}
            searchKb={searchKb}
            onScopeKb={setSearchKb}
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
          <button type="button" className="ik-qs-close" onClick={close} aria-label="关闭">关闭</button>
        </div>

        {error ? <div className="ik-qs-error">{error}</div> : null}
        {loading ? <div className="ik-qs-loading">正在连接知识库...</div> : null}

        <div className="ik-qs-body">
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
                <div className="ik-qs-empty">{query.trim() ? `没有匹配「${query}」的知识点` : '输入关键词开始搜索'}</div>
              ) : results.map((entry, index) => {
                const active = index === selected;
                const path = folderPathName(folders, entry.folderId);
                return (
                  <button
                    type="button"
                    key={entry.id}
                    className={`ik-result-row ${active ? 'is-active' : ''}`}
                    onMouseEnter={() => setSelected(index)}
                    onClick={() => void openEntry(entry.id, index)}
                  >
                    <span className="ik-result-main">
                      <span className="ik-result-title">{highlightText(entry.title, query)}</span>
                      <span className="ik-result-summary">{highlightText(entry.summary, query)}</span>
                    </span>
                    <span className="ik-result-meta">
                      <span className="ik-result-kb">{kbNameOf.get(entry.kbId) ?? entry.cat}</span>
                      {path ? <span className="ik-result-path" title={path}>{path}</span> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <DetailPane entry={selectedEntry} query={query} loading={selectedLoading} apiBase={apiBase} />
        </div>
        <div className="ik-qs-footer">Alt+K 呼出/收起，Alt+J 关键点，↑ ↓ 切换，Enter 查看，Esc 关闭。输入 . 或 。也可选择知识库。</div>
      </section>
    </div>
  );
}

function mount(): void {
  if (window.__IK_QUICK_SEARCH_INSTALLED__) return;
  window.__IK_QUICK_SEARCH_INSTALLED__ = true;

  const host = document.createElement('div');
  host.id = 'ik-quick-search-root';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; }
    ${searchCss}
    .ik-qs-root {
      position: fixed;
      inset: 0;
      display: none;
      color: var(--fg);
      font-family: var(--font);
      -webkit-font-smoothing: antialiased;
      pointer-events: none;
    }
    .ik-qs-root * { box-sizing: border-box; }
    .ik-qs-root.is-open { display: block; }
    .ik-qs-backdrop {
      position: absolute;
      inset: 0;
      background: transparent;
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
      pointer-events: auto;
    }
    .ik-qs-shell {
      position: relative;
      width: min(780px, calc(100vw - 30px));
      height: min(560px, calc(100vh - 30px));
      margin: 10px auto 0;
      display: grid;
      grid-template-rows: auto auto minmax(0, 1fr) auto;
      gap: 8px;
      padding: 10px;
      border: 1px solid rgba(24,24,27,.16);
      border-radius: 13px;
      background: rgba(251,251,250,.82);
      box-shadow: 0 18px 54px rgba(0,0,0,.20);
      pointer-events: auto;
    }
    .ik-qs-top {
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
      background: rgba(255,255,255,.92);
    }
    .ik-qs-close {
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
    .ik-qs-close:hover { color: var(--fg); background: var(--sel); }
    .ik-searchbox-kbd,
    .ik-searchbox-divider,
    .ik-searchbox-seg { display: none; }
    .ik-qs-body {
      min-height: 0;
      display: grid;
      grid-template-columns: minmax(260px, .78fr) minmax(0, 1.22fr);
      gap: 9px;
    }
    .ik-results-panel,
    .ik-qs-detail {
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
      border: 0;
      border-bottom: 1px solid color-mix(in srgb, var(--bd) 60%, transparent);
      text-align: left;
      font: inherit;
      min-height: 54px;
      height: 54px;
      padding: 8px 12px 8px 10px;
      grid-template-columns: minmax(0, 1fr) minmax(110px, 36%);
      gap: 9px;
    }
    .ik-result-main,
    .ik-result-title,
    .ik-result-summary,
    .ik-result-meta,
    .ik-result-kb,
    .ik-result-path { display: block; }
    .ik-result-path {
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--mut);
      font-size: 10.5px;
    }
    .ik-result-title {
      font-size: 12.5px;
    }
    .ik-result-summary {
      font-size: 11px;
    }
    .ik-result-kb {
      font-size: 10.5px;
      padding: 2px 6px;
    }
    .ik-qs-detail {
      display: flex;
      flex-direction: column;
    }
    .ik-qs-detail-head {
      flex-shrink: 0;
      padding: 12px 14px 9px;
      border-bottom: 1px solid color-mix(in srgb, var(--bd) 70%, transparent);
    }
    .ik-qs-detail-head h2 {
      margin: 0;
      color: var(--fg);
      font-size: 17px;
      line-height: 1.25;
      font-weight: 780;
    }
    .ik-qs-detail-head p {
      margin: 7px 0 0;
      color: var(--mut);
      font-size: 11.5px;
      line-height: 1.6;
    }
    .ik-qs-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      margin-top: 7px;
    }
    .ik-qs-tags span {
      padding: 2px 7px;
      border: 1px solid var(--bd);
      border-radius: 999px;
      color: var(--mut);
      background: var(--sel);
      font-size: 10.5px;
      line-height: 1.2;
    }
    .ik-qs-detail-body {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: 12px 14px 22px;
    }
    .ik-qs-text,
    .ik-qs-intro {
      margin: 0;
      white-space: pre-wrap;
      color: var(--fg);
      font-size: 11.5px;
      line-height: 1.68;
    }
    .ik-qs-node {
      margin-top: 12px;
      padding-top: 10px;
      border-top: 1px solid color-mix(in srgb, var(--bd) 70%, transparent);
    }
    .ik-qs-node.is-child {
      margin-left: 10px;
      padding-left: 10px;
      border-left: 2px solid color-mix(in srgb, var(--accent) 18%, transparent);
    }
    .ik-qs-node h3 {
      margin: 0 0 6px;
      color: var(--fg);
      font-size: 12.5px;
      line-height: 1.4;
      font-weight: 720;
    }
    .ik-qs-md-heading {
      margin: 10px 0 5px;
      color: var(--fg);
      font-size: 12px;
      line-height: 1.45;
      font-weight: 720;
    }
    .ik-qs-list {
      margin: 4px 0 10px;
      padding-left: 18px;
      color: var(--fg);
      font-size: 11.5px;
      line-height: 1.65;
    }
    .ik-qs-code {
      margin: 7px 0 10px;
      padding: 9px 10px;
      overflow: auto;
      border-radius: 8px;
      background: rgba(24,24,27,.06);
      color: var(--fg);
      font: 11px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace;
      white-space: pre;
    }
    .ik-qs-text a,
    .ik-qs-list a {
      color: var(--accent);
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    .ik-qs-text code,
    .ik-qs-list code {
      padding: 1px 5px;
      border-radius: 5px;
      background: rgba(24,24,27,.07);
      font: 11px ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .ik-qs-image {
      margin: 8px 0 12px;
    }
    .ik-qs-image img {
      display: block;
      max-width: 100%;
      max-height: 260px;
      object-fit: contain;
      border: 1px solid rgba(24,24,27,.12);
      border-radius: 9px;
      background: rgba(255,255,255,.86);
    }
    .ik-qs-image figcaption {
      margin-top: 4px;
      color: var(--mut);
      font-size: 10.5px;
      line-height: 1.4;
    }
    .ik-qs-muted {
      color: var(--mut);
      font-size: 11.5px;
    }
    .ik-qs-empty,
    .ik-qs-loading,
    .ik-qs-error {
      padding: 18px;
      color: var(--mut);
      font-size: 11.5px;
      line-height: 1.6;
      text-align: center;
    }
    .ik-qs-error {
      padding: 10px 12px;
      border: 1px solid color-mix(in srgb, var(--danger) 28%, var(--bd));
      border-radius: 12px;
      color: var(--danger);
      background: color-mix(in srgb, var(--danger) 8%, var(--panel));
      text-align: left;
    }
    .ik-qs-footer {
      color: var(--mut);
      font-size: 10.5px;
      line-height: 1.4;
      text-align: center;
    }
    @media (max-width: 760px) {
      .ik-qs-shell {
        height: calc(100vh - 16px);
        width: calc(100vw - 16px);
        margin-top: 8px;
      }
      .ik-qs-body {
        grid-template-columns: 1fr;
        grid-template-rows: minmax(180px, 34vh) minmax(0, 1fr);
      }
      .ik-result-row {
        grid-template-columns: 1fr;
        gap: 5px;
      }
      .ik-result-meta {
        justify-items: start;
      }
    }
  `;
  shadow.append(style);
  const app = document.createElement('div');
  shadow.append(app);
  document.documentElement.append(host);
  createRoot(app).render(<QuickSearchApp />);
}

mount();
