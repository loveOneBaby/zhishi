import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, ChevronRight, Clock3, LibraryBig, List, Minus, Plus, Search, Sparkles, Star, X } from 'lucide-react';
import type { Entry, KbCategory, KnowledgeBase } from '../types';
import { fetchEntry } from '../api';
import { fetchMobileBootstrap, fetchMobileEntries, searchMobileEntries } from '../api/mobile';
import { themeVars, THEMES } from '../themes';
import { highlightText } from '../highlight';

type ModuleName = 'home' | 'library' | 'search' | 'favorites';
type MobileRoute =
  | { kind: 'module'; module: ModuleName }
  | { kind: 'kb'; kbId: string }
  | { kind: 'entry'; entryId: string };

type DataProps = {
  entries: Entry[];
  kbs: KnowledgeBase[];
  categories: KbCategory[];
  loading: boolean;
  error: string;
  counts: Record<string, number>;
  totalEntries: number;
  savedEntries: Entry[];
  recentEntries: Entry[];
};

const SAVED_KEY = 'ik_mobile_saved_entries_v1';
const RECENT_KEY = 'ik_mobile_recent_entries_v1';
const READER_SIZE_KEY = 'ik_mobile_reader_size_v1';

function storedEntries(key: string): Entry[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? '[]');
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

function storeEntries(key: string, entries: Entry[]): void {
  try { window.localStorage.setItem(key, JSON.stringify(entries.slice(0, 30))); } catch { /* storage unavailable */ }
}

const MODULE_PATHS: Record<ModuleName, string> = {
  home: '#/mobile/home',
  library: '#/mobile/library',
  search: '#/mobile/search',
  favorites: '#/mobile/favorites',
};

function routeFromHash(): MobileRoute {
  const parts = window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] !== 'mobile') return { kind: 'module', module: 'home' };
  if (parts[1] === 'entry' && parts[2]) return { kind: 'entry', entryId: parts[2] };
  if (parts[1] === 'kb' && parts[2]) return { kind: 'kb', kbId: parts[2] };
  if (parts[1] === 'library' || parts[1] === 'search' || parts[1] === 'favorites' || parts[1] === 'home') {
    return { kind: 'module', module: parts[1] };
  }
  return { kind: 'module', module: 'home' };
}

function navigate(path: string): void {
  if (window.location.hash === path) {
    document.querySelector('.im-root')?.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  window.location.hash = path;
}

function PageTitle({ kicker, title, description }: { kicker: string; title: string; description: string }): JSX.Element {
  return <section className="im-page-title"><span className="im-section-kicker">{kicker}</span><h1>{title}</h1><p>{description}</p></section>;
}

function SectionHead({ kicker, title, count, action }: { kicker: string; title: string; count?: string; action?: JSX.Element }): JSX.Element {
  return <section className="im-section-head"><div><span className="im-section-kicker">{kicker}</span><h2>{title}</h2></div>{action ?? (count ? <span>{count}</span> : null)}</section>;
}

function SearchField({ value, onChange, placeholder = '搜索知识点、标签或关键词', autoFocus = false }: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}): JSX.Element {
  return (
    <label className="im-search">
      <Search size={19} />
      <input autoFocus={autoFocus} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
      {!value && <kbd>⌘ K</kbd>}
      {value && <button type="button" aria-label="清空搜索" onClick={() => onChange('')}><X size={15} /></button>}
    </label>
  );
}

function CategoryStrip({ categories, active, onChange }: {
  categories: KbCategory[];
  active: string | null;
  onChange: (categoryId: string | null) => void;
}): JSX.Element {
  return (
    <div className="im-category-strip">
      <button type="button" className={!active ? 'is-active' : ''} onClick={() => onChange(null)}><LibraryBig size={15} />全部</button>
      {categories.map((category) => <button type="button" key={category.id} className={active === category.id ? 'is-active' : ''} onClick={() => onChange(category.id)}>{category.name}</button>)}
    </div>
  );
}

