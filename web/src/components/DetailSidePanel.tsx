import type { Entry } from '../types';
import { highlightText } from '../highlight';
import BlockEditor from './BlockEditor';

interface Props {
  entry: Entry | null;
  query?: string;
  contextLabel?: string;
  contextBadge?: string;
}

function DetailLocation({ label, badge }: { label?: string; badge?: string }) {
  if (!label) return null;
  return (
    <div className="ik-detail-location">
      <div className="ik-detail-location-copy">
        <span className="ik-detail-location-kicker">当前位置</span>
        <span className="ik-detail-location-path" title={label}>{label}</span>
      </div>
      {badge && <span className="ik-detail-location-badge">{badge}</span>}
    </div>
  );
}

export default function DetailSidePanel({ entry, query = '', contextLabel, contextBadge }: Props) {
  if (!entry) {
    return (
      <aside
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
          padding: '20px 24px 0',
          overflow: 'hidden',
        }}
      >
        <DetailLocation label={contextLabel} badge={contextBadge} />
        <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 0' }}>
          点击左侧知识点，在这里查看完整内容
        </div>
      </aside>
    );
  }

  return (
    <aside
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
      <div style={{ padding: '20px 32px 22px', borderBottom: '1px solid var(--bd)', flexShrink: 0 }}>
        <DetailLocation label={contextLabel} badge={contextBadge} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          <span style={{ fontSize: 11, color: 'var(--mut)', border: '1px solid var(--bd)', borderRadius: 999, padding: '3px 8px' }}>{highlightText(entry.cat, query)}</span>
          {entry.tags.slice(0, 4).map((tag) => (
            <span key={tag} style={{ fontSize: 11, color: 'var(--mut)', border: '1px solid var(--bd)', borderRadius: 999, padding: '3px 8px' }}>#{highlightText(tag, query)}</span>
          ))}
        </div>
        <div style={{ fontSize: 'clamp(28px, 2.4vw, 40px)', lineHeight: 1.08, letterSpacing: '0', fontWeight: 800, marginBottom: 12 }}>{highlightText(entry.title, query)}</div>
        <div style={{ fontSize: 14.5, lineHeight: 1.7, color: 'var(--mut)' }}>{highlightText(entry.summary, query)}</div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '14px 18px 34px' }}>
        {/* 原生 BlockNote 只读渲染:图片/表格/代码/标题等都按块原样显示 */}
        <BlockEditor key={entry.id} editable={false} initialBlocks={entry.doc} />
      </div>
    </aside>
  );
}
