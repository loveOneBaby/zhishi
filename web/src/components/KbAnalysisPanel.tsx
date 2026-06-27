import { useEffect, useState } from 'react';
import { FolderPlus, Pencil, Sparkles, Lightbulb, Check, X, RefreshCw, Zap } from 'lucide-react';
import type { KbAnalysis, KbSuggestion, KbSuggestionKind } from '../api';

export type KbApiState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: KbAnalysis };

interface Props {
  kbName: string;
  analysis: KbApiState;
  appliedIds: Set<string>;
  runningId: string | null;
  applyingAll?: boolean;
  onClose?: () => void;
  onRetry: () => void;
  onApply: (s: KbSuggestion) => void;
  onApplyAll?: (list: KbSuggestion[]) => void;
  onCancel?: () => void;
}

const KIND_META: Record<KbSuggestionKind, { label: string; apply: string; icon: typeof FolderPlus; tone: string }> = {
  'create-folder': { label: '新建文件夹', apply: '新建', icon: FolderPlus, tone: 'var(--fg)' },
  'rename-folder': { label: '重命名目录', apply: '重命名', icon: Pencil, tone: 'var(--fg)' },
  'create-entry': { label: '补全知识点', apply: '生成', icon: Sparkles, tone: 'var(--accent)' },
  'rewrite-entry': { label: '改写知识点', apply: '改写', icon: Sparkles, tone: 'var(--accent)' },
  'refine-entry': { label: '按建议改写', apply: '应用', icon: Lightbulb, tone: 'var(--accent)' },
  note: { label: '建议', apply: '', icon: Lightbulb, tone: 'var(--mut)' },
};

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--mut)', marginBottom: 5 }}>
        <span>{label}</span><b style={{ color: 'var(--fg)' }}>{value}</b>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: 'color-mix(in srgb, var(--fg) 8%, var(--panel))', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${value}%`, borderRadius: 999, background: value >= 75 ? 'var(--accent)' : value >= 50 ? 'color-mix(in srgb, var(--accent) 70%, var(--mut))' : 'var(--danger)' }} />
      </div>
    </div>
  );
}

export default function KbAnalysisPanel({ kbName, analysis, appliedIds, runningId, applyingAll, onClose, onRetry, onApply, onApplyAll, onCancel }: Props) {
  const busy = Boolean(runningId) || Boolean(applyingAll);
  const pending = analysis.status === 'ready'
    ? analysis.data.suggestions.filter((s) => s.kind !== 'note' && !appliedIds.has(s.id))
    : [];
  // 单条建议保留二次确认;批量应用直接执行,避免“一键应用全部”看起来没有反应。
  const [armedId, setArmedId] = useState<string | null>(null);
  useEffect(() => {
    if (!armedId) return;
    const timer = setTimeout(() => setArmedId(null), 4000);
    return () => clearTimeout(timer);
  }, [armedId]);
  return (
    <div className="ik-ai-analysis">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ display: 'inline-flex', width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center', background: 'color-mix(in srgb, var(--accent) 14%, var(--panel))', color: 'var(--accent)' }}><Sparkles size={15} strokeWidth={2.1} /></span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 740 }}>AI 分析 · {kbName}</div>
            <div style={{ fontSize: 11.5, color: 'var(--mut)', marginTop: 1 }}>诊断目录与内容,逐条一键应用</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {analysis.status !== 'loading' && <button type="button" className="ik-segbtn" onClick={onRetry} disabled={busy}><RefreshCw size={14} strokeWidth={2.2} />重新分析</button>}
          {onClose && <button type="button" className="ik-segbtn" onClick={onClose} disabled={busy} aria-label="收起分析"><X size={15} strokeWidth={2.2} /></button>}
        </div>
      </div>

      {analysis.status === 'loading' && (
        <div style={{ padding: '28px 0', textAlign: 'center', color: 'var(--mut)', fontSize: 13.5 }}>
          <RefreshCw size={18} style={{ animation: 'ik-spin 1s linear infinite' }} />
          <div style={{ marginTop: 8 }}>正在分析…</div>
          {onCancel && (
            <button type="button" className="ik-segbtn ik-segbtn-danger" style={{ marginTop: 14 }} onClick={onCancel}>
              <X size={14} strokeWidth={2.3} />取消分析
            </button>
          )}
        </div>
      )}

      {analysis.status === 'error' && (
        <div style={{ padding: '20px 0', textAlign: 'center' }}>
          <div style={{ fontSize: 13.5, color: 'var(--danger)', marginBottom: 10 }}>{analysis.message}</div>
          <button type="button" className="ik-segbtn" onClick={onRetry}><RefreshCw size={14} strokeWidth={2.2} />重试</button>
        </div>
      )}

      {analysis.status === 'ready' && (
        <>
          <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--fg)', marginBottom: 14 }}>{analysis.data.overview}</div>
          <div style={{ display: 'flex', gap: 14, marginBottom: 16 }}>
            <ScoreBar label={analysis.data.scoreLabels?.[0] ?? '结构'} value={analysis.data.scores.structure} />
            <ScoreBar label={analysis.data.scoreLabels?.[1] ?? '覆盖'} value={analysis.data.scores.coverage} />
            <ScoreBar label={analysis.data.scoreLabels?.[2] ?? '深度'} value={analysis.data.scores.depth} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 9 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--mut)' }}>优化建议 · {analysis.data.suggestions.length} 条</span>
            {onApplyAll && pending.length > 0 && (
              <button
                type="button"
                className="ik-segbtn ik-segbtn-primary"
                disabled={busy}
                onClick={() => onApplyAll(pending)}
              >
                {applyingAll ? <RefreshCw size={14} style={{ animation: 'ik-spin 1s linear infinite' }} /> : <Zap size={14} strokeWidth={2.2} />}
                {applyingAll ? '应用中…' : `应用全部 (${pending.length})`}
              </button>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {analysis.data.suggestions.map((s) => {
              const meta = KIND_META[s.kind] ?? KIND_META.note;
              const Icon = meta.icon;
              const applied = appliedIds.has(s.id);
              const actionable = s.kind !== 'note';
              return (
                <div key={s.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 11, padding: '11px 13px', border: '1px solid var(--bd)', borderRadius: 11, background: 'color-mix(in srgb, var(--fg) 2.5%, var(--panel))' }}>
                  <span style={{ display: 'inline-flex', width: 25, height: 25, flexShrink: 0, borderRadius: 7, alignItems: 'center', justifyContent: 'center', color: meta.tone, background: 'color-mix(in srgb, var(--fg) 5%, var(--panel))' }}><Icon size={14} strokeWidth={2.1} /></span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 10.5, color: 'var(--mut)', border: '1px solid var(--bd)', borderRadius: 6, padding: '1px 6px' }}>{meta.label}</span>
                      <span style={{ fontSize: 13, fontWeight: 640 }}>{s.title}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--mut)', lineHeight: 1.6, marginTop: 4 }}>{s.detail}</div>
                  </div>
                  {actionable && (
                    applied ? (
                      <span style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--accent)', fontWeight: 640 }}><Check size={14} strokeWidth={2.4} />已应用</span>
                    ) : runningId === s.id ? (
                      <span style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--mut)', fontWeight: 600 }}><RefreshCw size={13} style={{ animation: 'ik-spin 1s linear infinite' }} />处理中…</span>
                    ) : (
                      <button
                        type="button"
                        className="ik-segbtn ik-segbtn-primary"
                        style={{ flexShrink: 0 }}
                        disabled={busy}
                        onClick={() => {
                          if (armedId === s.id) { setArmedId(null); onApply(s); }
                          else setArmedId(s.id);
                        }}
                      >{armedId === s.id ? '确认？' : meta.apply}</button>
                    )
                  )}
                </div>
              );
            })}
            {analysis.data.suggestions.length === 0 && (
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--mut)', fontSize: 13 }}>暂无可执行建议,知识库结构已较完善。</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