function KnowledgeBaseList({ kbs, counts, emptyText = '这里暂时没有知识库。' }: {
  kbs: KnowledgeBase[];
  counts: Record<string, number>;
  emptyText?: string;
}): JSX.Element {
  if (kbs.length === 0) return <div className="im-empty">{emptyText}</div>;
  return (
    <div className="im-kb-grid">
      {kbs.map((kb) => (
        <button type="button" className="im-kb-card im-kb-card-full" key={kb.id} onClick={() => navigate(`#/mobile/kb/${kb.id}`)}>
          <span className="im-kb-card-icon"><BookOpen size={17} /></span>
          <span><strong>{kb.name}</strong><small>{counts[kb.id] ?? 0} 条知识点</small></span>
          <ChevronRight size={16} />
        </button>
      ))}
    </div>
  );
}

function EntryList({ entries, kbs, query = '', emptyText = '没有匹配的知识点。' }: {
  entries: Entry[];
  kbs: KnowledgeBase[];
  query?: string;
  emptyText?: string;
}): JSX.Element {
  const kbNames = new Map(kbs.map((kb) => [kb.id, kb.name]));
  if (entries.length === 0) return <div className="im-empty">{emptyText}</div>;
  return (
    <div className="im-entry-list">
      {entries.map((entry) => (
        <button type="button" className="im-entry-card" key={entry.id} onClick={() => navigate(`#/mobile/entry/${entry.id}`)}>
          <span className="im-entry-icon"><BookOpen size={17} /></span>
          <span className="im-entry-copy">
            <strong>{highlightText(entry.title, query)}</strong>
            <small>{kbNames.get(entry.kbId) ?? entry.cat} · {(entry.tags ?? []).slice(0, 2).join(' / ') || '未分类'}</small>
          </span>
          <ChevronRight size={17} />
        </button>
      ))}
    </div>
  );
}

function HomeModule({ entries, kbs, counts, totalEntries, recentEntries, loading, error }: DataProps): JSX.Element {
  const recommendations = entries.slice(0, 8);
  return (
    <main className="im-home">
      <section className="im-welcome">
        <div className="im-eyebrow">YOUR KNOWLEDGE SPACE</div>
        <h1>今天，想复习<br /><em>什么？</em></h1>
        <p>把复杂的知识，变成随手可读的答案。</p>
      </section>
      <button type="button" className="im-search im-search-launcher" onClick={() => navigate(MODULE_PATHS.search)}>
        <Search size={19} /><span>搜索知识点、标签或关键词</span><ChevronRight size={16} />
      </button>
      <button type="button" className="im-featured" onClick={() => recommendations[0] && navigate(`#/mobile/entry/${recommendations[0].id}`)}>
        <div><Sparkles size={18} /><span>今日推荐</span></div>
        <strong>{loading ? '正在准备…' : `${totalEntries} 条知识点`}</strong>
        <p>从一条知识开始今天的阅读</p><ChevronRight size={19} />
      </button>
      <SectionHead kicker="COLLECTIONS" title="常用知识库" action={<button type="button" className="im-text-action" onClick={() => navigate(MODULE_PATHS.library)}>查看全部</button>} />
      <KnowledgeBaseList kbs={kbs.slice(0, 5)} counts={counts} />
      <SectionHead kicker="FOR YOU" title="知识点精选" count={`${recommendations.length} 条`} />
      <EntryList entries={recommendations} kbs={kbs} />
      {recentEntries.length > 0 && <><SectionHead kicker="CONTINUE" title="继续阅读" count={`${recentEntries.length} 条`} /><EntryList entries={recentEntries.slice(0, 6)} kbs={kbs} /></>}
      {error && <div className="im-empty is-error">数据加载失败：{error}</div>}
    </main>
  );
}

function LibraryModule({ kbs, categories, counts, error }: DataProps): JSX.Element {
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const visible = useMemo(() => kbs.filter((kb) => {
    const matchesCategory = !categoryId || kb.categoryId === categoryId;
    const matchesQuery = !query.trim() || kb.name.toLowerCase().includes(query.trim().toLowerCase());
    return matchesCategory && matchesQuery;
  }), [categoryId, kbs, query]);
  return (
    <main className="im-home">
      <PageTitle kicker="LIBRARY" title="全部知识库" description="按主题进入知识库，再浏览其中的知识点。" />
      <SearchField value={query} onChange={setQuery} placeholder="搜索知识库名称" />
      <SectionHead kicker="FILTER" title="知识分类" count={`${categories.length} 个`} />
      <CategoryStrip categories={categories} active={categoryId} onChange={setCategoryId} />
      <SectionHead kicker="COLLECTIONS" title={categoryId ? '分类结果' : '知识库列表'} count={`${visible.length} 个`} />
      <KnowledgeBaseList kbs={visible} counts={counts} emptyText="没有匹配的知识库，试试清空筛选。" />
      {error && <div className="im-empty is-error">数据加载失败：{error}</div>}
    </main>
  );
}

