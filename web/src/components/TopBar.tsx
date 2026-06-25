import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Check, SwatchBook } from 'lucide-react';
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

type ThemePreview = {
  bg: string;
  panel: string;
  fg: string;
  accent: string;
};

const THEME_PREVIEW: Record<ThemeKey, ThemePreview> = {
  mono: { bg: '#fbfbfa', panel: '#ffffff', fg: '#18181b', accent: '#18181b' },
  ink: { bg: '#0d0d0f', panel: '#161618', fg: '#f2f2f0', accent: '#f2f2f0' },
  paper: { bg: '#f4f0e7', panel: '#fcf9f2', fg: '#2b2620', accent: '#8a6f43' },
  glass: { bg: '#edf3fb', panel: 'rgba(255,255,255,.86)', fg: '#172033', accent: '#6f7ded' },
};
const THEME_KEYS = Object.keys(THEMES) as ThemeKey[];

function previewVars(k: ThemeKey): CSSProperties {
  const preview = THEME_PREVIEW[k];
  return {
    '--theme-preview-bg': preview.bg,
    '--theme-preview-panel': preview.panel,
    '--theme-preview-fg': preview.fg,
    '--theme-preview-accent': preview.accent,
  } as CSSProperties;
}

export default function TopBar({ mode, setMode, theme, setTheme, searchSlot, searchTools }: Props) {
  const [themeOpen, setThemeOpen] = useState(false);
  const themeMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!themeOpen) return undefined;
    const closeOnOutside = (event: PointerEvent): void => {
      if (!themeMenuRef.current?.contains(event.target as Node)) setThemeOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setThemeOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [themeOpen]);

  return (
    <div className="ik-topbar" style={{ position: 'sticky', top: 0, zIndex: 20, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 64, gap: 18, padding: '0 clamp(16px, 2.4vw, 44px)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0, flexShrink: 0 }}>
        <div className="ik-mode-switch" style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 9 }}>
          {MODES.map((m) => (
            <button key={m.key} style={seg(mode === m.key)} onClick={() => setMode(m.key)}>{m.label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <div className="ik-brand-mark" style={{ width: 12, height: 12, flexShrink: 0 }} />
          <span style={{ fontSize: 16, fontWeight: 760, letterSpacing: '0', whiteSpace: 'nowrap' }}>知识检索</span>
        </div>
      </div>
      {searchSlot && <div style={{ flex: 1, minWidth: 0, maxWidth: 880 }}>{searchSlot}</div>}
      {searchTools && <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 14 }}>{searchTools}</div>}
      <div ref={themeMenuRef} className="ik-theme-picker" style={{ flexShrink: 0 }}>
        <button
          type="button"
          className={`ik-theme-trigger ${themeOpen ? 'is-open' : ''}`}
          aria-label={`当前主题：${THEMES[theme].name}`}
          aria-haspopup="menu"
          aria-expanded={themeOpen}
          title={`当前主题：${THEMES[theme].name}`}
          onClick={() => setThemeOpen((open) => !open)}
          style={previewVars(theme)}
        >
          <SwatchBook size={15} strokeWidth={2.05} />
          <span className="ik-theme-trigger-preview" aria-hidden="true">
            <i />
          </span>
        </button>
        {themeOpen && (
          <div className="ik-theme-menu" role="menu" aria-label="切换主题">
            {THEME_KEYS.map((k) => {
              const active = theme === k;
              return (
                <button
                  key={k}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  className={`ik-theme-menu-item ${active ? 'is-active' : ''}`}
                  onClick={() => {
                    setTheme(k);
                    setThemeOpen(false);
                  }}
                >
                  <span className="ik-theme-menu-preview" style={previewVars(k)} aria-hidden="true">
                    <i />
                    <i />
                  </span>
                  <span className="ik-theme-menu-label">{THEMES[k].name}</span>
                  <span className="ik-theme-menu-check" aria-hidden="true">
                    {active && <Check size={13} strokeWidth={2.35} />}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
