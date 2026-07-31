import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Bookmark, BookOpen, Check, ChevronRight, Clock3, Database, Filter, Layers3, LibraryBig, List, Minus, Plus, RefreshCw, Search, Sparkles, Star, X } from 'lucide-react';
import { PiBookmarkSimpleFill, PiBookmarkSimpleLight, PiBookLight, PiBookOpenLight, PiBooksLight, PiClockLight, PiCompassFill, PiDatabaseLight, PiMagnifyingGlassLight, PiNotebookLight, PiPencilSimpleLineLight, PiSquaresFourLight, PiStackLight, PiStarFill, PiStarLight, PiXLight } from 'react-icons/pi';
import type { Entry, KbCategory, KnowledgeBase } from '../types';
import { fetchEntry } from '../api';
import { fetchMobileBootstrap, fetchMobileEntries, searchMobileEntries } from '../api/mobile';
import { themeVars, THEMES } from '../themes';
import { highlightText } from '../highlight';
import readingBookPlant from '../assets/mobile/reading-book-plant.png';
import { renderMd } from '../markdown';

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

function NotebookModuleHeader({ title, subtitle, icon }: { title: string; subtitle: string; icon: JSX.Element }): JSX.Element {
  return (
    <header className="im-module-header">
      <h1><i />{title}</h1>
      <button type="button" aria-label={`${title}功能`}>{icon}</button>
      <p>{subtitle}</p>
    </header>
  );
}

