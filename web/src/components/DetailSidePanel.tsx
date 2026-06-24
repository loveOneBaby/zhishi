import type { Entry } from '../types';
import { parseSections } from '../markdown';

interface Props {
  entry: Entry | null;
}

export default function DetailSidePanel({ entry }: Props) {
  if (!entry) {
    return (
      <aside
        style={{
          position: 'sticky',
          top: 24,
          height: 'calc(100vh - 48px)',
          border: '1px dashed var(--bd)',
          borderRadius: 18,
          background: 'color-mix(in srgb, var(--panel) 62%, transparent)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--mut)',
          fontSize: 13,
          textAlign: 'center',
          padding: 24,
        }}
      >
        点击左侧知识点，在这里查看完整内容
      </aside>
    );
  }

  const ps = parseSections(entry);

  return (
    <aside
      style={{
        position: 'sticky',
        top: 24,
        height: 'calc(100vh - 48px)',
        overflow: 'hidden',
        border: '1px solid var(--bd)',
        borderRadius: 18,
        background: 'var(--panel)',
        boxShadow: '0 18px 45px rgba(0,0,0,.07)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ padding: '22px 24px 18px', borderBottom: '1px solid var(--bd)', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          <span style={{ fontSize: 11, color: 'var(--mut)', border: '1px solid var(--bd)', borderRadius: 999, padding: '3px 8px' }}>{entry.cat}</span>
          {entry.tags.slice(0, 4).map((tag) => (
            <span key={tag} style={{ fontSize: 11, color: 'var(--mut)', border: '1px solid var(--bd)', borderRadius: 999, padding: '3px 8px' }}>#{tag}</span>
          ))}
        </div>
        <div style={{ fontSize: 26, lineHeight: 1.12, letterSpacing: '-.025em', fontWeight: 760, marginBottom: 10 }}>{entry.title}</div>
        <div style={{ fontSize: 13.5, lineHeight: 1.65, color: 'var(--mut)' }}>{entry.summary}</div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '22px 24px 28px' }}>
        {ps.intro && (
          <div style={{ fontSize: 13.5, lineHeight: 1.75, color: 'var(--mut)', marginBottom: 18, paddingBottom: 18, borderBottom: '1px solid var(--bd)' }}>
            {ps.intro}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {ps.nodes.map((node) => (
            <section key={node.key} style={{ border: '1px solid var(--bd)', borderRadius: 14, background: 'var(--bg)', padding: '16px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14.5, fontWeight: 720, marginBottom: 8 }}>
                <span style={{ width: 6, height: 6, borderRadius: 99, background: 'var(--fg)', opacity: 0.8, flexShrink: 0 }} />
                {node.title}
              </div>
              <div style={{ fontSize: 13.5, color: 'var(--fg)' }}>{node.content}</div>
            </section>
          ))}
        </div>
      </div>
    </aside>
  );
}