function SearchModule({ entries, kbs, error }: DataProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Entry[]>(entries.slice(0, 12));
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    if (!query.trim()) { setResults(entries.slice(0, 12)); setSearching(false); return undefined; }
    let alive = true;
    setSearching(true);
    const timer = window.setTimeout(() => {
      searchMobileEntries(query).then((payload) => { if (alive) setResults(payload.entries); })
        .catch(() => { if (alive) setResults([]); })
        .finally(() => { if (alive) setSearching(false); });
    }, 250);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [entries, query]);
  return (
    <main className="im-home">
      <PageTitle kicker="SEARCH" title="搜索知识" description="输入一个概念、标签或问题，快速定位相关内容。" />
      <SearchField value={query} onChange={setQuery} autoFocus />
      {!query && <div className="im-search-hint"><Sparkles size={17} /><span><strong>试试搜索</strong>“CAP”“React”或“数据库”</span></div>}
      <SectionHead kicker={query ? 'RESULTS' : 'EXPLORE'} title={searching ? '正在搜索…' : query ? '搜索结果' : '推荐阅读'} count={`${results.length} 条`} />
      <EntryList entries={results} kbs={kbs} query={query} emptyText="没有找到相关知识点，换个关键词试试。" />
      {error && <div className="im-empty is-error">数据加载失败：{error}</div>}
    </main>
  );
}

function FavoritesModule({ kbs, counts, savedEntries, error }: DataProps): JSX.Element {
  const favoriteKbs = useMemo(() => kbs.filter((kb) => kb.favorite), [kbs]);
  const [favoriteEntries, setFavoriteEntries] = useState<Entry[]>([]);
  useEffect(() => {
    if (favoriteKbs.length === 0) { setFavoriteEntries([]); return undefined; }
    let alive = true;
    fetchMobileEntries({ kbIds: favoriteKbs.map((kb) => kb.id), limit: 36 }).then((payload) => {
      if (alive) setFavoriteEntries(payload.entries);
    }).catch(() => { if (alive) setFavoriteEntries([]); });
    return () => { alive = false; };
  }, [favoriteKbs]);
  return (
    <main className="im-home">
      <PageTitle kicker="SAVED" title="我的收藏" description="保存过的知识库和知识点，都在这里继续阅读。" />
      <SectionHead kicker="COLLECTIONS" title="收藏知识库" count={`${favoriteKbs.length} 个`} />
      <KnowledgeBaseList kbs={favoriteKbs} counts={counts} emptyText="还没有收藏知识库。" />
      <SectionHead kicker="KNOWLEDGE" title="收藏内容" count={`${savedEntries.length} 条`} />
      <EntryList entries={savedEntries} kbs={kbs} emptyText="打开知识点后点亮星标，即可保存到这里。" />
      {favoriteEntries.length > 0 && <><SectionHead kicker="FROM SAVED LIBRARIES" title="收藏知识库内容" count={`${favoriteEntries.length} 条`} /><EntryList entries={favoriteEntries} kbs={kbs} /></>}
      {error && <div className="im-empty is-error">数据加载失败：{error}</div>}
    </main>
  );
}

