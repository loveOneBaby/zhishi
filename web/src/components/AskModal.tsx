import { useEffect, useState } from 'react';
import { askAI } from '../api';
import { renderMd } from '../markdown';

interface Props {
  query: string;
  onClose: () => void;
}

export default function AskModal({ query, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [answer, setAnswer] = useState('');
  const [configured, setConfigured] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    askAI(query)
      .then((r) => { if (active) { setAnswer(r.answer); setConfigured(r.configured); } })
      .catch((e) => { if (active) { setAnswer('请求失败：' + (e?.message || String(e))); setConfigured(false); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [query]);

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.32)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '80px 20px', zIndex: 50, animation: 'ik-fade .15s', overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 560, background: 'var(--panel)', border: '1px solid var(--bd)', borderRadius: 16, padding: 28, animation: 'ik-pop .18s ease' }}>
        <div style={{ fontSize: 12, color: 'var(--mut)', marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)' }} />
          AI 回答{configured ? '' : ' · 未配置'}
        </div>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>「{query}」</div>
        <div style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--fg)', background: 'var(--sel)', borderRadius: 10, padding: 16, minHeight: 60 }}>
          {loading
            ? <span style={{ color: 'var(--mut)' }}>正在生成…</span>
            : answer
              ? renderMd(answer)
              : <span style={{ color: 'var(--mut)' }}>内容已清空</span>}
        </div>
        <div style={{ marginTop: 18, display: 'flex', gap: 10 }}>
          <button
            onClick={() => setAnswer('')}
            disabled={loading || !answer}
            style={{ padding: '9px 16px', fontSize: 13, fontFamily: 'inherit', cursor: loading || !answer ? 'default' : 'pointer', background: 'transparent', color: 'var(--mut)', border: '1px solid var(--bd)', borderRadius: 9, opacity: loading || !answer ? 0.55 : 1 }}
          >
            清空内容
          </button>
          <button onClick={onClose} style={{ padding: '9px 16px', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer', background: 'var(--fg)', color: 'var(--bg)', border: 'none', borderRadius: 9 }}>好的</button>
        </div>
      </div>
    </div>
  );
}