function knowledgeDescription(name: string): string {
  if (/React|Vue|前端/i.test(name)) return '核心知识与工程实践面试题';
  if (/Docker|Linux|Git|工程/i.test(name)) return '工程工具、环境配置与常用实践';
  if (/数据库|MySQL|SQL/i.test(name)) return '数据库原理、SQL 与事务等核心知识';
  if (/分布式|微服务/i.test(name)) return '分布式系统设计、原理与实践笔记';
  if (/RAG|向量|LLM/i.test(name)) return '系统整理 RAG 相关工程面试题与参考答案';
  return '核心概念、实践方法与精选知识点';
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

function KnowledgeBaseList({ kbs, counts, compact = false, emptyText = '这里暂时没有知识库。' }: {
  kbs: KnowledgeBase[];
  counts: Record<string, number>;
  compact?: boolean;
  emptyText?: string;
}): JSX.Element {
  if (kbs.length === 0) return <div className="im-empty">{emptyText}</div>;
  return (
    <div className={`im-kb-grid ${compact ? 'is-compact' : ''}`}>
      {kbs.map((kb, index) => (
        <button type="button" className="im-kb-card im-kb-card-full" key={kb.id} onClick={() => navigate(`#/mobile/kb/${kb.id}`)}>
          <span className="im-index-rail" aria-hidden="true"><i /><i /><i /></span>
          <span className="im-kb-card-icon">{index % 4 === 1 ? <Layers3 size={24} /> : index % 4 === 3 ? <Database size={24} /> : <BookOpen size={24} />}</span>
          <span className="im-kb-card-copy"><strong>{kb.name}</strong>{!compact && <small className="im-kb-description">{knowledgeDescription(kb.name)}</small>}<small>{counts[kb.id] ?? 0} 篇文章 · {Math.max(1, Math.round((counts[kb.id] ?? 0) * 0.12))}k 阅读</small></span>
          {!compact && <Star className="im-kb-star" size={18} fill={kb.favorite ? 'currentColor' : 'none'} />}
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
          <span className="im-index-rail" aria-hidden="true"><i /><i /><i /></span>
          <span className="im-entry-copy">
            <strong>{highlightText(entry.title, query)}</strong>
            <small>{kbNames.get(entry.kbId) ?? entry.cat} · {(entry.tags ?? []).slice(0, 2).join(' / ') || '未分类'}</small>
          </span>
          <Bookmark className="im-entry-save" size={17} />
          <ChevronRight size={17} />
        </button>
      ))}
    </div>
  );
}

function HomeModule({ entries, kbs, counts, totalEntries, recentEntries, loading, error }: DataProps): JSX.Element {
  const recommendations = entries.slice(0, 3);
  const featured = recentEntries[0] ?? entries[0];
  const week = [
    { day: '一', done: true },
    { day: '二', done: true },
    { day: '三', done: true },
    { day: '四', done: true },
    { day: '五', active: true },
    { day: '六' },
    { day: '日' },
  ];
  const libraryIcons = [<PiBookLight size={30} />, <PiStackLight size={30} />, <PiDatabaseLight size={30} />, <PiSquaresFourLight size={29} />];
  return (
    <main className="im-home im-notebook-home">
      <section className="im-notebook-intro">
        <h1><i />知识检索</h1>
        <button type="button" aria-label="打开知识笔记" onClick={() => navigate(MODULE_PATHS.library)}><PiNotebookLight size={25} /></button>
        <p>今天，继续积累一点</p>
        <button type="button" className="im-search im-search-launcher" onClick={() => navigate(MODULE_PATHS.search)}>
          <PiMagnifyingGlassLight size={27} /><span>搜索知识点、标签或关键词</span>
        </button>
      </section>

      <section className="im-weekly">
        <SectionHead kicker="" title="本周阅读" action={<button type="button" className="im-text-action" onClick={() => navigate(MODULE_PATHS.favorites)}>查看全部 <ChevronRight size={15} /></button>} />
        <div className="im-weekly-body">
          <div className="im-week-days">
            {week.map((item) => <span key={item.day}><small>{item.day}</small><i className={`${item.done ? 'is-done' : ''} ${item.active ? 'is-active' : ''}`}>{item.done ? <Check size={15} /> : item.active ? <b /> : <b />}</i></span>)}
          </div>
          <div className="im-streak-note"><small>连续阅读</small><strong>6</strong><em>天</em></div>
        </div>
      </section>

      {featured && <section className="im-notebook-continue">
        <SectionHead kicker="" title="继续阅读" />
        <button type="button" className="im-notebook-reading-card" onClick={() => navigate(`#/mobile/entry/${featured.id}`)}>
          <i className="im-notebook-bluebar" />
          <strong>{featured.title}</strong>
          <small>上次阅读到：{featured.cat || 'BASE 理论核心思想'}</small>
          <span className="im-notebook-progress"><i /><em>58%</em></span>
          <span className="im-notebook-time"><Bookmark size={13} />上次：今天 09:30</span>
          <img src={readingBookPlant} alt="" />
        </button>
      </section>}

      <section className="im-today-picks">
        <SectionHead kicker="" title="今日精选" action={<button type="button" className="im-text-action">换一换 <RefreshCw size={14} /></button>} />
        <div className="im-today-list">
          {recommendations.map((entry, index) => <button type="button" key={entry.id} onClick={() => navigate(`#/mobile/entry/${entry.id}`)}>
            <i />
            <span><strong>{entry.title}</strong><small>{entry.cat} · {(entry.tags ?? []).slice(0, 2).join(' · ') || '知识整理'}</small></span>
            <em>阅读 {index === 0 ? 8 : index === 1 ? 12 : 10} 分钟</em>
          </button>)}
        </div>
      </section>

      <section className="im-your-libraries">
        <SectionHead kicker="" title="你的知识库" action={<button type="button" className="im-text-action" onClick={() => navigate(MODULE_PATHS.library)}>管理 <ChevronRight size={15} /></button>} />
        <div className="im-your-library-grid">
          {[...kbs.slice(0, 3), null].map((kb, index) => <button type="button" key={kb?.id ?? 'all'} onClick={() => navigate(kb ? `#/mobile/kb/${kb.id}` : MODULE_PATHS.library)}>
            <i>{libraryIcons[index]}</i>
            <strong>{index === 0 ? '我的笔记' : index === 3 ? '全部知识库' : kb?.name}</strong>
            <small>{index === 3 ? `${kbs.length} 个` : `${counts[kb?.id ?? ''] ?? 0} 篇`}</small>
          </button>)}
        </div>
      </section>
      {error && <div className="im-empty is-error">数据加载失败：{error}</div>}
      {loading && <span className="im-sr-only">{totalEntries ? `${totalEntries} 条内容` : '加载中'}</span>}
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
  const libraryIcons = [<PiBookOpenLight size={27} />, <PiStackLight size={27} />, <PiDatabaseLight size={27} />, <PiBookLight size={27} />];
  return (
    <main className="im-home im-notebook-module im-library-notebook">
      <NotebookModuleHeader title="知识库" subtitle="把知识整理成自己的秩序" icon={<PiBooksLight size={26} />} />
      <label className="im-module-search">
        <PiMagnifyingGlassLight size={25} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索知识库" />
        {query && <button type="button" aria-label="清空知识库搜索" onClick={() => setQuery('')}><PiXLight size={17} /></button>}
      </label>

      {!query && <section className="im-recent-libraries">
        <SectionHead kicker="" title="最近访问" action={<button type="button" className="im-text-action">查看全部 <ChevronRight size={14} /></button>} />
        <div>
          {kbs.slice(0, 3).map((kb, index) => <button type="button" key={kb.id} onClick={() => navigate(`#/mobile/kb/${kb.id}`)}>
            <i>{libraryIcons[index]}</i>
            <span><strong>{kb.name}</strong><small>{counts[kb.id] ?? 0} 篇 · {index === 0 ? '刚刚' : index === 1 ? '1 小时前' : '昨天'}</small></span>
          </button>)}
        </div>
      </section>}

      <div className="im-notebook-filters" role="tablist" aria-label="知识库分类">
        <button type="button" className={!categoryId ? 'is-active' : ''} onClick={() => setCategoryId(null)}>全部</button>
        {categories.slice(0, 4).map((category) => <button type="button" key={category.id} className={categoryId === category.id ? 'is-active' : ''} onClick={() => setCategoryId(category.id)}>{category.name}</button>)}
      </div>

      <SectionHead kicker="" title={query ? '搜索结果' : '全部知识库'} count={`${visible.length} 个`} />
      <div className="im-notebook-kb-list">
        {visible.length === 0 ? <div className="im-empty">没有匹配的知识库，试试其他关键词。</div> : visible.map((kb, index) => <button type="button" key={kb.id} onClick={() => navigate(`#/mobile/kb/${kb.id}`)}>
          <i>{libraryIcons[index % libraryIcons.length]}</i>
          <span><strong>{kb.name}</strong><small>{knowledgeDescription(kb.name)}</small><em>{counts[kb.id] ?? 0} 篇 · {Math.max(1, Math.round((counts[kb.id] ?? 0) * 1.3))}k 阅读</em></span>
          <PiStarLight className="im-row-star" size={21} />
          <ChevronRight size={16} />
        </button>)}
      </div>
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
  const kbNames = new Map(kbs.map((kb) => [kb.id, kb.name]));
  return (
    <main className="im-home im-notebook-module im-search-notebook">
      <NotebookModuleHeader title="搜索" subtitle="今天想查什么？" icon={<PiMagnifyingGlassLight size={26} />} />
      <label className="im-module-search is-focused">
        <PiMagnifyingGlassLight size={27} />
        <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索知识点、标签或输入一个问题" />
        <button type="button" aria-label="清空搜索" onClick={() => setQuery('')}><PiXLight size={18} /></button>
      </label>

      <section className="im-recent-searches">
        <SectionHead kicker="" title="最近搜索" />
        <div>
          {['CAP 定理', 'RAG 检索', 'MySQL 索引'].map((term) => <button type="button" key={term} onClick={() => setQuery(term)}><PiClockLight size={16} />{term}</button>)}
        </div>
      </section>

      <SectionHead kicker="" title={searching ? '正在搜索' : '为你找到'} action={<span className="im-result-count">{results.length} 条相关知识 <ChevronRight size={14} /></span>} />
      <div className="im-notebook-results">
        {results.length === 0 ? <div className="im-empty">没有找到相关知识点，换个关键词试试。</div> : results.slice(0, 8).map((entry, index) => <button type="button" key={entry.id} onClick={() => navigate(`#/mobile/entry/${entry.id}`)}>
          <i />
          <span><strong>{highlightText(entry.title, query)}</strong><small>{kbNames.get(entry.kbId) ?? entry.cat} · {(entry.tags ?? []).slice(0, 2).join(' · ') || '知识点'}</small><em>{highlightText(entry.summary || '整理核心概念、工程实践方法与常见问题，帮助快速理解和复习。', query)}</em></span>
          <PiBookmarkSimpleLight size={20} />
        </button>)}
      </div>
      {error && <div className="im-empty is-error">数据加载失败：{error}</div>}
    </main>
  );
}

function FavoritesModule({ entries, kbs, counts, savedEntries, error }: DataProps): JSX.Element {
  const favoriteKbs = useMemo(() => kbs.filter((kb) => kb.favorite), [kbs]);
  const [favoriteEntries, setFavoriteEntries] = useState<Entry[]>([]);
  const [activeTab, setActiveTab] = useState<'entries' | 'libraries'>('entries');
  useEffect(() => {
    if (favoriteKbs.length === 0) { setFavoriteEntries([]); return undefined; }
    let alive = true;
    fetchMobileEntries({ kbIds: favoriteKbs.map((kb) => kb.id), limit: 36 }).then((payload) => {
      if (alive) setFavoriteEntries(payload.entries);
    }).catch(() => { if (alive) setFavoriteEntries([]); });
    return () => { alive = false; };
  }, [favoriteKbs]);
  const visibleSaved = Array.from(new Map([...savedEntries, ...favoriteEntries, ...entries].map((entry) => [entry.id, entry])).values()).slice(0, 4);
  const featured = visibleSaved[0];
  const libraryIcons = [<PiBookLight size={27} />, <PiStackLight size={27} />, <PiDatabaseLight size={27} />];
  return (
    <main className="im-home im-notebook-module im-favorites-notebook">
      <NotebookModuleHeader title="收藏" subtitle="把值得重读的留在这里" icon={<PiStarLight size={26} />} />
      <div className="im-favorite-tabs" role="tablist" aria-label="收藏类型">
        <button type="button" className={activeTab === 'entries' ? 'is-active' : ''} onClick={() => setActiveTab('entries')}>知识点</button>
        <button type="button" className={activeTab === 'libraries' ? 'is-active' : ''} onClick={() => setActiveTab('libraries')}>知识库</button>
      </div>

      {activeTab === 'entries' ? <>
        {featured && <section className="im-favorite-featured">
          <SectionHead kicker="" title="最近收藏" action={<button type="button" className="im-text-action">查看全部 <ChevronRight size={14} /></button>} />
          <button type="button" onClick={() => navigate(`#/mobile/entry/${featured.id}`)}>
            <i />
            <strong>{featured.title}</strong>
            <small>来源知识库：{kbs.find((kb) => kb.id === featured.kbId)?.name ?? featured.cat}</small>
            <span><em /><b>58%</b></span>
            <label><PiBookmarkSimpleLight size={14} />收藏时间：今天 09:30</label>
            <PiBookmarkSimpleFill className="im-featured-bookmark" size={23} />
            <img src={readingBookPlant} alt="" />
          </button>
        </section>}

        <section className="im-all-favorites">
          <SectionHead kicker="" title="全部收藏" action={<button type="button" className="im-text-action">编辑 <PiPencilSimpleLineLight size={15} /></button>} />
          <div>
            {visibleSaved.length === 0 ? <div className="im-empty">打开知识点后点亮星标，即可保存到这里。</div> : visibleSaved.slice(0, 8).map((entry, index) => <button type="button" key={entry.id} onClick={() => navigate(`#/mobile/entry/${entry.id}`)}>
              <i />
              <span><strong>{entry.title}</strong><small>{kbs.find((kb) => kb.id === entry.kbId)?.name ?? entry.cat} · {(entry.tags ?? []).slice(0, 2).join(' · ') || '知识点'}</small><em><PiBookmarkSimpleLight size={13} />收藏时间：{index === 0 ? '今天 08:50' : '昨天 21:16'}</em></span>
              {index < 2 ? <PiStarFill size={21} /> : <PiStarLight size={21} />}
            </button>)}
          </div>
        </section>

        <section className="im-favorite-libraries-strip">
          <SectionHead kicker="" title="收藏的知识库" action={<button type="button" className="im-text-action" onClick={() => setActiveTab('libraries')}>查看全部 <ChevronRight size={14} /></button>} />
          <div>{favoriteKbs.slice(0, 3).map((kb, index) => <button type="button" key={kb.id} onClick={() => navigate(`#/mobile/kb/${kb.id}`)}><i>{libraryIcons[index]}</i><strong>{kb.name}</strong><small>{counts[kb.id] ?? 0} 篇知识</small></button>)}</div>
        </section>
      </> : <>
        <SectionHead kicker="" title="收藏的知识库" count={`${favoriteKbs.length} 个`} />
        <div className="im-notebook-kb-list">
          {favoriteKbs.length === 0 ? <div className="im-empty">还没有收藏知识库。</div> : favoriteKbs.map((kb, index) => <button type="button" key={kb.id} onClick={() => navigate(`#/mobile/kb/${kb.id}`)}><i>{libraryIcons[index % 3]}</i><span><strong>{kb.name}</strong><small>{knowledgeDescription(kb.name)}</small><em>{counts[kb.id] ?? 0} 篇知识</em></span><PiStarFill className="im-row-star" size={21} /><ChevronRight size={16} /></button>)}
        </div>
      </>}
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
      <div className="im-reader-top">
        <button type="button" onClick={onBack} aria-label="返回知识库"><ArrowLeft size={19} /></button>
        <strong>{entry.title}</strong>
        <button type="button" onClick={() => setTocOpen((value) => !value)}><List size={17} /><span>目录</span></button>
        <button type="button" className={saved ? 'is-active' : ''} onClick={onToggleSaved} aria-label={saved ? '取消收藏' : '收藏知识点'}><Star size={17} fill={saved ? 'currentColor' : 'none'} /></button>
      </div>
      <div className="im-reading-progress"><span style={{ width: '58%' }} /><small>58%</small></div>
      <div className="im-reader-kicker">{entry.cat} · {entry.tags.slice(0, 2).join(' / ') || '知识点'}</div>
      <h1>{entry.title}</h1>
      {entry.summary ? <p className="im-lead">{entry.summary}</p> : null}
      <div className="im-reader-meta"><span><BookOpen size={14} />知识点阅读</span><span><Clock3 size={14} />随时复习</span></div>
      <div className="im-reader-tools">
        <span className="im-reader-tools-label"><BookOpen size={14} />阅读设置</span>
        <span />
        <button type="button" aria-label="减小字号" onClick={() => changeFontSize(fontSize - 1)}><Minus size={14} /></button>
        <strong>{fontSize}px</strong>
        <button type="button" aria-label="增大字号" onClick={() => changeFontSize(fontSize + 1)}><Plus size={14} /></button>
      </div>
      {tocOpen && <nav className="im-reader-toc">{(entry.nodes ?? []).map((node) => <a key={node.id} href={`#reader-${node.id}`}>{node.title}</a>)}</nav>}
      <article className="im-reader-card" style={{ fontSize }}>
        {entry.intro ? renderMd(entry.intro) : null}
        {(entry.nodes ?? []).length > 0 ? (entry.nodes ?? []).map((node) => (
          <section key={node.id} id={`reader-${node.id}`}><span className="im-reader-dot" aria-hidden="true" /><h2>{node.title}</h2>{node.content ? renderMd(node.content) : null}</section>
        )) : <p>{entry.summary || '这个知识点暂无更多内容。'}</p>}
      </article>
      <footer className="im-reader-pagination">
        <button type="button" onClick={onBack}><span>‹&nbsp; 上一篇</span><small>返回知识库目录</small></button>
        <button type="button"><span>下一篇 &nbsp;›</span><small>继续阅读相关知识</small></button>
      </footer>
    </main>
  );
}

function BottomNav({ active }: { active: ModuleName }): JSX.Element {
  const items: Array<{ name: ModuleName; label: string; icon: JSX.Element }> = [
    { name: 'home', label: '发现', icon: <PiCompassFill size={21} /> },
    { name: 'library', label: '知识库', icon: <PiBookOpenLight size={22} /> },
    { name: 'search', label: '搜索', icon: <PiMagnifyingGlassLight size={23} /> },
    { name: 'favorites', label: '收藏', icon: <PiStarLight size={23} /> },
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
      <div className={`im-shell ${route.kind === 'module' && route.module === 'home' ? 'is-home' : ''} ${route.kind === 'entry' ? 'is-reader' : ''}`}>
        {content}
        {route.kind !== 'entry' && <BottomNav active={activeModule} />}
      </div>
    </div>
  );
}
