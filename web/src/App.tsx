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
  type EntryInput as ApiEntryInput,
} from './api';
import TopBar, { type AppMode } from './components/TopBar';
import SearchMode from './components/SearchMode';
import FreeMode from './components/FreeMode';
import DetailModal from './components/DetailModal';
import AskModal from './components/AskModal';
import EntryEditor from './components/EntryEditor';
import Toaster from './components/Toaster';

export default function App() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [mode, setMode] = useState<AppMode>('search');
  const [viewType, setViewType] = useState<'list' | 'canvas'>('canvas');
  const [query, setQuery] = useState('');
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
  // 防抖：输入即时更新，过滤/建议在空闲时计算（避免逐字全量重算）
  const deferredQuery = useDeferredValue(query);
  const results = useMemo(
    () => (mode === 'search' ? filterEntries(entries, deferredQuery) : []),
    [entries, deferredQuery, mode]
  );
  const suggestions = useMemo(
    () => (mode === 'search' ? suggestQueries(entries, deferredQuery) : []),
    [entries, deferredQuery, mode]
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

      // 有联想时：↑↓ 走联想下拉；否则保持原有的「结果列表」选择
      const hasSug = suggestions.length > 0;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (hasSug) { setSugSel((s) => (s + 1) % suggestions.length); setOpenId(null); return; }
        setSugSel(-1);
        setOpenId(null);
        setSel((s) => Math.min(s + 1, results.length - 1));
      }
      else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (hasSug) { setSugSel((s) => (s - 1 + suggestions.length) % suggestions.length); setOpenId(null); return; }
        setSugSel(-1);
        setOpenId(null);
        setSel((s) => Math.max(0, s - 1));
      }
      else if (e.key === 'Enter') {
        e.preventDefault();
        if (sugSel >= 0 && suggestions[sugSel]) { applySuggestion(suggestions[sugSel]); return; }
        const clamped = Math.min(sel, Math.max(0, results.length - 1));
        if (results[clamped]) setOpenId(results[clamped].id);
        else if (query.trim()) setAiOpen(true);
      } else if (e.key === 'Escape') {
        if (sugSel >= 0) { setSugSel(-1); return; }   // 先关联想下拉
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

  const openEntry = openId ? entries.find((e) => e.id === openId) ?? null : null;
  const selectedListEntry = isSearchList
    ? (results.find((e) => e.id === openId) ?? results[Math.min(sel, Math.max(0, results.length - 1))] ?? null)
    : null;
  const selectedListId = selectedListEntry?.id ?? null;
  const modalEntry = isSearchList ? null : openEntry;

  return (
    <div style={{ ...themeVars(t), minHeight: '100vh', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--font)', WebkitFontSmoothing: 'antialiased' }}>
      <div style={{ width: '100%', maxWidth: 'none', margin: 0, padding: '0 clamp(16px, 2.4vw, 44px) 44px' }}>
        <TopBar mode={mode} setMode={(m) => { setMode(m); setOpenId(null); if (m === 'free') { setFreeKb(null); setFreeFolder(null); } if (m === 'search') setTimeout(() => inputRef.current?.focus(), 40); }} theme={theme} setTheme={setTheme} />

        {mode === 'search' && (
          <SearchMode
            ref={inputRef}
            query={query}
            onInput={(v) => { setQuery(v); setSel(0); setOpenId(null); setSugSel(-1); }}
            results={results}
            suggestions={suggestions}
            sugSel={sugSel}
            onSugHover={(i) => setSugSel(i)}
            onSugActivate={(i) => { if (suggestions[i]) applySuggestion(suggestions[i]); }}
            onSummon={summonSearch}
            sel={sel}
            total={entries.length}
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
          <div style={{ paddingTop: 14 }}>
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
              onImported={handleImported}
              onCreateKb={handleCreateKb}
              onCreateFolder={handleCreateFolder}
              onRenameKb={handleRenameKb}
              onDeleteKb={handleDeleteKb}
              onRenameFolder={handleRenameFolder}
              onDeleteFolder={handleDeleteFolder}
            />
          </div>
        )}

        {loaded && entries.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--mut)', fontSize: 13 }}>
            未能从服务端加载数据，请确认后端已启动（/api/entries）。
          </div>
        )}
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
