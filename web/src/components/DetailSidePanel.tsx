import type { ReactNode } from 'react';
import type { Entry } from '../types';
import { highlightText } from '../highlight';
import BlockEditor from './BlockEditor';

interface Props {
  entry: Entry | null;
  query?: string;
  contextLabel?: string;
  contextBadge?: string;
  actions?: ReactNode;
}

function ActionBar({ label, actions }: { label?: string; actions?: ReactNode }) {
  return (
    <div className="ik-action-bar">
      <span className="ik-action-spacer">
        {label && <span className="ik-action-crumb" title={label}>{label}</span>}
      </span>
      {actions}
    </div>
  );
}

export default function DetailSidePanel({ entry, query = '', contextLabel, actions }: Props) {
  if (!entry) {
    return (
      <aside
        className="ik-surface"
        style={{
          position: 'relative',
          height: '100%',
          minHeight: 0,
          border: '1px dashed var(--bd)',
          borderRadius: 12,
          background: 'color-mix(in srgb, var(--panel) 62%, transparent)',
          display: 'flex',
          flexDirection: 'column',
          color: 'var(--mut)',
          fontSize: 13,
          textAlign: 'center',
          overflow: 'hidden',
        }}
      >
        {(contextLabel || actions) && <ActionBar label={contextLabel} actions={actions} />}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
          点击左侧知识点，在这里查看完整内容
        </div>
      </aside>
    );
  }

  return (
    <aside
      className="ik-surface"
      style={{
        position: 'relative',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
        border: '1px solid var(--bd)',
        borderRadius: 12,
        background: 'var(--panel)',
        boxShadow: '0 10px 28px rgba(0,0,0,.045)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {(contextLabel || actions) && <ActionBar label={contextLabel} actions={actions} />}
      <div style={{ padding: '14px 28px 14px', borderBottom: '1px solid var(--bd)', flexShrink: 0, display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 'clamp(19px, 1.6vw, 25px)', lineHeight: 1.2, letterSpacing: '0', fontWeight: 780 }}>{highlightText(entry.title, query)}</div>
        {entry.tags.slice(0, 4).map((tag) => (
          <span key={tag} style={{ fontSize: 11, color: 'var(--mut)', border: '1px solid var(--bd)', borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap' }}>#{highlightText(tag, query)}</span>
        ))}
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '14px 18px 34px' }}>
        {/* 原生 BlockNote 只读渲染:图片/表格/代码/标题等都按块原样显示 */}
        <BlockEditor key={entry.id} editable={false} initialBlocks={entry.doc} />
      </div>
    </aside>
  );
}
