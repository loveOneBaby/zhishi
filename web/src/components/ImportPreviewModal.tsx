import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { IndexNode } from '../types';
import type { ImportPreview, ImportPayload, PreviewEntry } from '../api';
import { renderMd } from '../markdown';

interface Props {
  payload: ImportPayload;
  preview: ImportPreview;
  busy: boolean;
  onClose: () => void;
  onConfirm: (replace: boolean) => void;
}

const PREVIEW_LIMIT = 300; // 条目过多时只渲染前若干条，避免一次性渲染卡顿

const badge = (bg: string, fg: string): CSSProperties => ({
  fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 6,
  background: bg, color: fg, flexShrink: 0, whiteSpace: 'nowrap',
});

// 递归渲染节点标题（仅预览结构，不渲染正文 markdown）
function NodeTitles({ nodes, depth }: { nodes: IndexNode[]; depth: number }) {
  return (
    <>
      {nodes.map((n, i) => (
        <div key={(n.id || '') + i}>
          <div style={{ paddingLeft: depth * 16, fontSize: 12.5, color: depth === 0 ? 'var(--fg)' : 'var(--mut)', lineHeight: 1.7 }}>
            <span style={{ color: 'var(--mut)', marginRight: 6 }}>{depth === 0 ? '▸' : '·'}</span>{n.title || '（无标题）'}
          </div>
          {n.children.length > 0 && <NodeTitles nodes={n.children} depth={depth + 1} />}
        </div>
      ))}
    </>
  );
}

export default function ImportPreviewModal({ payload, preview, busy, onClose, onConfirm }: Props) {
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const [armedReplace, setArmedReplace] = useState(false);

  const shown = preview.entries.slice(0, PREVIEW_LIMIT);
  const truncated = preview.entries.length - shown.length;

  function toggle(i: number) {
    setExpanded((cur) => { const n = new Set(cur); n.has(i) ? n.delete(i) : n.add(i); return n; });
  }

  return (
    <div onClick={busy ? undefined : onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.34)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '48px 20px', overflowY: 'auto', zIndex: 60, animation: 'ik-fade .15s' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 920, background: 'var(--panel)', border: '1px solid var(--bd)', borderRadius: 16, padding: 24, animation: 'ik-pop .18s ease' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700 }}>导入预览</div>
            <div style={{ fontSize: 12, color: 'var(--mut)', marginTop: 3 }}>
              共解析 {preview.total} 条 · 将导入 <b style={{ color: 'var(--fg)' }}>{preview.valid}</b> 条（新增 {preview.newCount} · 更新 {preview.updateCount}）{preview.skipped > 0 ? ` · 跳过 ${preview.skipped} 条（无标题）` : ''}
            </div>
          </div>
          <button onClick={onClose} disabled={busy} style={{ background: 'var(--sel)', border: 'none', width: 30, height: 30, borderRadius: 8, cursor: busy ? 'default' : 'pointer', color: 'var(--mut)', fontSize: 15 }}>✕</button>
        </div>

        {preview.byCat.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
            {preview.byCat.map((c) => (
              <span key={c.cat} style={{ fontSize: 11.5, color: 'var(--mut)', border: '1px solid var(--bd)', borderRadius: 7, padding: '3px 10px' }}>{c.cat} · {c.count}</span>
            ))}
          </div>
        )}

        <div style={{ border: '1px solid var(--bd)', borderRadius: 10, maxHeight: '52vh', overflow: 'auto', background: 'var(--bg)' }}>
          {shown.map((e, i) => <PreviewRow key={i} index={i} entry={e} open={expanded.has(i)} onToggle={() => toggle(i)} />)}
          {truncated > 0 && (
            <div style={{ padding: '12px 16px', fontSize: 12, color: 'var(--mut)', textAlign: 'center', borderTop: '1px solid var(--bd)' }}>
              …还有 {truncated} 条未展示，导入时全部生效
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11.5, color: 'var(--mut)' }}>
            {armedReplace ? '替换将先清空现有全部知识点，再次点击确认。' : '合并：按 id 更新已有、新增其余；替换：先清空再整体导入。'}
          </span>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={onClose} disabled={busy} style={{ padding: '9px 16px', fontSize: 13, fontFamily: 'inherit', cursor: busy ? 'default' : 'pointer', background: 'transparent', color: 'var(--mut)', border: '1px solid var(--bd)', borderRadius: 9 }}>取消</button>
            <button onClick={() => onConfirm(false)} disabled={busy} style={{ padding: '9px 18px', fontSize: 13, fontFamily: 'inherit', cursor: busy ? 'default' : 'pointer', background: 'transparent', color: 'var(--fg)', border: '1px solid var(--bd)', borderRadius: 9, opacity: busy ? 0.6 : 1 }}>{busy ? '导入中…' : '合并导入'}</button>
            <button
              onClick={() => { if (armedReplace) onConfirm(true); else setArmedReplace(true); }}
              disabled={busy}
              style={{ padding: '9px 18px', fontSize: 13, fontFamily: 'inherit', cursor: busy ? 'default' : 'pointer', background: armedReplace ? 'var(--danger)' : 'transparent', color: armedReplace ? 'var(--bg)' : 'var(--danger)', border: '1px solid var(--danger)', borderRadius: 9, fontWeight: armedReplace ? 600 : 400, opacity: busy ? 0.6 : 1 }}
            >
              {armedReplace ? '确认替换？' : '替换导入'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewRow({ index, entry, open, onToggle }: { index: number; entry: PreviewEntry; open: boolean; onToggle: () => void }) {
  const hasDetail = Boolean(entry.intro || entry.nodes.length);
  return (
    <div style={{ borderTop: index === 0 ? 'none' : '1px solid var(--bd)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }}>
        <button onClick={hasDetail ? onToggle : undefined} style={{ background: 'transparent', border: 'none', cursor: hasDetail ? 'pointer' : 'default', color: 'var(--mut)', fontSize: 11, width: 14, padding: 0, opacity: hasDetail ? 1 : 0.3 }}>{open ? '▾' : '▸'}</button>
        {entry.valid
          ? (entry.exists
            ? <span style={badge('var(--sel)', 'var(--fg)')}>更新</span>
            : <span style={badge('var(--fg)', 'var(--bg)')}>新增</span>)
          : <span style={badge('transparent', 'var(--danger)')}>将跳过</span>}
        <div style={{ flex: 1, minWidth: 0, cursor: hasDetail ? 'pointer' : 'default' }} onClick={hasDetail ? onToggle : undefined}>
          <div style={{ fontSize: 13.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.title}</div>
          <div style={{ fontSize: 11.5, color: 'var(--mut)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>{entry.summary}</div>
        </div>
        <span style={{ fontSize: 11, color: 'var(--mut)', flexShrink: 0, border: '1px solid var(--bd)', borderRadius: 6, padding: '2px 8px' }}>{entry.cat}</span>
        {entry.tags.length > 0 && (
          <span style={{ fontSize: 11, color: 'var(--mut)', flexShrink: 0, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.tags.join('、')}</span>
        )}
      </div>
      {open && hasDetail && (
        <div style={{ padding: '4px 18px 16px 46px', borderTop: '1px dashed var(--bd)' }}>
          {entry.intro && (
            <div style={{ fontSize: 13, lineHeight: 1.65, color: 'var(--fg)', marginBottom: entry.nodes.length ? 10 : 0 }}>{renderMd(entry.intro)}</div>
          )}
          {entry.nodes.length > 0 && <NodeTitles nodes={entry.nodes} depth={0} />}
        </div>
      )}
    </div>
  );
}