function KnowledgeBaseModule({ kbId, kbs, count }: { kbId: string; kbs: KnowledgeBase[]; count: number }): JSX.Element {
  const kb = kbs.find((item) => item.id === kbId);
  const [query, setQuery] = useState('');
  const [kbEntries, setKbEntries] = useState<Entry[]>([]);
  useEffect(() => {
    let alive = true;
    fetchMobileEntries({ kbId, limit: 60 }).then((payload) => { if (alive) setKbEntries(payload.entries); });
    return () => { alive = false; };
  }, [kbId]);
  const visibleEntries = useMemo(() => kbEntries.filter((entry) => !query.trim() || `${entry.title} ${entry.summary ?? ''} ${(entry.tags ?? []).join(' ')}`.toLowerCase().includes(query.trim().toLowerCase())), [kbEntries, query]);
  return (
    <main className="im-home">
      <button type="button" className="im-back" onClick={() => navigate(MODULE_PATHS.library)}><ArrowLeft size={18} />全部知识库</button>
      <PageTitle kicker="KNOWLEDGE BASE" title={kb?.name ?? '知识库'} description={`收录 ${count} 条知识点，可在当前知识库内搜索。`} />
      <SearchField value={query} onChange={setQuery} placeholder="在当前知识库内搜索" />
      <SectionHead kicker="CONTENTS" title={query ? '搜索结果' : '全部内容'} count={`${visibleEntries.length} 条`} />
      <EntryList entries={visibleEntries} kbs={kbs} query={query} emptyText="当前知识库没有匹配内容。" />
    </main>
  );
}

function MobileEntry({ entry, onBack, saved, onToggleSaved }: { entry: Entry; onBack: () => void; saved: boolean; onToggleSaved: () => void }): JSX.Element {
  const [fontSize, setFontSize] = useState(() => Number(window.localStorage.getItem(READER_SIZE_KEY)) || 14);
  const [tocOpen, setTocOpen] = useState(false);
  const changeFontSize = (next: number): void => {
    const value = Math.min(20, Math.max(13, next));
    setFontSize(value);
    window.localStorage.setItem(READER_SIZE_KEY, String(value));
  };
  return (
    <main className="im-reader">
      <div className="im-reader-actions">
        <button type="button" className="im-back" onClick={onBack}><ArrowLeft size={18} />返回知识库</button>
        <button type="button" className={`im-reader-save ${saved ? 'is-active' : ''}`} onClick={onToggleSaved} aria-label={saved ? '取消收藏' : '收藏知识点'}><Star size={17} fill={saved ? 'currentColor' : 'none'} /></button>
      </div>
      <div className="im-reader-kicker">{entry.cat} · {entry.tags.slice(0, 2).join(' / ') || '知识点'}</div>
      <h1>{entry.title}</h1>
      {entry.summary ? <p className="im-lead">{entry.summary}</p> : null}
      <div className="im-reader-meta"><span><BookOpen size={14} />知识点阅读</span><span><Clock3 size={14} />随时复习</span></div>
      <div className="im-reader-tools">
        <button type="button" onClick={() => setTocOpen((value) => !value)}><List size={15} />目录</button>
        <span />
        <button type="button" aria-label="减小字号" onClick={() => changeFontSize(fontSize - 1)}><Minus size={14} /></button>
        <strong>{fontSize}px</strong>
        <button type="button" aria-label="增大字号" onClick={() => changeFontSize(fontSize + 1)}><Plus size={14} /></button>
      </div>
      {tocOpen && <nav className="im-reader-toc">{(entry.nodes ?? []).map((node) => <a key={node.id} href={`#reader-${node.id}`}>{node.title}</a>)}</nav>}
      <article className="im-reader-card" style={{ fontSize }}>
        {entry.intro ? <p>{entry.intro}</p> : null}
        {(entry.nodes ?? []).length > 0 ? (entry.nodes ?? []).map((node) => (
          <section key={node.id} id={`reader-${node.id}`}><h2>{node.title}</h2>{node.content ? <p>{node.content}</p> : null}</section>
        )) : <p>{entry.summary || '这个知识点暂无更多内容。'}</p>}
      </article>
    </main>
  );
}

function BottomNav({ active }: { active: ModuleName }): JSX.Element {
  const items: Array<{ name: ModuleName; label: string; icon: JSX.Element }> = [
    { name: 'home', label: '发现', icon: <Sparkles size={19} /> },
    { name: 'library', label: '知识库', icon: <LibraryBig size={19} /> },
    { name: 'search', label: '搜索', icon: <Search size={19} /> },
    { name: 'favorites', label: '收藏', icon: <Star size={19} /> },
  ];
  return (
    <nav className="im-bottom-nav" aria-label="主要功能">
      {items.map((item) => <button key={item.name} className={active === item.name ? 'is-active' : ''} type="button" onClick={() => navigate(MODULE_PATHS[item.name])}>{item.icon}<span>{item.label}</span></button>)}
    </nav>
  );
}

