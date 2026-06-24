import type { CSSProperties } from 'react';

export const seg = (active: boolean): CSSProperties => ({
  padding: '7px 18px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 13,
  fontFamily: 'inherit', fontWeight: active ? 600 : 400, transition: 'all .12s',
  background: active ? 'var(--fg)' : 'transparent', color: active ? 'var(--bg)' : 'var(--mut)',
});

export const seg2 = (active: boolean): CSSProperties => ({
  padding: '5px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12,
  fontFamily: 'inherit', fontWeight: active ? 600 : 400, transition: 'all .12s',
  background: active ? 'var(--fg)' : 'transparent', color: active ? 'var(--bg)' : 'var(--mut)',
});

export const chip = (active: boolean): CSSProperties => ({
  padding: '5px 13px', borderRadius: 7, border: '1px solid var(--bd)', cursor: 'pointer', fontSize: 12,
  fontFamily: 'inherit', transition: 'all .12s',
  background: active ? 'var(--fg)' : 'transparent', color: active ? 'var(--bg)' : 'var(--mut)',
});
