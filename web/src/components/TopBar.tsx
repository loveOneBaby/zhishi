import type { ThemeKey } from '../types';
import { THEMES } from '../themes';
import { seg, chip } from '../ui';

interface Props {
  mode: 'search' | 'free';
  setMode: (m: 'search' | 'free') => void;
  theme: ThemeKey;
  setTheme: (t: ThemeKey) => void;
}

export default function TopBar({ mode, setMode, theme, setTheme }: Props) {
  const isSearch = mode === 'search';
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 60, borderBottom: '1px solid var(--bd)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 10, height: 10, background: 'var(--accent)', borderRadius: 2 }} />
        <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: '.02em' }}>知识检索</span>
        <span style={{ fontSize: 12, color: 'var(--mut)' }}>面试速查</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <div style={{ display: 'flex', gap: 2, background: 'var(--sel)', padding: 3, borderRadius: 9 }}>
          <button style={seg(isSearch)} onClick={() => setMode('search')}>检索</button>
          <button style={seg(!isSearch)} onClick={() => setMode('free')}>自由</button>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(Object.keys(THEMES) as ThemeKey[]).map((k) => (
            <button key={k} style={chip(theme === k)} onClick={() => setTheme(k)}>{THEMES[k].name}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
