import type { CSSProperties } from 'react';
import type { Theme, ThemeKey } from './types';

export const THEMES: Record<ThemeKey, Theme> = {
  mono:  { name: '极简', bg: '#fbfbfa', fg: '#18181b', mut: '#71717a', bd: '#e7e7e4', panel: '#ffffff', sel: '#f1f1ef', accent: '#18181b', danger: '#dc2626', font: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
  ink:   { name: '终端', bg: '#0d0d0f', fg: '#f2f2f0', mut: '#86868c', bd: '#272729', panel: '#161618', sel: '#202024', accent: '#f2f2f0', danger: '#f0606a', font: 'ui-monospace, "SF Mono", Menlo, monospace' },
  paper: { name: '纸感', bg: '#f4f0e7', fg: '#2b2620', mut: '#8a7d68', bd: '#ddd4c2', panel: '#fcf9f2', sel: '#ebe3d3', accent: '#2b2620', danger: '#c0392b', font: 'Georgia, "Times New Roman", serif' },
  glass: { name: '毛玻璃', bg: '#edf3fb', fg: '#172033', mut: '#647086', bd: 'rgba(111,127,156,0.22)', panel: 'rgba(255,255,255,0.72)', sel: 'rgba(255,255,255,0.58)', accent: '#4f63d7', danger: '#e23d47', font: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
};

// 把主题写成 CSS 变量挂到根节点
export function themeVars(t: Theme): CSSProperties {
  const vars: Record<string, string> = {
    '--bg': t.bg, '--fg': t.fg, '--mut': t.mut, '--bd': t.bd,
    '--panel': t.panel, '--sel': t.sel, '--accent': t.accent, '--danger': t.danger, '--font': t.font,
  };
  return vars as unknown as CSSProperties;
}
