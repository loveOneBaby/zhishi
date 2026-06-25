import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { Entry, EntryInput, Folder, KnowledgeBase, ThemeKey } from './types';
import { THEMES, themeVars } from './themes';
import { filterEntries, suggestQueries, type SearchSuggestion } from './search';
import {
  fetchEntries,
  fetchKbs,
  fetchFolders,
  createEntry,
  updateEntry,
  deleteEntry,
  reorderEntries,
  createKb,
  renameKb,
  deleteKb,
  createFolder,
  renameFolder,
  deleteFolder,
  moveFolder,
  reorderFolders,
  type EntryInput as ApiEntryInput,
} from './api';
import { seg2 } from './ui';
import TopBar, { type AppMode } from './components/TopBar';
import SearchBox from './components/SearchBox';
import SearchMode from './components/SearchMode';
import FreeMode from './components/FreeMode';
import DetailModal from './components/DetailModal';
import AskModal from './components/AskModal';
import EntryEditor from './components/EntryEditor';
import Toaster from './components/Toaster';

// 轻量哈希路由:把「模块 + 视图」写进 URL,刷新/前进后退都能恢复
type Route = { mode: AppMode; viewType: 'list' | 'canvas' };
function parseRoute(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [seg, sub] = raw.split('/');
  if (seg === 'library' || seg === 'free' || seg === 'kb') return { mode: 'free', viewType: 'list' };
  return { mode: 'search', viewType: sub === 'canvas' ? 'canvas' : 'list' };
}
function routeToHash(mode: AppMode, viewType: 'list' | 'canvas'): string {
  return mode === 'free' ? '#/library' : `#/search/${viewType}`;
}

