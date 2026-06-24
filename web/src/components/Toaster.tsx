import { useEffect, useState } from 'react';
import { subscribeToasts, type ToastItem } from '../toast';

export default function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => subscribeToasts(setItems), []);

  return (
    <div style={{ position: 'fixed', left: 0, right: 0, bottom: 26, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, zIndex: 100, pointerEvents: 'none' }}>
      {items.map((it) => (
        <div
          key={it.id}
          style={{
            pointerEvents: 'auto',
            maxWidth: 'min(520px, 90vw)',
            padding: '10px 16px',
            borderRadius: 10,
            fontSize: 13,
            fontFamily: 'inherit',
            color: 'var(--bg)',
            background: it.kind === 'error' ? 'var(--danger)' : it.kind === 'success' ? 'var(--accent)' : 'var(--fg)',
            boxShadow: '0 12px 36px rgba(0,0,0,.22)',
            animation: 'ik-pop .16s ease',
          }}
        >
          {it.msg}
        </div>
      ))}
    </div>
  );
}
