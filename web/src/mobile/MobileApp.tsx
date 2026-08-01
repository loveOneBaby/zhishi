import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Bookmark, BookOpen, Check, ChevronRight, Clock3, List, Minus, Plus, RefreshCw, Search, Star, X } from 'lucide-react';
import { PiBookmarkSimpleFill, PiBookmarkSimpleLight, PiBookLight, PiBookOpenLight, PiBooksLight, PiClockLight, PiCompassFill, PiDatabaseLight, PiMagnifyingGlassLight, PiNotebookLight, PiPencilSimpleLineLight, PiSquaresFourLight, PiStackLight, PiStarFill, PiStarLight, PiXLight } from 'react-icons/pi';
import type { Entry, KbCategory, KnowledgeBase } from '../types';
import { fetchEntry } from '../api';
import { fetchMobileBootstrap, fetchMobileEntries, fetchMobileEntryNavigation, recordMobileEntryView, searchMobileEntries } from '../api/mobile';
import { themeVars, THEMES } from '../themes';
import { highlightText } from '../highlight';
import readingBookPlant from '../assets/mobile/reading-book-plant.png';
import { renderMd } from '../markdown';
import { calculateReadingProgress, formatViewCount, mergeReaderProgressMaps, preserveHighestReadingProgress, weeklyReading, type ReaderProgressMap } from './mobile-state';

type ModuleName = 'home' | 'library' | 'search' | 'favorites';
type MobileRoute =
  | { kind: 'module'; module: ModuleName }
  | { kind: 'kb'; kbId: string }
  | { kind: 'entry'; entryId: string }
  | { kind: 'recent-libraries' }
  | { kind: 'reading-history' };

type RecentKbVisit = {
  kbId: string;
  visitedAt: number;
};

type ReaderNavigation = {
  previous: ReaderNavigationTarget | null;
  next: ReaderNavigationTarget | null;
};

type DataProps = {
  entries: Entry[];
  kbs: KnowledgeBase[];
  categories: KbCategory[];
  loading: boolean;
  error: string;
  counts: Record<string, number>;
  viewCounts: Record<string, number>;
  totalEntries: number;
  savedEntries: Entry[];
  recentEntries: Entry[];
  recentKbs: RecentKbVisit[];
  recentSearches: string[];
  readerProgress: ReaderProgressMap;
  savedAt: SavedAtMap;
  onTouchRecentSearch?: (query: string) => void;
  onDeleteRecentSearch?: (query: string) => void;
  onClearRecentSearches?: () => void;
  onShuffleRecommendations?: () => void;
  onToggleKbFavorite?: (kbId: string) => void;
  onRemoveSavedEntry?: (entryId: string) => void;
};

const SAVED_KEY = 'ik_mobile_saved_entries_v1';
const RECENT_KEY = 'ik_mobile_recent_entries_v1';
const RECENT_KBS_KEY = 'ik_mobile_recent_kbs_v1';
const READER_SIZE_KEY = 'ik_mobile_reader_size_v1';
const READER_PROGRESS_KEY = 'ik_mobile_reader_progress_v1';
const RECENT_SEARCHES_KEY = 'ik_mobile_recent_searches_v1';
const SAVED_AT_KEY = 'ik_mobile_saved_at_v1';
const FAVORITE_KBS_KEY = 'ik_mobile_favorite_kbs_v1';
const RECENT_SEARCHES_LIMIT = 6;
const RECENT_KBS_LIMIT = 12;

const MODULE_PATHS: Record<string, string> = {
  home: '#/mobile/home',
  library: '#/mobile/library',
  search: '#/mobile/search',
  favorites: '#/mobile/favorites',
  recentLibraries: '#/mobile/recent-libraries',
  readingHistory: '#/mobile/reading-history',
};

type ReaderNavigationTarget = {
  id: string;
  title: string;
  cat: string;
  kbId: string;
};

type SavedAtMap = Record<string, number>;

function storedEntries(key: string): Entry[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? '[]');
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

function storedStringList(key: string): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? '[]');
    return Array.isArray(value)
      ? [...new Set(value.map((entry) => String(entry).trim()).filter(Boolean))]
      : [];
  } catch { return []; }
}

function hasStoredValue(key: string): boolean {
  try { return window.localStorage.getItem(key) != null; } catch { return false; }
}

function storeEntries(key: string, entries: Entry[]): void {
  try { window.localStorage.setItem(key, JSON.stringify(entries.slice(0, 30))); } catch { /* storage unavailable */ }
}

function storeRecentVisits(key: string, visits: RecentKbVisit[]): void {
  try { window.localStorage.setItem(key, JSON.stringify(visits.slice(0, RECENT_KBS_LIMIT))); } catch { /* storage unavailable */ }
}

