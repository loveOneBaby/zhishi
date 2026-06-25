import type { CSSProperties } from 'react';
import type { Entry } from '../../types';

export const ghostBtn: CSSProperties = {
  padding: '10px 15px',
  fontSize: 13,
  fontFamily: 'inherit',
  cursor: 'pointer',
  background: 'var(--panel)',
  color: 'var(--fg)',
  border: '1px solid var(--bd)',
  borderRadius: 8,
  fontWeight: 620,
};

export const treePanelStyle: CSSProperties = {
  position: 'relative',
  height: '100%',
  minHeight: 0,
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
};

export const ROOT_IMPORT_TARGET = '__ik_root_folder__';

export function orderEntries(list: Entry[]): Entry[] {
  return [...list].sort((a, b) =>
    (a.sort ?? 0) - (b.sort ?? 0)
    || (a.createdAt ?? 0) - (b.createdAt ?? 0)
    || a.title.localeCompare(b.title, 'zh-Hans-CN'),
  );
}

export function newImportBatchId(): string {
  return `im_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
