import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { AlertCircle, CheckCircle2, Download, LoaderCircle, RefreshCw, RotateCcw } from 'lucide-react';

type UpdateState = InterviewKnowledgeDesktopUpdateState;

function desktopUpdates() {
  return window.interviewKnowledgeDesktop?.updates ?? null;
}

function formatPercent(value: number | null): string {
  if (value == null || Number.isNaN(value)) return '0%';
  const clamped = Math.max(0, Math.min(100, value));
  return `${clamped >= 10 ? Math.round(clamped) : clamped.toFixed(1)}%`;
}

function updateLabel(state: UpdateState): string {
  const version = state.version ? ` ${state.version}` : '';
  switch (state.status) {
    case 'checking':
      return '检查中';
    case 'available':
      return `更新${version}`;
    case 'downloading':
      return `下载 ${formatPercent(state.percent)}`;
    case 'downloaded':
      return `安装${version}`;
    case 'installing':
      return '安装中';
    case 'not-available':
      return '已是最新';
    case 'error':
      return '更新失败';
    case 'dev':
      return '开发模式';
    default:
      return '检查更新';
  }
}

function updateTitle(state: UpdateState): string {
  const lines = [state.message || updateLabel(state)];
  if (state.releaseNotes && state.status === 'available') lines.push(state.releaseNotes.slice(0, 240));
  return lines.filter(Boolean).join('\n\n');
}

function UpdateIcon({ status }: { status: UpdateState['status'] }) {
  if (status === 'checking' || status === 'downloading' || status === 'installing') {
    return <LoaderCircle size={15} strokeWidth={2.15} className="ik-update-spin" />;
  }
  if (status === 'available') return <Download size={15} strokeWidth={2.15} />;
  if (status === 'downloaded') return <RotateCcw size={15} strokeWidth={2.15} />;
  if (status === 'not-available') return <CheckCircle2 size={15} strokeWidth={2.15} />;
  if (status === 'error') return <AlertCircle size={15} strokeWidth={2.15} />;
  return <RefreshCw size={15} strokeWidth={2.15} />;
}

export default function DesktopUpdateButton() {
  const updater = desktopUpdates();
  const [state, setState] = useState<UpdateState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!updater) return undefined;
    let mounted = true;
    updater.getState().then((next) => {
      if (mounted) setState(next);
    }).catch(() => {});
    const off = updater.onState((next) => setState(next));
    return () => {
      mounted = false;
      off();
    };
  }, [updater]);

  const action = useMemo(() => {
    if (!state) return 'check';
    if (state.status === 'available') return 'download';
    if (state.status === 'downloaded') return 'install';
    return 'check';
  }, [state]);

  const handleClick = useCallback(async () => {
    if (!updater || !state || busy) return;
    if (['checking', 'downloading', 'installing', 'dev'].includes(state.status)) return;
    setBusy(true);
    try {
      const next = action === 'download'
        ? await updater.download()
        : action === 'install'
          ? await updater.install()
          : await updater.check();
      setState(next);
    } finally {
      setBusy(false);
    }
  }, [action, busy, state, updater]);

  if (!updater || !state) return null;

  const disabled = busy || ['checking', 'downloading', 'installing', 'dev'].includes(state.status);
  const progress = state.status === 'downloading' ? Math.max(0, Math.min(100, state.percent ?? 0)) : 0;
  const style = { '--ik-update-progress': String(progress / 100) } as CSSProperties;

  return (
    <button
      type="button"
      className={`ik-update-pill is-${state.status}`}
      style={style}
      onClick={handleClick}
      disabled={disabled}
      title={updateTitle(state)}
      aria-live="polite"
    >
      <span className="ik-update-progress" aria-hidden="true" />
      <span className="ik-update-icon" aria-hidden="true"><UpdateIcon status={state.status} /></span>
      <span className="ik-update-label">{updateLabel(state)}</span>
    </button>
  );
}