function storedReaderProgress(): ReaderProgressMap {
  try {
    const raw = JSON.parse(window.localStorage.getItem(READER_PROGRESS_KEY) ?? '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: ReaderProgressMap = {};
    for (const [entryId, value] of Object.entries(raw)) {
      if (typeof value !== 'object' || value === null) continue;
      const progress = Number((value as { progress?: unknown }).progress);
      const updatedAt = Number((value as { updatedAt?: unknown }).updatedAt);
      if (!Number.isFinite(progress) || !Number.isFinite(updatedAt) || entryId.length < 1) continue;
      out[entryId] = { progress: Math.max(0, Math.min(100, Math.round(progress))), updatedAt };
    }
    return out;
  } catch { return {}; }
}

function storedSavedAt(): SavedAtMap {
  try {
    const raw = JSON.parse(window.localStorage.getItem(SAVED_AT_KEY) ?? '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw)
      .map(([id, value]) => [id, Number(value)] as const)
      .filter(([id, value]) => Boolean(id) && Number.isFinite(value)));
  } catch { return {}; }
}

function saveSavedAt(value: SavedAtMap): void {
  try { window.localStorage.setItem(SAVED_AT_KEY, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

function storedRecentKbs(): RecentKbVisit[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(RECENT_KBS_KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    const valid = raw
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const kbId = String((item as { kbId?: unknown }).kbId ?? '').trim();
        const visitedAt = Number((item as { visitedAt?: unknown }).visitedAt);
        if (!kbId || !Number.isFinite(visitedAt)) return null;
        return { kbId, visitedAt };
      })
      .filter((item): item is RecentKbVisit => item !== null);
    return valid
      .sort((a, b) => b.visitedAt - a.visitedAt)
      .filter((item, index, arr) => arr.findIndex((candidate) => candidate.kbId === item.kbId) === index)
      .slice(0, RECENT_KBS_LIMIT);
  } catch { return []; }
}

function pushRecentKb(visits: RecentKbVisit[], kbId: string): RecentKbVisit[] {
  const now = Date.now();
  const normalizedId = kbId.trim();
  if (!normalizedId) return visits;
  const existing = visits.filter((visit) => visit.kbId !== normalizedId);
  return [{ kbId: normalizedId, visitedAt: now }, ...existing].slice(0, RECENT_KBS_LIMIT);
}

function saveRecentSearches(value: string[]): void {
  try { window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

function saveReaderProgress(value: ReaderProgressMap): void {
  try { window.localStorage.setItem(READER_PROGRESS_KEY, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

function pushRecentItem(items: string[], value: string, limit: number): string[] {
  const normalized = value.trim();
  if (!normalized) return items;
  return [normalized, ...items.filter((item) => item !== normalized)].slice(0, limit);
}

function clampProgress(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function extractReadingText(entry: Entry): string {
  const walkNodes = (nodes: Entry['nodes']): string[] => nodes.flatMap((node) => [
    node.title,
    node.content,
    ...walkNodes(node.children ?? []),
  ]);
  return [entry.title, entry.summary, entry.intro, ...walkNodes(entry.nodes ?? [])].join(' ');
}

function estimateReadingMinutes(entry: Entry): number {
  const text = extractReadingText(entry).replace(/[\u4e00-\u9fff]/g, ' $&');
  const chinese = text.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  const words = text
    .replace(/[\u4e00-\u9fff]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .length;
  const score = chinese + Math.round(words / 1.2);
  return Math.max(1, Math.round(score / 280));
}

function formatRelativeTime(ts: number): string {
  const delta = Date.now() - ts;
  if (!Number.isFinite(ts) || delta <= 0) return '刚刚';
  if (delta < 90_000) return '刚刚';
  if (delta < 3_600_000) return `${Math.max(1, Math.floor(delta / 60_000))} 分钟前`;
  if (delta < 28_800_000) return `${Math.floor(delta / 3_600_000)} 小时前`;
  return `${Math.floor(delta / 86_400_000)} 天前`;
}

function flattenReaderNodes(nodes: Entry['nodes'], depth = 0): Array<Entry['nodes'][number] & { depth: number }> {
  const out: Array<Entry['nodes'][number] & { depth: number }> = [];
  for (const node of nodes) {
    out.push({ ...node, depth });
    if ((node.children ?? []).length > 0) out.push(...flattenReaderNodes(node.children ?? [], depth + 1));
  }
  return out;
}

function routeFromHash(): MobileRoute {
  const parts = window.location.hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean);
  if (parts[0] !== 'mobile') return { kind: 'module', module: 'home' };
  if (parts[1] === 'entry' && parts[2]) return { kind: 'entry', entryId: parts[2] };
  if (parts[1] === 'kb' && parts[2]) return { kind: 'kb', kbId: parts[2] };
  if (parts[1] === 'recent-libraries') return { kind: 'recent-libraries' };
  if (parts[1] === 'reading-history') return { kind: 'reading-history' };
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

function SectionHead({ kicker, title, count, action }: { kicker: string; title: string; count?: string; action?: JSX.Element | null }): JSX.Element {
  return <section className="im-section-head"><div><span className="im-section-kicker">{kicker}</span><h2>{title}</h2></div>{action ?? (count ? <span>{count}</span> : null)}</section>;
}

function NotebookModuleHeader({ title, subtitle, icon }: { title: string; subtitle: string; icon: JSX.Element }): JSX.Element {
  return (
    <header className="im-module-header">
      <h1><i />{title}</h1>
      <span className="im-module-header-icon" aria-hidden="true">{icon}</span>
      <p>{subtitle}</p>
    </header>
  );
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

function HomeModule({
  entries,
  kbs,
  counts,
  totalEntries,
  recentEntries,
  recentKbs,
  readerProgress,
  viewCounts,
  onShuffleRecommendations,
  loading,
  error,
}: DataProps): JSX.Element {
  const recommendations = entries.slice(0, 3);
  const featured = recentEntries[0] ?? entries[0];
  const featuredProgress = featured ? readerProgress[featured.id] : null;
  const featureKb = featured ? kbs.find((kb) => kb.id === featured.kbId)?.name : '';
  const week = weeklyReading(readerProgress);
  const libraryIcons = [<PiBookLight size={30} />, <PiStackLight size={30} />, <PiDatabaseLight size={30} />, <PiSquaresFourLight size={29} />];
  const totalRecentKbs = recentKbs.length;
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
        <SectionHead kicker="" title="本周阅读" action={<button type="button" className="im-text-action" onClick={() => navigate(MODULE_PATHS.readingHistory)}>查看全部 <ChevronRight size={15} /></button>} />
        <div className="im-weekly-body">
          <div className="im-week-days">
            {week.days.map((item) => <span key={item.label}><small>{item.label}</small><i className={`${item.done ? 'is-done' : ''} ${item.active ? 'is-active' : ''}`}>{item.done ? <Check size={15} /> : <b />}</i></span>)}
          </div>
          <div className="im-streak-note"><small>连续阅读</small><strong>{week.streak}</strong><em>天</em></div>
        </div>
      </section>

      {featured && <section className="im-notebook-continue">
        <SectionHead kicker="" title="继续阅读" />
        <button type="button" className="im-notebook-reading-card" onClick={() => navigate(`#/mobile/entry/${featured.id}`)}>
          <i className="im-notebook-bluebar" />
          <strong>{featured.title}</strong>
          <small>上次阅读到：{featureKb || featured.cat}</small>
          <span className="im-notebook-progress"><i style={{ width: `${featuredProgress?.progress ?? 0}%` }} /><em>{featuredProgress?.progress ?? 0}%</em></span>
          <span className="im-notebook-time"><Bookmark size={13} />上次：{featuredProgress ? formatRelativeTime(featuredProgress.updatedAt) : '开始阅读'}</span>
          <img src={readingBookPlant} alt="" />
        </button>
      </section>}

      <section className="im-today-picks">
        <SectionHead kicker="" title="推荐阅读" action={<button type="button" className="im-text-action" onClick={() => onShuffleRecommendations?.()}><RefreshCw size={14} /> 换一换</button>} />
        <div className="im-today-list">
          {recommendations.map((entry, index) => <button type="button" key={entry.id} onClick={() => navigate(`#/mobile/entry/${entry.id}`)}>
            <i />
            <span><strong>{entry.title}</strong><small>{entry.cat} · {(entry.tags ?? []).slice(0, 2).join(' · ') || '知识整理'}</small></span>
            <em>阅读 {estimateReadingMinutes(entry)} 分钟</em>
          </button>)}
        </div>
      </section>

      <section className="im-your-libraries">
        <SectionHead kicker="" title="你的知识库" action={<button type="button" className="im-text-action" onClick={() => navigate(MODULE_PATHS.library)}>管理 <ChevronRight size={15} /></button>} />
        <div className="im-your-library-grid">
          {[...kbs.slice(0, 3), null].map((kb, index) => <button type="button" key={kb?.id ?? 'all'} onClick={() => navigate(kb ? `#/mobile/kb/${kb.id}` : MODULE_PATHS.library)}>
            <i>{libraryIcons[index]}</i>
            <strong>{index === 3 ? '全部知识库' : kb?.name}</strong>
            <small>{index === 3 ? `${kbs.length} 个` : `${counts[kb?.id ?? ''] ?? 0} 篇 · ${formatViewCount(viewCounts[kb?.id ?? ''] ?? 0)}`}</small>
          </button>)}
        </div>
      </section>
      {totalRecentKbs > 0 ? (
        <section className="im-your-libraries">
          <SectionHead kicker="" title="最近访问知识库" action={<button type="button" className="im-text-action" onClick={() => navigate(MODULE_PATHS.recentLibraries)}>查看全部 <ChevronRight size={15} /></button>} />
          <div className="im-recent-libraries">
            <div>
              {recentKbs.slice(0, 2).map((visit, index) => {
                const kb = kbs.find((item) => item.id === visit.kbId);
                if (!kb) return null;
                return <button type="button" key={kb.id} onClick={() => navigate(`#/mobile/kb/${kb.id}`)}>
                  <i>{libraryIcons[index % libraryIcons.length]}</i>
                  <span>
                    <strong>{kb.name}</strong>
                    <small>{counts[kb.id] ?? 0} 篇 · {formatRelativeTime(visit.visitedAt)}</small>
                  </span>
                </button>;
              })}
            </div>
          </div>
        </section>
      ) : null}
      {error && <div className="im-empty is-error">数据加载失败：{error}</div>}
      {loading && <span className="im-sr-only">{totalEntries ? `${totalEntries} 条内容` : '加载中'}</span>}
    </main>
  );
}

function LibraryModule({ kbs, categories, counts, viewCounts, recentKbs, onToggleKbFavorite, error }: DataProps): JSX.Element {
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const visible = useMemo(() => kbs.filter((kb) => {
    const matchesCategory = !categoryId || kb.categoryId === categoryId;
    const matchesQuery = !query.trim() || kb.name.toLowerCase().includes(query.trim().toLowerCase());
    return matchesCategory && matchesQuery;
  }), [categoryId, kbs, query]);
  const libraryIcons = [<PiBookOpenLight size={27} />, <PiStackLight size={27} />, <PiDatabaseLight size={27} />, <PiBookLight size={27} />];
  const recentList = useMemo(() => recentKbs
    .map((visit) => kbs.find((kb) => kb.id === visit.kbId))
    .filter((kb): kb is KnowledgeBase => Boolean(kb)),
  [recentKbs, kbs]);
  return (
    <main className="im-home im-notebook-module im-library-notebook">
      <NotebookModuleHeader title="知识库" subtitle="把知识整理成自己的秩序" icon={<PiBooksLight size={26} />} />
      <label className="im-module-search">
        <PiMagnifyingGlassLight size={25} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索知识库" />
        {query && <button type="button" aria-label="清空知识库搜索" onClick={() => setQuery('')}><PiXLight size={17} /></button>}
      </label>

      {!query && <section className="im-recent-libraries">
        <SectionHead kicker="" title="最近访问" action={<button type="button" className="im-text-action" onClick={() => navigate(MODULE_PATHS.recentLibraries)}>查看全部 <ChevronRight size={14} /></button>} />
        <div>
          {recentList.map((kb, index) => <button type="button" key={kb.id} onClick={() => navigate(`#/mobile/kb/${kb.id}`)}>
            <i>{libraryIcons[index]}</i>
            <span><strong>{kb.name}</strong><small>{counts[kb.id] ?? 0} 篇</small></span>
          </button>)}
          {recentList.length === 0 ? <div className="im-empty">暂无最近访问记录。</div> : null}
        </div>
      </section>}

      <div className="im-notebook-filters" role="tablist" aria-label="知识库分类">
        <button type="button" className={!categoryId ? 'is-active' : ''} onClick={() => setCategoryId(null)}>全部</button>
        {categories.map((category) => <button type="button" key={category.id} className={categoryId === category.id ? 'is-active' : ''} onClick={() => setCategoryId(category.id)}>{category.name}</button>)}
      </div>

      <SectionHead kicker="" title={query ? '搜索结果' : '全部知识库'} count={`${visible.length} 个`} />
      <div className="im-notebook-kb-list">
        {visible.length === 0 ? <div className="im-empty">没有匹配的知识库，试试其他关键词。</div> : visible.map((kb, index) => <div className="im-notebook-kb-row" key={kb.id}>
          <button type="button" className="im-kb-row-main" onClick={() => navigate(`#/mobile/kb/${kb.id}`)}>
            <i>{libraryIcons[index % libraryIcons.length]}</i>
            <span><strong>{kb.name}</strong><small>{categories.find((category) => category.id === kb.categoryId)?.name ?? '未分类'}知识库</small><em>{counts[kb.id] ?? 0} 篇 · {formatViewCount(viewCounts[kb.id] ?? 0)}</em></span>
            <ChevronRight size={16} />
          </button>
          <button type="button" className={`im-row-star ${kb.favorite ? 'is-favorite' : ''}`} aria-label={kb.favorite ? `取消收藏 ${kb.name}` : `收藏 ${kb.name}`} onClick={() => onToggleKbFavorite?.(kb.id)}>{kb.favorite ? <PiStarFill size={21} /> : <PiStarLight size={21} />}</button>
        </div>)}
      </div>
      {error && <div className="im-empty is-error">数据加载失败：{error}</div>}
    </main>
  );
}

function RecentLibrariesModule({ recentKbs, kbs, counts, error }: { recentKbs: RecentKbVisit[]; kbs: KnowledgeBase[]; counts: Record<string, number>; error?: string }): JSX.Element {
  const items = useMemo(() => recentKbs
    .map((visit) => ({ visit, kb: kbs.find((kb) => kb.id === visit.kbId) }))
    .filter((item): item is { visit: RecentKbVisit; kb: KnowledgeBase } => Boolean(item.kb)),
  [recentKbs, kbs]);
  const libraryIcons = [<PiBookOpenLight size={28} />, <PiStackLight size={28} />, <PiDatabaseLight size={28} />, <PiBookLight size={28} />];
  return (
    <main className="im-home im-notebook-module im-library-notebook">
      <button type="button" className="im-back" onClick={() => navigate(MODULE_PATHS.library)}><ArrowLeft size={18} />知识库</button>
      <PageTitle kicker="RECENTLY" title="最近访问" description={`共 ${items.length} 个知识库`}/>
      <div className="im-notebook-kb-list">
        {items.length === 0
          ? <div className="im-empty">暂无最近访问记录。</div>
          : items.map((item, index) => <button type="button" key={item.kb.id} onClick={() => navigate(`#/mobile/kb/${item.kb.id}`)}>
            <i>{libraryIcons[index % libraryIcons.length]}</i>
            <span><strong>{item.kb.name}</strong><small>{counts[item.kb.id] ?? 0} 篇</small><em>上次访问：{formatRelativeTime(item.visit.visitedAt)}</em></span>
            <ChevronRight size={16} />
          </button>)}
      </div>
      {error && <div className="im-empty is-error">数据加载失败：{error}</div>}
    </main>
  );
}

function ReadingHistoryModule({ recentEntries, readerProgress, kbs }: DataProps): JSX.Element {
  const entries = [...recentEntries].sort((a, b) => (readerProgress[b.id]?.updatedAt ?? 0) - (readerProgress[a.id]?.updatedAt ?? 0));
  return (
    <main className="im-home im-notebook-module im-library-notebook">
      <button type="button" className="im-back" onClick={() => navigate(MODULE_PATHS.home)}><ArrowLeft size={18} />发现</button>
      <PageTitle kicker="READING" title="阅读记录" description={`本设备最近阅读 ${entries.length} 篇知识`} />
      <div className="im-notebook-results">
        {entries.length === 0 ? <div className="im-empty">暂无阅读记录，打开一篇知识开始积累吧。</div> : entries.map((entry) => {
          const progress = readerProgress[entry.id];
          return <button type="button" key={entry.id} onClick={() => navigate(`#/mobile/entry/${entry.id}`)}>
            <i />
            <span><strong>{entry.title}</strong><small>{kbs.find((kb) => kb.id === entry.kbId)?.name ?? entry.cat}</small><em>{progress ? `阅读 ${progress.progress}% · ${formatRelativeTime(progress.updatedAt)}` : '已打开'}</em></span>
            <ChevronRight size={17} />
          </button>;
        })}
      </div>
    </main>
  );
}

function SearchModule({ entries, kbs, recentSearches, onTouchRecentSearch, onDeleteRecentSearch, onClearRecentSearches, error }: DataProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Entry[]>(entries.slice(0, 12));
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    if (!query.trim()) { setResults(entries.slice(0, 12)); setSearching(false); return undefined; }
    let alive = true;
    const normalized = query.trim();
    setSearching(true);
    const timer = window.setTimeout(() => {
      searchMobileEntries(normalized).then((payload) => {
        if (!alive) return;
        setResults(payload.entries);
        if (payload.entries.length >= 0) {
          onTouchRecentSearch?.(normalized);
        }
      })
        .catch(() => { if (alive) setResults([]); })
        .finally(() => { if (alive) setSearching(false); });
    }, 250);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [entries, query, onTouchRecentSearch]);
  const kbNames = new Map(kbs.map((kb) => [kb.id, kb.name]));
  const recentTerms = recentSearches.slice(0, 8);
  return (
    <main className="im-home im-notebook-module im-search-notebook">
      <NotebookModuleHeader title="搜索" subtitle="今天想查什么？" icon={<PiMagnifyingGlassLight size={26} />} />
      <label className="im-module-search is-focused">
        <PiMagnifyingGlassLight size={27} />
        <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索知识点、标签或输入一个问题" />
        <button type="button" aria-label="清空搜索" onClick={() => setQuery('')}><PiXLight size={18} /></button>
      </label>

      <section className="im-recent-searches">
        <SectionHead kicker="" title="最近搜索" action={recentTerms.length === 0 ? null : <button type="button" className="im-text-action" onClick={() => onClearRecentSearches?.()}>清空全部</button>} />
        <div>
          {recentTerms.length === 0 ? <div className="im-empty">暂无搜索记录，先搜索一个吧。</div> : recentTerms.map((term) => (
            <span className="im-chip" key={term}>
              <button type="button" onClick={() => setQuery(term)}>
                <PiClockLight size={16} />{term}
              </button>
              <button type="button" className="im-chip-close" onClick={() => onDeleteRecentSearch?.(term)} aria-label={`删除搜索词 ${term}`}><PiXLight size={14} /></button>
            </span>
          ))}
        </div>
      </section>

      <SectionHead kicker="" title={searching ? '正在搜索' : query.trim() ? '搜索结果' : '推荐阅读'} action={<span className="im-result-count">{results.length} 条知识 <ChevronRight size={14} /></span>} />
      <div className="im-notebook-results">
        {results.length === 0 ? <div className="im-empty">没有找到相关知识点，换个关键词试试。</div> : results.slice(0, 8).map((entry, index) => <button type="button" key={entry.id} onClick={() => navigate(`#/mobile/entry/${entry.id}`)}>
          <i />
          <span><strong>{highlightText(entry.title, query)}</strong><small>{kbNames.get(entry.kbId) ?? entry.cat} · {(entry.tags ?? []).slice(0, 2).join(' · ') || '知识点'}</small>{entry.summary ? <em>{highlightText(entry.summary, query)}</em> : null}</span>
          <PiBookmarkSimpleLight size={20} />
        </button>)}
      </div>
      {error && <div className="im-empty is-error">数据加载失败：{error}</div>}
    </main>
  );
}

function FavoritesModule({ kbs, categories, counts, savedEntries, savedAt, readerProgress, onToggleKbFavorite, onRemoveSavedEntry, error }: DataProps): JSX.Element {
  const favoriteKbs = useMemo(() => kbs.filter((kb) => kb.favorite), [kbs]);
  const [activeTab, setActiveTab] = useState<'entries' | 'libraries'>('entries');
  const [editing, setEditing] = useState(false);
  const visibleSaved = savedEntries;
  const featured = visibleSaved[0];
  const libraryIcons = [<PiBookLight size={27} />, <PiStackLight size={27} />, <PiDatabaseLight size={27} />];
  const getProgress = (entry: Entry): { progress: number; updatedAt: number } | null => {
    if (!entry?.id) return null;
    const data = readerProgress[entry.id];
    return data ? { progress: data.progress, updatedAt: data.updatedAt } : null;
  };
  return (
    <main className="im-home im-notebook-module im-favorites-notebook">
      <NotebookModuleHeader title="收藏" subtitle="把值得重读的留在这里" icon={<PiStarLight size={26} />} />
      <div className="im-favorite-tabs" role="tablist" aria-label="收藏类型">
        <button type="button" className={activeTab === 'entries' ? 'is-active' : ''} onClick={() => setActiveTab('entries')}>知识点</button>
        <button type="button" className={activeTab === 'libraries' ? 'is-active' : ''} onClick={() => setActiveTab('libraries')}>知识库</button>
      </div>

      {activeTab === 'entries' ? <>
        {featured && <section className="im-favorite-featured">
          <SectionHead kicker="" title="最近收藏" />
          <button type="button" onClick={() => navigate(`#/mobile/entry/${featured.id}`)}>
            <i />
            <strong>{featured.title}</strong>
            <small>来源知识库：{kbs.find((kb) => kb.id === featured.kbId)?.name ?? featured.cat}</small>
            <span><em style={{ width: `${getProgress(featured)?.progress ?? 0}%` }} /><b>{getProgress(featured)?.progress ?? 0}%</b></span>
            <label><PiBookmarkSimpleLight size={14} />收藏时间：{new Date(savedAt[featured.id] ?? Date.now()).toLocaleDateString()}</label>
            <PiBookmarkSimpleFill className="im-featured-bookmark" size={23} />
            <img src={readingBookPlant} alt="" />
          </button>
        </section>}

        <section className="im-all-favorites">
          <SectionHead kicker="" title="全部收藏" action={visibleSaved.length ? <button type="button" className="im-text-action" onClick={() => setEditing((value) => !value)}>{editing ? '完成' : '编辑'} <PiPencilSimpleLineLight size={15} /></button> : null} />
          <div>
            {visibleSaved.length === 0 ? <div className="im-empty">打开知识点后点亮星标，即可保存到这里。</div> : visibleSaved.slice(0, 8).map((entry) => {
              const progress = getProgress(entry);
              return <button type="button" key={entry.id} onClick={() => editing ? onRemoveSavedEntry?.(entry.id) : navigate(`#/mobile/entry/${entry.id}`)}>
              <i />
              <span><strong>{entry.title}</strong><small>{kbs.find((kb) => kb.id === entry.kbId)?.name ?? entry.cat} · {(entry.tags ?? []).slice(0, 2).join(' · ') || '知识点'}</small><em><PiBookmarkSimpleLight size={13} />{progress ? `最近阅读：${progress.progress}% · ${formatRelativeTime(progress.updatedAt)}` : '未阅读'}</em></span>
              {editing ? <PiXLight size={21} /> : <PiStarFill size={21} />}
            </button>; })}
          </div>
        </section>

        <section className="im-favorite-libraries-strip">
          <SectionHead kicker="" title="收藏的知识库" action={<button type="button" className="im-text-action" onClick={() => setActiveTab('libraries')}>查看全部 <ChevronRight size={14} /></button>} />
          <div>{favoriteKbs.slice(0, 3).map((kb, index) => <button type="button" key={kb.id} onClick={() => navigate(`#/mobile/kb/${kb.id}`)}><i>{libraryIcons[index]}</i><strong>{kb.name}</strong><small>{counts[kb.id] ?? 0} 篇知识</small></button>)}</div>
        </section>
      </> : <>
        <SectionHead kicker="" title="收藏的知识库" count={`${favoriteKbs.length} 个`} />
        <div className="im-notebook-kb-list">
          {favoriteKbs.length === 0 ? <div className="im-empty">还没有收藏知识库。</div> : favoriteKbs.map((kb, index) => <div className="im-notebook-kb-row" key={kb.id}><button type="button" className="im-kb-row-main" onClick={() => navigate(`#/mobile/kb/${kb.id}`)}><i>{libraryIcons[index % 3]}</i><span><strong>{kb.name}</strong><small>{categories.find((category) => category.id === kb.categoryId)?.name ?? '未分类'}知识库</small><em>{counts[kb.id] ?? 0} 篇知识</em></span><ChevronRight size={16} /></button><button type="button" className="im-row-star is-favorite" aria-label={`取消收藏 ${kb.name}`} onClick={() => onToggleKbFavorite?.(kb.id)}><PiStarFill size={21} /></button></div>)}
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

function MobileEntry({
  entry,
  onBack,
  saved,
  onToggleSaved,
  navigation,
  initialProgress,
  onProgressChange,
}: {
  entry: Entry;
  onBack: () => void;
  saved: boolean;
  onToggleSaved: () => void;
  navigation: ReaderNavigation;
  initialProgress: number;
  onProgressChange: (entryId: string, progress: number) => void;
}): JSX.Element {
  const [fontSize, setFontSize] = useState(() => Number(window.localStorage.getItem(READER_SIZE_KEY)) || 14);
  const [tocOpen, setTocOpen] = useState(false);
  const [progress, setProgress] = useState(() => clampProgress(initialProgress));
  const articleRef = useRef<HTMLElement>(null);
  const rafRef = useRef<number | null>(null);
  const progressRef = useRef(progress);
  const tocNodes = useMemo(() => flattenReaderNodes(entry.nodes ?? []), [entry.nodes]);
  const estimateMinutes = useMemo(() => estimateReadingMinutes(entry), [entry]);
  const canPrevious = Boolean(navigation?.previous);
  const canNext = Boolean(navigation?.next);

  useEffect(() => {
    const restored = clampProgress(initialProgress);
    progressRef.current = restored;
    setProgress(restored);
  }, [entry.id]);
  useEffect(() => { progressRef.current = progress; }, [progress]);

  const updateProgress = (): void => {
    if (!articleRef.current) return;
    const article = articleRef.current;
    const scrollRoot = article.closest<HTMLElement>('.im-root');
    if (!scrollRoot) return;
    const measured = calculateReadingProgress(scrollRoot.scrollTop, scrollRoot.scrollHeight, scrollRoot.clientHeight);
    const next = preserveHighestReadingProgress(progressRef.current, measured);
    if (next !== progressRef.current) {
      setProgress(next);
      onProgressChange(entry.id, next);
    }
  };

  useEffect(() => {
    const scrollRoot = articleRef.current?.closest<HTMLElement>('.im-root');
    if (!scrollRoot) return undefined;
    const handleScroll = (): void => {
      if (rafRef.current != null) return;
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        updateProgress();
      });
    };
    handleScroll();
    scrollRoot.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      scrollRoot.removeEventListener('scroll', handleScroll);
      onProgressChange(entry.id, progressRef.current);
    };
  }, [entry.id, onProgressChange]);

  const changeFontSize = (next: number): void => {
    const value = Math.min(20, Math.max(13, next));
    setFontSize(value);
    window.localStorage.setItem(READER_SIZE_KEY, String(value));
  };
  const goTo = (target: ReaderNavigationTarget | null): void => {
    if (!target) { onBack(); return; }
    navigate(`#/mobile/entry/${target.id}`);
  };
  return (
    <main className="im-reader">
      <div className="im-reader-top">
        <button type="button" onClick={onBack} aria-label="返回知识库"><ArrowLeft size={19} /></button>
        <strong>{entry.title}</strong>
        <button type="button" onClick={() => setTocOpen((value) => !value)}><List size={17} /><span>目录</span></button>
        <button type="button" className={saved ? 'is-active' : ''} onClick={onToggleSaved} aria-label={saved ? '取消收藏' : '收藏知识点'}><Star size={17} fill={saved ? 'currentColor' : 'none'} /></button>
      </div>
      <div className="im-reading-progress"><span style={{ width: `${progress}%` }} /><small>{progress}%</small></div>
      <div className="im-reader-kicker">{entry.cat} · {entry.tags.slice(0, 2).join(' / ') || '知识点'}</div>
      <h1>{entry.title}</h1>
      {entry.summary ? <p className="im-lead">{entry.summary}</p> : null}
      <div className="im-reader-meta"><span><BookOpen size={14} />知识点阅读</span><span><Clock3 size={14} />预计 {estimateMinutes} 分钟</span></div>
      <div className="im-reader-tools">
        <span className="im-reader-tools-label"><BookOpen size={14} />阅读设置</span>
        <span />
        <button type="button" aria-label="减小字号" onClick={() => changeFontSize(fontSize - 1)}><Minus size={14} /></button>
        <strong>{fontSize}px</strong>
        <button type="button" aria-label="增大字号" onClick={() => changeFontSize(fontSize + 1)}><Plus size={14} /></button>
      </div>
      {tocOpen && <div className="im-reader-toc-backdrop" onClick={() => setTocOpen(false)}>
        <nav className="im-reader-toc" onClick={(event) => event.stopPropagation()}>
          <div className="im-reader-toc-title">目录</div>
          {tocNodes.map((node) => <button type="button" key={node.id} style={{ paddingLeft: `${8 + node.depth * 12}px` }} onClick={() => {
            const target = document.getElementById(`reader-${node.id}`);
            target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            setTocOpen(false);
          }}>{node.title}</button>)}
        </nav>
      </div>}
      <article ref={articleRef} className="im-reader-card" style={{ fontSize }}>
        {entry.intro ? renderMd(entry.intro) : null}
        {(entry.nodes ?? []).length > 0 ? (entry.nodes ?? []).map((node) => (
          <section key={node.id} id={`reader-${node.id}`}><span className="im-reader-dot" aria-hidden="true" /><h2>{node.title}</h2>{node.content ? renderMd(node.content) : null}</section>
        )) : <p>{entry.summary || '这个知识点暂无更多内容。'}</p>}
      </article>
      <footer className="im-reader-pagination">
        <button type="button" disabled={!canPrevious} className={canPrevious ? 'is-enabled' : 'is-disabled'} onClick={() => canPrevious ? goTo(navigation.previous) : onBack()}><span>‹&nbsp; 上一篇</span><small>{canPrevious ? navigation.previous?.title : '返回知识库目录'}</small></button>
        <button type="button" disabled={!canNext} className={canNext ? 'is-enabled' : 'is-disabled'} onClick={() => canNext ? goTo(navigation.next) : undefined}><span>下一篇 &nbsp;›</span><small>{canNext ? navigation.next?.title : '暂无更多'}</small></button>
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
  const [viewCounts, setViewCounts] = useState<Record<string, number>>({});
  const [totalEntries, setTotalEntries] = useState(0);
  const [route, setRoute] = useState<MobileRoute>(() => routeFromHash());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fullEntry, setFullEntry] = useState<Entry | null>(null);
  const [savedEntries, setSavedEntries] = useState<Entry[]>(() => storedEntries(SAVED_KEY));
  const [savedAt, setSavedAt] = useState<SavedAtMap>(() => storedSavedAt());
  const [recentEntries, setRecentEntries] = useState<Entry[]>(() => storedEntries(RECENT_KEY));
  const [recentKbs, setRecentKbs] = useState<RecentKbVisit[]>(() => storedRecentKbs());
  const [recentSearches, setRecentSearches] = useState<string[]>(() => storedStringList(RECENT_SEARCHES_KEY));
  const [readerProgress, setReaderProgress] = useState<ReaderProgressMap>(() => storedReaderProgress());
  const [entryNavigation, setEntryNavigation] = useState<ReaderNavigation>({ previous: null, next: null });

  const updateRecentKbs = (kbId: string): void => {
    setRecentKbs((current) => {
      const next = pushRecentKb(current, kbId);
      storeRecentVisits(RECENT_KBS_KEY, next);
      return next;
    });
  };

  const addRecentSearch = (query: string): void => {
    const normalized = query.trim();
    if (!normalized) return;
    setRecentSearches((current) => {
      const next = pushRecentItem(current, normalized, RECENT_SEARCHES_LIMIT);
      saveRecentSearches(next);
      return next;
    });
  };

  const deleteRecentSearch = (query: string): void => {
    setRecentSearches((current) => {
      const next = current.filter((item) => item !== query);
      saveRecentSearches(next);
      return next;
    });
  };

  const clearRecentSearches = (): void => {
    setRecentSearches([]);
    try { window.localStorage.removeItem(RECENT_SEARCHES_KEY); } catch { /* no-op */ }
  };

  const refreshProgressFor = useCallback((entryId: string, percentage: number): void => {
    setReaderProgress((current) => {
      const persisted = storedReaderProgress();
      const previous = Math.max(current[entryId]?.progress ?? 0, persisted[entryId]?.progress ?? 0);
      const progress = preserveHighestReadingProgress(previous, percentage);
      const next = mergeReaderProgressMaps(persisted, current, { [entryId]: { progress, updatedAt: Date.now() } });
      saveReaderProgress(next);
      return next;
    });
  }, []);

  const shuffleRecommendations = (): void => {
    setEntries((current) => {
      const next = [...current];
      for (let idx = next.length - 1; idx > 0; idx -= 1) {
        const swap = Math.floor(Math.random() * (idx + 1));
        [next[idx], next[swap]] = [next[swap], next[idx]];
      }
      return next;
    });
  };

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
      setViewCounts(payload.viewCounts);
      const storedFavorites = storedStringList(FAVORITE_KBS_KEY);
      if (hasStoredValue(FAVORITE_KBS_KEY)) {
        const favorites = new Set(storedFavorites);
        setKbs(payload.kbs.map((kb) => ({ ...kb, favorite: favorites.has(kb.id) })));
      }
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
      const viewKey = `ik_mobile_viewed_${entry.id}`;
      try {
        if (!window.sessionStorage.getItem(viewKey)) {
          window.sessionStorage.setItem(viewKey, '1');
          void recordMobileEntryView(entry.id).catch(() => undefined);
        }
      } catch { void recordMobileEntryView(entry.id).catch(() => undefined); }
      updateRecentKbs(entry.kbId);
      setRecentEntries((current) => {
        const next = [entry, ...current.filter((item) => item.id !== entry.id)].slice(0, 12);
        storeEntries(RECENT_KEY, next);
        return next;
      });
    }).catch(() => {});
    return () => { alive = false; };
  }, [route]);

  useEffect(() => {
    if (route.kind !== 'entry') {
      setEntryNavigation({ previous: null, next: null });
      return undefined;
    }
    let alive = true;
    fetchMobileEntryNavigation(route.entryId).then((payload) => {
      if (!alive) return;
      setEntryNavigation(payload);
    }).catch(() => { if (alive) setEntryNavigation({ previous: null, next: null }); });
    return () => { alive = false; };
  }, [route]);

  useEffect(() => {
    if (route.kind !== 'kb') return;
    updateRecentKbs(route.kbId);
  }, [route]);

  const toggleKbFavorite = (kbId: string): void => {
    setKbs((current) => {
      const next = current.map((kb) => kb.id === kbId ? { ...kb, favorite: !kb.favorite } : kb);
      try { window.localStorage.setItem(FAVORITE_KBS_KEY, JSON.stringify(next.filter((kb) => kb.favorite).map((kb) => kb.id))); } catch { /* storage unavailable */ }
      return next;
    });
  };

  const removeSavedEntry = (entryId: string): void => {
    setSavedEntries((current) => {
      const next = current.filter((entry) => entry.id !== entryId);
      storeEntries(SAVED_KEY, next);
      return next;
    });
    setSavedAt((current) => {
      const next = { ...current };
      delete next[entryId];
      saveSavedAt(next);
      return next;
    });
  };

  const data = { entries, kbs, categories, counts, viewCounts, totalEntries, savedEntries, savedAt, recentEntries, recentKbs, recentSearches, readerProgress, loading, error,
    onTouchRecentSearch: addRecentSearch, onDeleteRecentSearch: deleteRecentSearch, onClearRecentSearches: clearRecentSearches, onShuffleRecommendations: shuffleRecommendations,
    onToggleKbFavorite: toggleKbFavorite, onRemoveSavedEntry: removeSavedEntry };
  const selectedEntry = route.kind === 'entry' ? fullEntry ?? entries.find((entry) => entry.id === route.entryId) : null;
  const activeModule: ModuleName = route.kind === 'module' ? route.module : 'library';
  const readProgressForSelected = selectedEntry ? readerProgress[selectedEntry.id]?.progress ?? 0 : 0;
  let content: JSX.Element;
  if (route.kind === 'entry' && selectedEntry) {
    content = <MobileEntry
      entry={selectedEntry}
      saved={savedEntries.some((entry) => entry.id === selectedEntry.id)}
      navigation={entryNavigation}
      initialProgress={readProgressForSelected}
      onProgressChange={refreshProgressFor}
      onToggleSaved={() => {
      setSavedEntries((current) => {
        const removing = current.some((entry) => entry.id === selectedEntry.id);
        const next = removing ? current.filter((entry) => entry.id !== selectedEntry.id) : [selectedEntry, ...current];
        storeEntries(SAVED_KEY, next);
        setSavedAt((timestamps) => {
          const updated = { ...timestamps };
          if (removing) delete updated[selectedEntry.id];
          else updated[selectedEntry.id] = Date.now();
          saveSavedAt(updated);
          return updated;
        });
        return next;
      });
    }} onBack={() => navigate(selectedEntry.kbId ? `#/mobile/kb/${selectedEntry.kbId}` : MODULE_PATHS.home)} />;
  } else if (route.kind === 'entry') {
    content = <main className="im-home"><div className="im-reader-skeleton"><span /><span /><span /><span /></div></main>;
  } else if (route.kind === 'kb') {
    content = <KnowledgeBaseModule kbId={route.kbId} kbs={kbs} count={counts[route.kbId] ?? 0} />;
  } else if (route.kind === 'recent-libraries') {
    content = <RecentLibrariesModule {...data} />;
  } else if (route.kind === 'reading-history') {
    content = <ReadingHistoryModule {...data} />;
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
