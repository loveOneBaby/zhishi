import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, Check, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';

type DialogTone = 'default' | 'danger';
type DialogSize = 'default' | 'wide';

interface Props {
  open: boolean;
  title: string;
  description?: string;
  inputLabel?: string;
  initialValue?: string;
  placeholder?: string;
  helper?: string;
  confirmText?: string;
  cancelText?: string;
  tone?: DialogTone;
  size?: DialogSize;
  icon?: ReactNode;
  progressSteps?: string[];
  liveLogs?: string[];
  livePlan?: string;
  livePlanLabel?: string;
  liveOutput?: string;
  liveOutputLabel?: string;
  preview?: ReactNode;
  closeOnConfirm?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (value: string) => Promise<void> | void;
}

export default function CommandDialog({
  open,
  title,
  description,
  inputLabel,
  initialValue = '',
  placeholder,
  helper,
  confirmText = '确认',
  cancelText = '取消',
  tone = 'default',
  size = 'default',
  icon,
  progressSteps,
  liveLogs,
  livePlan,
  livePlanLabel = '公开生成思路',
  liveOutput,
  liveOutputLabel = '模型输出',
  preview,
  closeOnConfirm = true,
  onOpenChange,
  onConfirm,
}: Props): ReactNode {
  const inputId = useId();
  const outputRef = useRef<HTMLPreElement | null>(null);
  const [draft, setDraft] = useState(initialValue);
  const [submitting, setSubmitting] = useState(false);
  const hasInput = Boolean(inputLabel);
  const disabled = submitting || (hasInput && !draft.trim());
  const activeProgressSteps = progressSteps?.filter(Boolean) ?? [];
  const activeLiveLogs = liveLogs?.filter(Boolean) ?? [];
  const showLive = submitting && (activeLiveLogs.length > 0 || Boolean(livePlan) || Boolean(liveOutput));
  const showProgress = submitting && !showLive && activeProgressSteps.length > 0;

  useEffect(() => {
    if (open) setDraft(initialValue);
  }, [initialValue, open]);

  useEffect(() => {
    const node = outputRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [liveOutput]);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (disabled) return;
    setSubmitting(true);
    try {
      await onConfirm(hasInput ? draft.trim() : draft);
      setSubmitting(false);
      if (closeOnConfirm) onOpenChange(false);
    } catch {
      // Caller owns user-facing error copy so the dialog can stay open for retry.
      setSubmitting(false);
    }
  }

  const visualIcon = icon ?? (tone === 'danger' ? <AlertTriangle size={18} strokeWidth={2.1} /> : <Check size={18} strokeWidth={2.2} />);

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!submitting) onOpenChange(next); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="ik-command-overlay" />
        <Dialog.Content
          className={`ik-command-dialog ${tone === 'danger' ? 'is-danger' : ''} ${size === 'wide' ? 'is-wide' : ''}`}
          onEscapeKeyDown={(event) => { if (submitting) event.preventDefault(); }}
          onPointerDownOutside={(event) => { if (submitting) event.preventDefault(); }}
        >
          <form onSubmit={(event) => void submit(event)}>
            <div className="ik-command-head">
              <span className="ik-command-icon" aria-hidden="true">{visualIcon}</span>
              <div className="ik-command-copy">
                <Dialog.Title className="ik-command-title">{title}</Dialog.Title>
                {description && <Dialog.Description className="ik-command-desc">{description}</Dialog.Description>}
              </div>
              <Dialog.Close className="ik-command-close" disabled={submitting} aria-label="关闭">
                <X size={16} strokeWidth={2.2} />
              </Dialog.Close>
            </div>

            {hasInput && (
              <label className="ik-command-field" htmlFor={inputId}>
                <span>{inputLabel}</span>
                <input
                  id={inputId}
                  value={draft}
                  placeholder={placeholder}
                  autoFocus
                  disabled={submitting}
                  onChange={(event) => setDraft(event.currentTarget.value)}
                />
              </label>
            )}

            {helper && <div className="ik-command-helper">{helper}</div>}

            {preview && <div className="ik-command-preview">{preview}</div>}

            {showProgress && (
              <div className="ik-command-progress" aria-live="polite">
                <div className="ik-command-progress-head">
                  <span>{activeProgressSteps[0]}</span>
                </div>
                <div className="ik-command-progress-list">
                  {activeProgressSteps.map((step, index) => (
                    <span key={step} className={index === 0 ? 'is-active' : ''}>{step}</span>
                  ))}
                </div>
              </div>
            )}

            {showLive && (
              <div className="ik-command-live" aria-live="polite">
                <div className="ik-command-live-head">实时生成</div>
                {activeLiveLogs.length > 0 && (
                  <div className="ik-command-live-log">
                    {activeLiveLogs.slice(-7).map((line, index) => (
                      <span key={`${line}-${index}`}>{line}</span>
                    ))}
                  </div>
                )}
                {livePlan && (
                  <div className="ik-command-live-output ik-command-live-plan">
                    <div>{livePlanLabel}</div>
                    <pre>{livePlan}</pre>
                  </div>
                )}
                <div className="ik-command-live-output">
                  <div>{liveOutputLabel}</div>
                  <pre ref={outputRef}>{liveOutput || '等待 Qwen 输出结构化 JSON...'}</pre>
                </div>
              </div>
            )}

            <div className="ik-command-actions">
              <Dialog.Close className="ik-command-btn ik-command-btn-ghost" disabled={submitting}>
                {cancelText}
              </Dialog.Close>
              <button
                type="submit"
                className={`ik-command-btn ik-command-btn-primary ${tone === 'danger' ? 'is-danger' : ''}`}
                disabled={disabled}
              >
                {submitting ? '处理中...' : confirmText}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
