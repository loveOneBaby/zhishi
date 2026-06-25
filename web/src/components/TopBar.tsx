import type { ReactNode } from 'react';
import type { ThemeKey } from '../types';
import { THEMES } from '../themes';
import { seg } from '../ui';

export type AppMode = 'search' | 'free';

interface Props {
  mode: AppMode;
  setMode: (m: AppMode) => void;
  theme: ThemeKey;
  setTheme: (t: ThemeKey) => void;
  searchSlot?: ReactNode;
  searchTools?: ReactNode;
}

const MODES: { key: AppMode; label: string }[] = [
  { key: 'search', label: '检索' },
  { key: 'free', label: '知识库' },
];

const THEME_SWATCH: Record<ThemeKey, string> = {
  mono: 'linear-gradient(135deg, #18181b 0 50%, #fbfbfa 50% 100%)',
  ink: 'linear-gradient(135deg, #f2f2f0 0 50%, #0d0d0f 50% 100%)',
  paper: 'linear-gradient(135deg, #2b2620 0 50%, #f4f0e7 50% 100%)',
  glass: 'linear-gradient(135deg, rgba(79,110,247,.65) 0%, rgba(255,255,255,.85) 100%)',
};

export default function TopBar({ mode, setMode, theme, setTheme, searchSlot, searchTools }: Props) {
  return (
    <div style={{ position: 'sticky', top: 0, zIndex: 20, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 64, gap: 18, padding: '0 clamp(16px, 2.4vw, 44px)', borderBottom: '1px solid var(--bd)', background: 'color-mix(in srgb, var(--bg) 92%, transparent)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0, flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 2, background: 'var(--sel)', padding: 3, borderRadius: 9 }}>
          {MODES.map((m) => (
            <button key={m.key} style={seg(mode === m.key)} onClick={() => setMode(m.key)}>{m.label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <div style={{ width: 12, height: 12, background: 'var(--accent)', borderRadius: 3, boxShadow: '0 0 0 4px var(--sel)', flexShrink: 0 }} />
          <span style={{ fontSize: 16, fontWeight: 760, letterSpacing: '0', whiteSpace: 'nowrap' }}>知识检索</span>
        </div>
      </div>
      {searchSlot && <div style={{ flex: 1, minWidth: 0, maxWidth: 880 }}>{searchSlot}</div>}
      {searchTools && <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 14 }}>{searchTools}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 4, border: '1px solid var(--bd)', borderRadius: 999, background: 'color-mix(in srgb, var(--panel) 74%, transparent)', flexShrink: 0 }}>
        {(Object.keys(THEMES) as ThemeKey[]).map((k) => {
          const active = theme === k;
          return (
            <button
              key={k}
              type="button"
              aria-label={`切换到${THEMES[k].name}主题`}
              title={THEMES[k].name}
              onClick={() => setTheme(k)}
              style={{
                width: active ? 28 : 22,
                height: active ? 28 : 22,
                borderRadius: 999,
                border: active ? '2px solid var(--fg)' : '1px solid var(--bd)',
                background: THEME_SWATCH[k],
                cursor: 'pointer',
                padding: 0,
                boxShadow: active ? '0 8px 18px rgba(0,0,0,.14)' : 'none',
                transition: 'all .14s ease',
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