export default function MobileApp(): JSX.Element {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [categories, setCategories] = useState<KbCategory[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [totalEntries, setTotalEntries] = useState(0);
  const [route, setRoute] = useState<MobileRoute>(() => routeFromHash());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fullEntry, setFullEntry] = useState<Entry | null>(null);
  const [savedEntries, setSavedEntries] = useState<Entry[]>(() => storedEntries(SAVED_KEY));
  const [recentEntries, setRecentEntries] = useState<Entry[]>(() => storedEntries(RECENT_KEY));

  useEffect(() => {
    if (window.location.hash === '#/mobile' || window.location.hash === '#/mobile/') {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${MODULE_PATHS.home}`);
      setRoute({ kind: 'module', module: 'home' });
    }
    let alive = true;
    fetchMobileBootstrap().then((payload) => {
      if (!alive) return;
      setEntries(payload.recommendations);
      setKbs(payload.kbs);
      setCategories(payload.kbCategories);
      setCounts(payload.counts);
      setTotalEntries(payload.totalEntries);
    }).catch((reason) => { if (alive) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (alive) setLoading(false); });
    const onHash = (): void => {
      setRoute(routeFromHash());
      requestAnimationFrame(() => document.querySelector('.im-root')?.scrollTo({ top: 0 }));
    };
    window.addEventListener('hashchange', onHash);
    return () => { alive = false; window.removeEventListener('hashchange', onHash); };
  }, []);

  useEffect(() => {
    if (route.kind !== 'entry') { setFullEntry(null); return undefined; }
    let alive = true;
    fetchEntry(route.entryId).then((entry) => {
      if (!alive) return;
      setFullEntry(entry);
      setRecentEntries((current) => {
        const next = [entry, ...current.filter((item) => item.id !== entry.id)].slice(0, 12);
        storeEntries(RECENT_KEY, next);
        return next;
      });
    }).catch(() => {});
    return () => { alive = false; };
  }, [route]);

  const data = { entries, kbs, categories, counts, totalEntries, savedEntries, recentEntries, loading, error };
  const selectedEntry = route.kind === 'entry' ? fullEntry ?? entries.find((entry) => entry.id === route.entryId) : null;
  const activeModule: ModuleName = route.kind === 'module' ? route.module : 'library';
  let content: JSX.Element;
  if (route.kind === 'entry' && selectedEntry) {
    content = <MobileEntry entry={selectedEntry} saved={savedEntries.some((entry) => entry.id === selectedEntry.id)} onToggleSaved={() => {
      setSavedEntries((current) => {
        const next = current.some((entry) => entry.id === selectedEntry.id) ? current.filter((entry) => entry.id !== selectedEntry.id) : [selectedEntry, ...current];
        storeEntries(SAVED_KEY, next);
        return next;
      });
    }} onBack={() => navigate(selectedEntry.kbId ? `#/mobile/kb/${selectedEntry.kbId}` : MODULE_PATHS.home)} />;
  } else if (route.kind === 'entry') {
    content = <main className="im-home"><div className="im-reader-skeleton"><span /><span /><span /><span /></div></main>;
  } else if (route.kind === 'kb') {
    content = <KnowledgeBaseModule kbId={route.kbId} kbs={kbs} count={counts[route.kbId] ?? 0} />;
  } else if (route.kind === 'module' && route.module === 'library') {
    content = <LibraryModule key="library" {...data} />;
  } else if (route.kind === 'module' && route.module === 'search') {
    content = <SearchModule key="search" {...data} />;
  } else if (route.kind === 'module' && route.module === 'favorites') {
    content = <FavoritesModule key="favorites" {...data} />;
  } else {
    content = <HomeModule {...data} />;
  }

  return (
    <div className="im-root" style={{ ...themeVars(THEMES.mono) }}>
      <div className="im-shell">
        <header className="im-header">
          <button type="button" className="im-brand" onClick={() => navigate(MODULE_PATHS.home)}><span className="im-brand-mark" /><span>知识检索</span><small>mobile</small></button>
          <span className="im-avatar" aria-hidden="true">Z</span>
        </header>
        {content}
        {route.kind !== 'entry' && <BottomNav active={activeModule} />}
      </div>
    </div>
  );
}
