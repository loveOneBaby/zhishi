import { useEffect, useMemo, useState } from 'react';
import { History, RotateCcw, Sparkles, ImagePlus, Pencil, Save, X, RefreshCw, Check } from 'lucide-react';
import type { Entry } from '../types';
import { fetchEntryVersions, restoreEntryVersion, type EntryVersion } from '../api';
import { toast } from '../toast';
import BlockEditor from './BlockEditor';

interface Props {
  entry: Entry;
  onClose: () => void;
  onRestored: (entry: Entry) => void;
}

const SOURCE_META: Record<string, { label: string; icon: typeof Pencil; tone: string }> = {
  'manual-edit': { label: '手动编辑', icon: Pencil, tone: 'var(--fg)' },
  manual: { label: '手动保存', icon: Save, tone: 'var(--fg)' },
  'ai-rewrite': { label: 'AI 改写', icon: Sparkles, tone: 'var(--accent)' },
  'ai-illustration': { label: 'AI 图解', icon: ImagePlus, tone: 'var(--accent)' },
  'restore-backup': { label: '恢复前备份', icon: RotateCcw, tone: 'var(--mut)' },
};
function sourceMeta(source: string) {
  return SOURCE_META[source] ?? { label: '编辑', icon: Pencil, tone: 'var(--mut)' };
}

function relTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}
function absTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function VersionHistoryModal({ entry, onClose, onRestored }: Props) {
  const [versions, setVersions] = useState<EntryVersion[] | null>(null);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string>('__current__');
  const [armedId, setArmedId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  const load = (): void => {
    setVersions(null);
    setError('');
    fetchEntryVersions(entry.id)
      .then((list) => setVersions(list))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };
  useEffect(load, [entry.id]);

  const selected = useMemo(() => {
    if (selectedId === '__current__') return null;
    return versions?.find((v) => v.id === selectedId) ?? null;
  }, [versions, selectedId]);

  const previewDoc = selected ? selected.snapshot.doc : entry.doc;
  const previewTitle = selected ? selected.title : entry.title;

  const handleRestore = (version: EntryVersion): void => {
    if (restoring) return;
    setRestoring(true);
    restoreEntryVersion(entry.id, version.id)
      .then((updated) => {
        onRestored(updated);
        toast(`已恢复到 ${absTime(version.createdAt)} 的版本`, 'success');
        setArmedId(null);
        setSelectedId('__current__');
        load();
      })
      .catch((e) => toast('恢复失败：' + (e instanceof Error ? e.message : String(e)), 'error'))
      .finally(() => setRestoring(false));
  };

  return (
    <div className="ik-modal-scrim" onClick={onClose} style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', zIndex: 62, animation: 'ik-fade .15s' }}>
      <div className="ik-import-modal" onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 980, height: 'min(82vh, 760px)', display: 'flex', flexDirection: 'column', border: '1px solid var(--bd)', borderRadius: 16, padding: 0, overflow: 'hidden', animation: 'ik-pop .18s ease' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '16px 20px', borderBottom: '1px solid var(--bd)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <span style={{ display: 'inline-flex', width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center', background: 'color-mix(in srgb, var(--fg) 7%, var(--panel))', color: 'var(--fg)' }}><History size={17} strokeWidth={2.1} /></span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 740, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>版本历史 · {entry.title}</div>
              <div style={{ fontSize: 12, color: 'var(--mut)', marginTop: 1 }}>{versions ? `${versions.length} 个历史版本` : '加载中…'} · 选择任意版本预览并恢复</div>
            </div>
          </div>
          <button type="button" className="ik-segbtn" onClick={onClose} aria-label="关闭"><X size={15} strokeWidth={2.2} /></button>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '300px minmax(0, 1fr)' }}>
          <div style={{ minHeight: 0, overflow: 'auto', borderRight: '1px solid var(--bd)', padding: 10 }}>
            <button
              type="button"
              onClick={() => { setSelectedId('__current__'); setArmedId(null); }}
              style={{ width: '100%', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 4, padding: '11px 12px', marginBottom: 6, border: `1px solid ${selectedId === '__current__' ? 'var(--accent)' : 'var(--bd)'}`, borderRadius: 11, background: selectedId === '__current__' ? 'color-mix(in srgb, var(--accent) 10%, var(--panel))' : 'transparent', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 40%, var(--bd))', borderRadius: 6, padding: '1px 7px' }}>当前</span>
                <span style={{ fontSize: 12.5, fontWeight: 640, color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.title}</span>
              </div>
              <span style={{ fontSize: 11.5, color: 'var(--mut)' }}>正在使用的内容</span>
            </button>

            {error && <div style={{ padding: '12px', fontSize: 13, color: 'var(--danger)' }}>{error}</div>}
            {!versions && !error && <div style={{ padding: '20px', textAlign: 'center', color: 'var(--mut)', fontSize: 13 }}><RefreshCw size={16} style={{ animation: 'ik-spin 1s linear infinite' }} /></div>}
            {versions && versions.length === 0 && <div style={{ padding: '18px 12px', fontSize: 12.5, color: 'var(--mut)', textAlign: 'center' }}>还没有历史版本。编辑或 AI 改写后会自动保存版本。</div>}

            {versions?.map((v) => {
              const meta = sourceMeta(v.source);
              const Icon = meta.icon;
              const active = selectedId === v.id;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => { setSelectedId(v.id); setArmedId(null); }}
                  style={{ width: '100%', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 12px', marginBottom: 5, border: `1px solid ${active ? 'var(--bd)' : 'transparent'}`, borderRadius: 11, background: active ? 'var(--sel)' : 'transparent', cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 650, color: meta.tone }}><Icon size={12} strokeWidth={2.2} />{meta.label}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--mut)' }}>{relTime(v.createdAt)}</span>
                  </div>
                  <span style={{ fontSize: 12.5, fontWeight: 560, color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.title}</span>
                  <span style={{ fontSize: 11, color: 'var(--mut)' }}>{absTime(v.createdAt)}</span>
                </button>
              );
            })}
          </div>

          <div style={{ minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 18px', borderBottom: '1px solid var(--bd)' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 720, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{previewTitle}</div>
                <div style={{ fontSize: 11.5, color: 'var(--mut)', marginTop: 2 }}>{selected ? `${sourceMeta(selected.source).label} · ${absTime(selected.createdAt)}` : '当前内容'}</div>
              </div>
              {selected && (
                armedId === selected.id ? (
                  <button type="button" className="ik-segbtn ik-segbtn-primary" disabled={restoring} onClick={() => handleRestore(selected)}>
                    {restoring ? <RefreshCw size={14} style={{ animation: 'ik-spin 1s linear infinite' }} /> : <Check size={14} strokeWidth={2.4} />}确认恢复
                  </button>
                ) : (
                  <button type="button" className="ik-segbtn" onClick={() => setArmedId(selected.id)}><RotateCcw size={14} strokeWidth={2.2} />恢复此版本</button>
                )
              )}
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '14px 18px 28px' }}>
              <BlockEditor key={selectedId} editable={false} initialBlocks={previewDoc} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