export default function App() {
  const initialRoute = parseRoute();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [mode, setMode] = useState<AppMode>(initialRoute.mode);
  const [viewType, setViewType] = useState<'list' | 'canvas'>(initialRoute.viewType);
  const [query, setQuery] = useState('');
  const [searchKb, setSearchKb] = useState<string | null>(null);   // 检索作用域:null=全部知识库
  const [sel, setSel] = useState(0);
  const [sugSel, setSugSel] = useState(-1);   // 联想下拉的键盘选中项（-1 = 无）
  const [theme, setThemeState] = useState<ThemeKey>('mono');

  // 自由模式导航：freeKb 当前进入的知识库；freeFolder 当前浏览的文件夹（null = 知识库根）
  const [freeKb, setFreeKb] = useState<string | null>(null);
  const [freeFolder, setFreeFolder] = useState<string | null>(null);

  const [openId, setOpenId] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);

  // 路由同步:状态变化 → 写 URL(刷新可恢复);浏览器前进后退 → 读 URL
  useEffect(() => {
    const target = routeToHash(mode, viewType);
    if (window.location.hash !== target) {
      window.history.replaceState(null, '', target);
    }
  }, [mode, viewType]);
  useEffect(() => {
    const onPop = (): void => {
      const next = parseRoute();
      setMode(next.mode);
      setViewType(next.viewType);
    };
    window.addEventListener('hashchange', onPop);
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('hashchange', onPop);
      window.removeEventListener('popstate', onPop);
    };
  }, []);

  // 加载数据 + 恢复主题
  useEffect(() => {
    const saved = localStorage.getItem('ik_theme');
    if (saved && (saved in THEMES)) setThemeState(saved as ThemeKey);
    Promise.all([fetchEntries(), fetchKbs(), fetchFolders()])
      .then(([e, k, f]) => { setEntries(e); setKbs(k); setFolders(f); })
      .catch(() => { setEntries([]); setKbs([]); setFolders([]); })
      .finally(() => { setLoaded(true); setTimeout(() => inputRef.current?.focus(), 60); });
  }, []);

  const setTheme = (k: ThemeKey) => {
    setThemeState(k);
    try { localStorage.setItem('ik_theme', k); } catch { /* ignore */ }
  };

  const t = THEMES[theme];
  useEffect(() => {
    const vars = themeVars(t) as unknown as Record<string, string>;
    for (const [key, value] of Object.entries(vars)) {
      document.documentElement.style.setProperty(key, value);
    }
    document.body.style.background = t.bg;
    document.body.style.color = t.fg;
    document.body.style.fontFamily = t.font;
  }, [t]);

  // 防抖：输入即时更新，过滤/建议在空闲时计算（避免逐字全量重算）
  const deferredQuery = useDeferredValue(query);
  // 检索作用域:限定到某个知识库时,先把候选集缩到该库
  const scopedEntries = useMemo(
    () => (searchKb ? entries.filter((e) => e.kbId === searchKb) : entries),
    [entries, searchKb]
  );
  // "/" 开头是正在选知识库,不作为检索词
  const filterQuery = deferredQuery.startsWith('/') ? '' : deferredQuery;
  const results = useMemo(
    () => (mode === 'search' ? filterEntries(scopedEntries, filterQuery) : []),
    [scopedEntries, filterQuery, mode]
  );
  const suggestions = useMemo(
    () => (mode === 'search' ? suggestQueries(scopedEntries, filterQuery) : []),
    [scopedEntries, filterQuery, mode]
  );

  const closeAll = useCallback(() => { setOpenId(null); setAiOpen(false); setFormOpen(false); }, []);
  const clearSearch = useCallback(() => {
    setQuery('');
    setSel(0);
    setSugSel(-1);
    setOpenId(null);
    setAiOpen(false);
    setTimeout(() => inputRef.current?.focus(), 20);
  }, []);
  const isSearchList = mode === 'search' && viewType === 'list';

  // ⌘K / Ctrl+K 呼出搜索：切到检索模式 + 清空 + 聚焦输入框（任意页面可用）
  const summonSearch = useCallback(() => {
    setMode('search');
    setQuery('');
    setSel(0);
    setSugSel(-1);
    setOpenId(null);
    setAiOpen(false);
    setFormOpen(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  // 应用一条联想：有 entryId 直接打开详情，否则作为查询填入
  const applySuggestion = useCallback((s: SearchSuggestion) => {
    setQuery(s.value);
    setSugSel(-1);
    if (s.entryId) setOpenId(s.entryId);
    else { setOpenId(null); setSel(0); }
  }, []);

  // 键盘交互：⌘K 呼出搜索、联想下拉的 ↑↓ 选择 / ↵ 应用、esc 关闭
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      // 全局：⌘K / Ctrl+K 呼出搜索（任意模式、任意焦点）
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        summonSearch();
        return;
      }
      const modalOpen = Boolean(openId && !isSearchList);
      if (modalOpen || aiOpen || formOpen) { if (e.key === 'Escape') closeAll(); return; }
      if (mode !== 'search') return;
      if (viewType === 'canvas') { if (e.key === 'Escape' && query) { setQuery(''); setSel(0); } return; }

      // 列表视图:↑↓ 在结果间移动(右侧实时预览),↵ 打开,esc 清空
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setOpenId(null);
        setSel((s) => Math.min(s + 1, results.length - 1));
      }
      else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setOpenId(null);
        setSel((s) => Math.max(0, s - 1));
      }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const clamped = Math.min(sel, Math.max(0, results.length - 1));
        if (results[clamped]) setOpenId(results[clamped].id);
        else if (query.trim()) setAiOpen(true);
      } else if (e.key === 'Escape') {
        if (query) { setQuery(''); setSel(0); setSugSel(-1); }
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [openId, aiOpen, formOpen, isSearchList, mode, viewType, query, sel, results, suggestions, sugSel, closeAll, summonSearch, applySuggestion]);

  // 知识点的增删改：同步到共享 entries，检索/画布即时反映
  const handleCreate = useCallback(async (input: ApiEntryInput): Promise<Entry> => {
    const entry = await createEntry(input);
    setEntries((prev) => [...prev, entry]);
    return entry;
  }, []);
  const handleUpdate = useCallback(async (id: string, input: ApiEntryInput): Promise<Entry> => {
    const entry = await updateEntry(id, input);
    setEntries((prev) => prev.map((e) => (e.id === id ? entry : e)));
    setOpenId((cur) => (cur === id ? null : cur));
    return entry;
  }, []);
  const handleDelete = useCallback(async (id: string) => {
    await deleteEntry(id);
    setEntries((prev) => prev.filter((e) => e.id !== id));
    setOpenId((cur) => (cur === id ? null : cur));
  }, []);
  const handleReorder = useCallback(async (ids: string[]) => {
    const next = await reorderEntries(ids);
    setEntries(next);
  }, []);
  const handleImported = useCallback((nextEntries: Entry[], nextKbs: KnowledgeBase[], nextFolders: Folder[]) => {
    setEntries(nextEntries);
    setKbs(nextKbs);
    setFolders(nextFolders);
  }, []);

  // 知识库回调
  const handleCreateKb = useCallback(async (name: string): Promise<KnowledgeBase> => {
    const kb = await createKb(name);
    setKbs((prev) => [...prev, kb]);
    return kb;
  }, []);
  const handleRenameKb = useCallback(async (id: string, name: string): Promise<void> => {
    const kb = await renameKb(id, name);
    setKbs((prev) => prev.map((k) => (k.id === id ? kb : k)));
    // entry.cat 是知识库名派生，需同步刷新本地缓存
    setEntries((prev) => prev.map((e) => (e.kbId === id ? { ...e, cat: kb.name } : e)));
  }, []);
  const handleDeleteKb = useCallback(async (id: string): Promise<void> => {
    const { kbs: nk, folders: nf, entries: ne } = await deleteKb(id);
    setKbs(nk);
    setFolders(nf);
    setEntries(ne);
    setOpenId(null);
    setFreeKb((cur) => (cur === id ? null : cur));
  }, []);

  // 文件夹回调
  const handleCreateFolder = useCallback(async (input: { kbId: string; parentId?: string | null; name: string }): Promise<Folder> => {
    const folder = await createFolder(input);
    setFolders((prev) => [...prev, folder]);
    return folder;
  }, []);
  const handleRenameFolder = useCallback(async (id: string, name: string): Promise<void> => {
    const folder = await renameFolder(id, name);
    setFolders((prev) => prev.map((f) => (f.id === id ? folder : f)));
  }, []);
  const handleDeleteFolder = useCallback(async (id: string): Promise<void> => {
    const { folders: nf, entries: ne } = await deleteFolder(id);
    setFolders(nf);
    setEntries(ne);
    setOpenId(null);
    setFreeFolder((cur) => {
      if (!cur) return cur;
      // 若当前浏览的文件夹被删（或在其子树内），回退到其知识库根
      return cur === id || nf.every((f) => f.id !== cur) ? null : cur;
    });
  }, []);
  const handleMoveFolder = useCallback(async (id: string, opts: { parentId?: string | null; kbId?: string }): Promise<void> => {
    const next = await moveFolder(id, opts);
    setFolders(next);
  }, []);
  const handleReorderFolders = useCallback(async (ids: string[]): Promise<void> => {
    const next = await reorderFolders(ids);
    setFolders(next);
  }, []);

  const openEntry = openId ? entries.find((e) => e.id === openId) ?? null : null;
  const selectedListEntry = isSearchList
    ? (results.find((e) => e.id === openId) ?? results[Math.min(sel, Math.max(0, results.length - 1))] ?? null)
    : null;
  const selectedListId = selectedListEntry?.id ?? null;
  const modalEntry = isSearchList ? null : openEntry;

  const handleTopModeChange = useCallback((nextMode: AppMode) => {
    setOpenId(null);
    if (nextMode === 'free' && mode === 'free' && freeKb) {
      setFreeKb(null);
      setFreeFolder(null);
      setMode('free');
      return;
    }
    setMode(nextMode);
    if (nextMode === 'search') setTimeout(() => inputRef.current?.focus(), 40);
  }, [freeKb, mode]);

  // 检索框上移到顶栏「知识检索」后面;输入 "/" 选择知识库限定范围
  const searchField = mode === 'search' ? (
    <SearchBox
      query={query}
      onQuery={(v) => { setQuery(v); setSel(0); setOpenId(null); setSugSel(-1); }}
      onClear={clearSearch}
      kbs={kbs}
      searchKb={searchKb}
      onScopeKb={(id) => { setSearchKb(id); setSel(0); setOpenId(null); setSugSel(-1); }}
      inputRef={inputRef}
    />
  ) : undefined;

  // 检索提示 + 列表/画布切换:移到顶栏搜索框后面
  const searchTools = mode === 'search' ? (
    <>
      
      <div style={{ display: 'flex', gap: 2, background: 'var(--sel)', padding: 3, borderRadius: 8 }}>
        <button style={seg2(viewType === 'list')} onClick={() => { setViewType('list'); setOpenId(null); }}>列表</button>
        <button style={seg2(viewType === 'canvas')} onClick={() => { setViewType('canvas'); setOpenId(null); }}>画布</button>
      </div>
    </>
  ) : undefined;

  return (
    <div className={`ik-theme-${theme}`} style={{ ...themeVars(t), height: '100vh', overflow: 'hidden', background: 'var(--app-bg, var(--bg))', color: 'var(--fg)', fontFamily: 'var(--font)', WebkitFontSmoothing: 'antialiased' }}>
      <div style={{ width: '100%', height: '100%', maxWidth: 'none', margin: 0, padding: '0 clamp(16px, 2.4vw, 44px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <TopBar mode={mode} setMode={handleTopModeChange} theme={theme} setTheme={setTheme} searchSlot={searchField} searchTools={searchTools} />

        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {mode === 'search' && (
            <SearchMode
              query={query}
              onInput={(v) => { setQuery(v); setSel(0); setOpenId(null); setSugSel(-1); }}
              results={results}
              suggestions={suggestions}
              sugSel={sugSel}
              onSugHover={(i) => setSugSel(i)}
              onSugActivate={(i) => { if (suggestions[i]) applySuggestion(suggestions[i]); }}
              onSummon={summonSearch}
              sel={sel}
              total={scopedEntries.length}
              searchKb={searchKb}
              onScopeKb={(id) => { setSearchKb(id); setSel(0); setOpenId(null); setSugSel(-1); }}
              viewType={viewType}
              setViewType={(v) => { setViewType(v); setOpenId(null); }}
              theme={t}
              selectedEntry={selectedListEntry}
              selectedId={selectedListId}
              onClear={clearSearch}
              onSuggest={(suggestion) => {
                setQuery(suggestion.value);
                setSel(0);
                setOpenId(suggestion.entryId ?? null);
                setTimeout(() => inputRef.current?.focus(), 20);
              }}
              onOpen={(id, index) => { if (typeof index === 'number') setSel(index); setOpenId(id); }}
              onOpenAI={() => setAiOpen(true)}
              kbs={kbs}
              folders={folders}
            />
          )}

          {mode === 'free' && (
            <div className="ik-free-stage">
              <FreeMode
                entries={entries}
                kbs={kbs}
                folders={folders}
                freeKb={freeKb}
                freeFolder={freeFolder}
                setFreeKb={setFreeKb}
                setFreeFolder={setFreeFolder}
                onNew={() => setFormOpen(true)}
                onCreate={handleCreate}
                onUpdate={handleUpdate}
                onDelete={handleDelete}
                onReorderEntries={handleReorder}
                onImported={handleImported}
                onCreateKb={handleCreateKb}
                onCreateFolder={handleCreateFolder}
                onRenameKb={handleRenameKb}
                onDeleteKb={handleDeleteKb}
                onRenameFolder={handleRenameFolder}
                onDeleteFolder={handleDeleteFolder}
                onMoveFolder={handleMoveFolder}
                onReorderFolders={handleReorderFolders}
              />
            </div>
          )}

          {loaded && entries.length === 0 && (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--mut)', fontSize: 13 }}>
              未能从服务端加载数据，请确认后端已启动（/api/entries）。
            </div>
          )}
        </div>
      </div>

      {modalEntry && <DetailModal entry={modalEntry} onClose={closeAll} />}
      {aiOpen && <AskModal query={query} onClose={closeAll} />}
      {formOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            zIndex: 50,
            overflow: 'auto',
            padding: '32px 16px',
          }}
          onClick={closeAll}
        >
          <div
            style={{
              maxWidth: 1000,
              margin: '0 auto',
              background: 'var(--bg)',
              border: '1px solid var(--bd)',
              borderRadius: 16,
              padding: '16px 20px 24px',
              boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <EntryEditor
              initial={null}
              kbs={kbs}
              folders={folders}
              defaultKbId={mode === 'free' ? freeKb ?? undefined : undefined}
              defaultFolderId={mode === 'free' ? freeFolder : null}
              onCancel={closeAll}
              onSave={(input) =>
                handleCreate(input).then((entry) => {
                  setFormOpen(false);
                  return entry;
                })
              }
            />
          </div>
        </div>
      )}
      <Toaster />
    </div>
  );
}
