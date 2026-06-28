import type { Entry } from '../types';
import BlockEditor from './BlockEditor';

interface Props {
  entry: Entry;
  onClose: () => void;
}

export default function DetailModal({ entry, onClose }: Props) {
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.38)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 50, animation: 'ik-fade .15s' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 880, height: '88vh', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 18, display: 'flex', flexDirection: 'column', overflow: 'hidden', animation: 'ik-pop .18s ease', boxShadow: '0 30px 70px rgba(0,0,0,.22)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', background: 'var(--panel)', borderBottom: '1px solid var(--bd)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--mut)', minWidth: 0 }}>
            <span style={{ border: '1px solid var(--bd)', borderRadius: 6, padding: '3px 9px', color: 'var(--fg)', flexShrink: 0 }}>{entry.cat}</span>
            <span style={{ fontWeight: 600, color: 'var(--fg)', fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.title}</span>
          </div>
          <button onClick={onClose} style={{ background: 'var(--sel)', border: 'none', width: 30, height: 30, borderRadius: 8, cursor: 'pointer', color: 'var(--mut)', fontSize: 15, flexShrink: 0 }}>✕</button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '20px 28px 32px' }}>
          <div style={{ maxWidth: 760, margin: '0 auto' }}>
            <div style={{ display: 'flex', gap: 7, marginBottom: 10, flexWrap: 'wrap' }}>
              {entry.tags.map((t, i) => (
                <span key={i} style={{ fontSize: 11, color: 'var(--mut)' }}>#{t}</span>
              ))}
            </div>
            <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-.01em', lineHeight: 1.12, marginBottom: 10 }}>{entry.title}</div>
            {entry.summary && <div style={{ fontSize: 14.5, lineHeight: 1.7, color: 'var(--mut)', marginBottom: 12 }}>{entry.summary}</div>}
            {/* 原生 BlockNote 只读渲染 */}
            <BlockEditor key={`${entry.id}:${entry.doc ? 'full' : 'lite'}`} editable={false} initialBlocks={entry.doc} />
          </div>
        </div>
      </div>
    </div>
  );
}
