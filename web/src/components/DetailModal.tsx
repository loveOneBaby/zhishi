import type { Entry } from '../types';
import { parseSections } from '../markdown';

interface Props {
  entry: Entry;
  onClose: () => void;
}

export default function DetailModal({ entry, onClose }: Props) {
  const ps = parseSections(entry);

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.38)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 50, animation: 'ik-fade .15s' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 1080, height: '88vh', background: 'var(--bg)', backgroundImage: 'radial-gradient(var(--bd) 1px, transparent 1px)', backgroundSize: '22px 22px', border: '1px solid var(--bd)', borderRadius: 18, display: 'flex', flexDirection: 'column', overflow: 'hidden', animation: 'ik-pop .18s ease', boxShadow: '0 30px 70px rgba(0,0,0,.22)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 22px', background: 'var(--panel)', borderBottom: '1px solid var(--bd)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--mut)' }}>
            <span style={{ border: '1px solid var(--bd)', borderRadius: 6, padding: '3px 9px', color: 'var(--fg)' }}>{entry.cat}</span>
            <span style={{ fontWeight: 600, color: 'var(--fg)', fontSize: 14 }}>{entry.title}</span>
            <span>·</span>
            <span>{ps.nodes.length} 个知识点</span>
          </div>
          <button onClick={onClose} style={{ background: 'var(--sel)', border: 'none', width: 30, height: 30, borderRadius: 8, cursor: 'pointer', color: 'var(--mut)', fontSize: 15 }}>✕</button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '48px 40px' }}>
          <div style={{ display: 'flex', alignItems: 'center', minWidth: 'max-content' }}>
            <div style={{ flexShrink: 0, width: 300, background: 'var(--fg)', color: 'var(--bg)', borderRadius: 16, padding: 24, boxShadow: '0 12px 30px rgba(0,0,0,.18)' }}>
              <div style={{ display: 'flex', gap: 7, marginBottom: 12, flexWrap: 'wrap' }}>
                {entry.tags.map((t, i) => (
                  <span key={i} style={{ fontSize: 11, opacity: 0.7 }}>#{t}</span>
                ))}
              </div>
              <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-.01em', lineHeight: 1.15, marginBottom: 12 }}>{entry.title}</div>
              <div style={{ fontSize: 13.5, lineHeight: 1.6, opacity: 0.82 }}>{entry.summary}</div>
              {ps.intro && (
                <div style={{ fontSize: 12.5, lineHeight: 1.6, opacity: 0.7, marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(128,128,128,.35)' }}>{ps.intro}</div>
              )}
            </div>

            <div style={{ position: 'relative', alignSelf: 'stretch', width: 64, flexShrink: 0 }}>
              <div style={{ position: 'absolute', left: 32, top: 0, bottom: 0, width: 2, background: 'var(--bd)' }} />
              <div style={{ position: 'absolute', left: 0, top: '50%', width: 32, height: 2, background: 'var(--bd)' }} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 18, flexShrink: 0, width: 380 }}>
              {ps.nodes.map((node) => (
                <div key={node.key} style={{ position: 'relative', background: 'var(--panel)', border: '1px solid var(--bd)', borderRadius: 14, padding: '18px 20px', boxShadow: '0 4px 16px rgba(0,0,0,.06)' }}>
                  <div style={{ position: 'absolute', left: -32, top: '50%', width: 32, height: 2, background: 'var(--bd)' }} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />{node.title}
                  </div>
                  <div style={{ fontSize: 13.5 }}>{node.content}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
