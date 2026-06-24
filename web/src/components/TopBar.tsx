import type { ThemeKey } from '../types';
import { THEMES } from '../themes';
import { seg, chip } from '../ui';

export type AppMode = 'search' | 'free' | 'manage';

interface Props {
  mode: AppMode;
  setMode: (m: AppMode) => void;
  theme: ThemeKey;
  setTheme: (t: ThemeKey) => void;
}

const MODES: { key: AppMode; label: string }[] = [
  { key: 'search', label: '检索' },
  { key: 'free', label: '自由' },
  { key: 'manage', label: '管理' },
];

export default function TopBar({ mode, setMode, theme, setTheme }: Props) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 60, borderBottom: '1px solid var(--bd)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 10, height: 10, background: 'var(--accent)', borderRadius: 2 }} />
        <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: '.02em' }}>知识检索</span>
        <span style={{ fontSize: 12, color: 'var(--mut)' }}>面试速查</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <div style={{ display: 'flex', gap: 2, background: 'var(--sel)', padding: 3, borderRadius: 9 }}>
          {MODES.map((m) => (
            <button key={m.key} style={seg(mode === m.key)} onClick={() => setMode(m.key)}>{m.label}</button>
          ))}
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
