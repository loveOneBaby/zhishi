import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Entry, ThemeKey } from './types';
import { THEMES, themeVars } from './themes';
import { filterEntries } from './search';
import { fetchEntries, createEntry, type NewEntryInput } from './api';
import TopBar from './components/TopBar';
import SearchMode from './components/SearchMode';
import FreeMode from './components/FreeMode';
import DetailModal from './components/DetailModal';
import AskModal from './components/AskModal';
import NewEntryModal from './components/NewEntryModal';

export default function App() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [mode, setMode] = useState<'search' | 'free'>('search');
  const [viewType, setViewType] = useState<'list' | 'canvas'>('list');
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const [theme, setThemeState] = useState<ThemeKey>('mono');
  const [freeCat, setFreeCat] = useState('全部');

  const [openId, setOpenId] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);

  // 加载数据 + 恢复主题
  useEffect(() => {
    const saved = localStorage.getItem('ik_theme');
    if (saved && (saved in THEMES)) setThemeState(saved as ThemeKey);
    fetchEntries()
      .then((e) => setEntries(e))
      .catch(() => setEntries([]))
      .finally(() => { setLoaded(true); setTimeout(() => inputRef.current?.focus(), 60); });
  }, []);

  const setTheme = (k: ThemeKey) => {
    setThemeState(k);
    try { localStorage.setItem('ik_theme', k); } catch { /* ignore */ }
  };

  const t = THEMES[theme];
  const results = useMemo(
    () => (mode === 'search' ? filterEntries(entries, query) : []),
    [entries, query, mode]
  );

  const closeAll = useCallback(() => { setOpenId(null); setAiOpen(false); setFormOpen(false); }, []);

  // 键盘交互：方向键选择、回车展开 / 触发 AI、esc 清空
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (openId || aiOpen || formOpen) { if (e.key === 'Escape') closeAll(); return; }
      if (mode !== 'search') return;
      if (viewType === 'canvas') { if (e.key === 'Escape' && query) { setQuery(''); setSel(0); } return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const clamped = Math.min(sel, Math.max(0, results.length - 1));
        if (results[clamped]) setOpenId(results[clamped].id);
        else if (query.trim()) setAiOpen(true);
      } else if (e.key === 'Escape') { if (query) { setQuery(''); setSel(0); } }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [openId, aiOpen, formOpen, mode, viewType, query, sel, results, closeAll]);

  async function handleSave(input: NewEntryInput) {
    try {
      const entry = await createEntry(input);
      setEntries((prev) => [...prev, entry]);
      setFormOpen(false);
    } catch (e) {
      alert('保存失败：' + (e instanceof Error ? e.message : String(e)));
    }
  }

  const openEntry = openId ? entries.find((e) => e.id === openId) ?? null : null;

  return (
    <div style={{ ...themeVars(t), minHeight: '100vh', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--font)', WebkitFontSmoothing: 'antialiased' }}>
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '0 24px' }}>
        <TopBar mode={mode} setMode={(m) => { setMode(m); if (m === 'search') setTimeout(() => inputRef.current?.focus(), 40); }} theme={theme} setTheme={setTheme} />

        {mode === 'search' ? (
          <SearchMode
            ref={inputRef}
            query={query}
            onInput={(v) => { setQuery(v); setSel(0); }}
            results={results}
            sel={sel}
            total={entries.length}
            viewType={viewType}
            setViewType={setViewType}
            theme={t}
            onOpen={(id) => setOpenId(id)}
            onOpenAI={() => setAiOpen(true)}
          />
        ) : (
          <FreeMode
            entries={entries}
            activeCat={freeCat}
            setCat={setFreeCat}
            onOpen={(id) => setOpenId(id)}
            onNew={() => setFormOpen(true)}
          />
        )}

        {loaded && entries.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--mut)', fontSize: 13 }}>
            未能从服务端加载数据，请确认后端已启动（/api/entries）。
          </div>
        )}
      </div>

      {openEntry && <DetailModal entry={openEntry} onClose={closeAll} />}
      {aiOpen && <AskModal query={query} onClose={closeAll} />}
      {formOpen && <NewEntryModal onClose={closeAll} onSave={handleSave} />}
    </div>
  );
}
