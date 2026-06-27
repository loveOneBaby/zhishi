import { useEffect, useMemo, useRef } from 'react';
import { Sparkles, X } from 'lucide-react';
import { parseLiveRewrite } from './liveRewrite';

interface Props {
  title: string;
  raw: string;
  stage?: string;
  mode?: 'rewrite' | 'generate';
  onCancel?: () => void;
}

// 详情区里的“实时改写”视图:把流式输出逐字渲染成标题/正文,完成后由外层替换为最终 doc。
export default function LiveRewritePanel({ title, raw, stage, mode = 'rewrite', onCancel }: Props) {
  const verb = mode === 'generate' ? '生成' : '改写';
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const view = useMemo(() => parseLiveRewrite(raw), [raw]);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [raw]);

  const hasContent = view.pieces.length > 0;

  return (
    <div className="ik-live-rewrite">
      <div className="ik-live-rewrite-head">
        <span className="ik-live-rewrite-spark"><Sparkles size={15} strokeWidth={2.1} /></span>
        <div className="ik-live-rewrite-headtext">
          <div className="ik-live-rewrite-title">AI 正在{verb}「{title}」</div>
          <div className="ik-live-rewrite-stage">{stage || '边写边出,稍候片刻…'}</div>
        </div>
        {onCancel ? (
          <button type="button" className="ik-live-rewrite-cancel" onClick={onCancel}>
            <X size={14} strokeWidth={2.4} />取消改写
          </button>
        ) : (
          <span className="ik-live-rewrite-dots" aria-hidden="true"><i /><i /><i /></span>
        )}
      </div>

      <div className="ik-live-rewrite-body" ref={bodyRef}>
        {view.plan && (
          <div className="ik-live-rewrite-plan">
            <span className="ik-live-rewrite-plan-label">改写思路</span>
            <div className="ik-live-rewrite-plan-text">{view.plan}</div>
          </div>
        )}

        {hasContent ? (
          <div className="ik-live-rewrite-doc">
            {view.pieces.map((p, i) => {
              const last = i === view.pieces.length - 1;
              if (p.kind === 'title') {
                return (
                  <h4 className="ik-live-rewrite-h" key={i}>
                    {p.text}{last && <span className="ik-live-caret" />}
                  </h4>
                );
              }
              if (p.kind === 'summary') {
                return (
                  <p className="ik-live-rewrite-summary" key={i}>
                    {p.text}{last && <span className="ik-live-caret" />}
                  </p>
                );
              }
              return (
                <p className="ik-live-rewrite-p" key={i}>
                  {p.text}{last && <span className="ik-live-caret" />}
                </p>
              );
            })}
          </div>
        ) : (
          <div className="ik-live-rewrite-warming">
            {mode === 'generate' ? '正在构思内容' : '正在构思'}<span className="ik-live-caret" />
          </div>
        )}
      </div>
    </div>
  );
}
