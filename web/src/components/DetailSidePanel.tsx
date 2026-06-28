import type { ReactNode } from 'react';
import type { Entry } from '../types';
import { highlightText } from '../highlight';
import BlockEditor from './BlockEditor';

interface Props {
  entry: Entry | null;
  query?: string;
  contextLabel?: string;
  actions?: ReactNode;
  loading?: boolean;
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

export default function DetailSidePanel({ entry, query = '', contextLabel, actions, loading = false }: Props) {
  if (!entry) {
    return (
      <aside
        className="ik-surface ik-detail-panel ik-detail-panel-empty"
        style={{
          position: 'relative',
          height: '100%',
          minHeight: 0,
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
      className="ik-surface ik-detail-panel"
      style={{
        position: 'relative',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {(contextLabel || actions) && <ActionBar label={contextLabel} actions={actions} />}
      <div className="ik-detail-head">
        <div className="ik-detail-title">{highlightText(entry.title, query)}</div>
        {entry.tags.length > 0 && (
          <div className="ik-detail-meta">
            <span>标签</span>
            {entry.tags.slice(0, 6).map((tag, index) => (
              <span key={tag} className="ik-detail-meta-item">
                {index > 0 && <i>/</i>}
                {highlightText(tag, query)}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="ik-detail-body">
        {loading ? (
          <div className="ik-detail-loading" role="status" aria-live="polite">
            <span className="ik-detail-loading-dot" />
            <span>正在加载知识点...</span>
          </div>
        ) : (
          /* 原生 BlockNote 只读渲染:图片/表格/代码/标题等都按块原样显示 */
          <BlockEditor key={`${entry.id}:${entry.doc ? 'full' : 'lite'}`} editable={false} initialBlocks={entry.doc} />
        )}
      </div>
    </aside>
  );
}
