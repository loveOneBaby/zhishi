import type { Entry } from '../types';
import { parseSections } from '../markdown';
import { highlightText } from '../highlight';

interface Props {
  entry: Entry | null;
  query?: string;
}

export default function DetailSidePanel({ entry, query = '' }: Props) {
  if (!entry) {
    return (
      <aside
        style={{
          position: 'sticky',
          top: 92,
          height: 'calc(100vh - 112px)',
          border: '1px dashed var(--bd)',
          borderRadius: 12,
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

  const ps = parseSections(entry, query);

  return (
    <aside
      style={{
        position: 'sticky',
        top: 92,
        height: 'calc(100vh - 112px)',
        overflow: 'hidden',
        border: '1px solid var(--bd)',
        borderRadius: 12,
        background: 'var(--panel)',
        boxShadow: '0 22px 56px rgba(0,0,0,.075)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ padding: '28px 32px 22px', borderBottom: '1px solid var(--bd)', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          <span style={{ fontSize: 11, color: 'var(--mut)', border: '1px solid var(--bd)', borderRadius: 999, padding: '3px 8px' }}>{highlightText(entry.cat, query)}</span>
          {entry.tags.slice(0, 4).map((tag) => (
            <span key={tag} style={{ fontSize: 11, color: 'var(--mut)', border: '1px solid var(--bd)', borderRadius: 999, padding: '3px 8px' }}>#{highlightText(tag, query)}</span>
          ))}
        </div>
        <div style={{ fontSize: 'clamp(28px, 2.4vw, 40px)', lineHeight: 1.08, letterSpacing: '0', fontWeight: 800, marginBottom: 12 }}>{highlightText(entry.title, query)}</div>
        <div style={{ fontSize: 14.5, lineHeight: 1.7, color: 'var(--mut)' }}>{highlightText(entry.summary, query)}</div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '26px 32px 34px' }}>
        {ps.intro && (
          <div style={{ fontSize: 14, lineHeight: 1.8, color: 'var(--mut)', marginBottom: 20, paddingBottom: 20, borderBottom: '1px solid var(--bd)' }}>
            {ps.intro}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {ps.nodes.map((node) => (
            <section key={node.key} style={{ border: '1px solid var(--bd)', borderRadius: 10, background: 'var(--bg)', padding: '18px 22px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 760, marginBottom: 10 }}>
                <span style={{ width: 6, height: 6, borderRadius: 99, background: 'var(--fg)', opacity: 0.8, flexShrink: 0 }} />
                {node.title}
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.78, color: 'var(--fg)' }}>{node.content}</div>
            </section>
          ))}
        </div>
      </div>
    </aside>
  );
}
