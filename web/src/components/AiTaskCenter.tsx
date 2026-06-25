import { AlertCircle, Ban, CheckCircle2, Clock3, ExternalLink, Loader2, RefreshCw, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { AiKnowledgeBaseJob } from '../api';

interface Props {
  jobs: AiKnowledgeBaseJob[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenResult: (job: AiKnowledgeBaseJob) => void;
  onCancel: (id: string) => Promise<void>;
  onRetry: (id: string) => Promise<void>;
}

function statusLabel(status: AiKnowledgeBaseJob['status']): string {
  switch (status) {
    case 'queued': return '排队中';
    case 'running': return '生成中';
    case 'succeeded': return '已完成';
    case 'failed': return '失败';
    case 'cancelled': return '已取消';
  }
}

function jobKindLabel(job: AiKnowledgeBaseJob): string {
  return job.kind === 'folder-init' ? '目录初始化' : '新建知识库';
}

function runningText(job: AiKnowledgeBaseJob): string {
  if (job.status === 'queued') return '排队中';
  if (job.status === 'running') return job.kind === 'folder-init' ? '初始化中' : '生成中';
  return statusLabel(job.status);
}

function statusIcon(status: AiKnowledgeBaseJob['status']): ReactNode {
  if (status === 'succeeded') return <CheckCircle2 size={16} strokeWidth={2.2} />;
  if (status === 'failed') return <AlertCircle size={16} strokeWidth={2.2} />;
  if (status === 'cancelled') return <Ban size={16} strokeWidth={2.2} />;
  if (status === 'queued') return <Clock3 size={16} strokeWidth={2.2} />;
  return <Loader2 size={16} strokeWidth={2.2} className="ik-ai-task-spin" />;
}

function splitModelOutput(raw: string): { plan: string; json: string } {
  const output = raw.trimStart();
  const marker = output.indexOf('---JSON---');
  if (marker >= 0) {
    return {
      plan: output.slice(0, marker).trim(),
      json: output.slice(marker + '---JSON---'.length).trimStart(),
    };
  }
  const jsonStart = output.indexOf('{');
  if (jsonStart > 0) {
    return {
      plan: output.slice(0, jsonStart).trim(),
      json: output.slice(jsonStart).trimStart(),
    };
  }
  return { plan: output, json: '' };
}

function formatTime(ts: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

export default function AiTaskCenter({ jobs, open, onOpenChange, onOpenResult, onCancel, onRetry }: Props): ReactNode {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const sortedJobs = useMemo(() => [...jobs].sort((a, b) => b.createdAt - a.createdAt), [jobs]);
  const runningCount = sortedJobs.filter((job) => job.status === 'queued' || job.status === 'running').length;
  const failedCount = sortedJobs.filter((job) => job.status === 'failed').length;
  const selectedJob = sortedJobs.find((job) => job.id === selectedId) ?? sortedJobs[0] ?? null;
  const output = splitModelOutput(selectedJob?.modelOutput ?? '');
  const selectedKindLabel = selectedJob ? jobKindLabel(selectedJob) : 'AI 任务';

  useEffect(() => {
    if (!sortedJobs.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !sortedJobs.some((job) => job.id === selectedId)) {
      setSelectedId(sortedJobs[0].id);
    }
  }, [selectedId, sortedJobs]);

  if (!sortedJobs.length) return null;

  return (
    <>
      <button
        type="button"
        className={`ik-ai-task-dock ${runningCount ? 'is-running' : ''} ${failedCount ? 'has-error' : ''}`}
        onClick={() => onOpenChange(!open)}
        title="AI 任务"
      >
        <span className="ik-ai-task-dock-icon">
          {runningCount ? <Loader2 size={16} strokeWidth={2.2} className="ik-ai-task-spin" /> : <Sparkles size={16} strokeWidth={2.15} />}
        </span>
        <span>
          <b>{runningCount ? `${runningCount} 个运行中` : 'AI 任务'}</b>
          <small>{failedCount ? `${failedCount} 个失败` : `${sortedJobs.length} 个记录`}</small>
        </span>
      </button>

      {open && (
        <aside className="ik-ai-task-panel" aria-label="AI 任务进度">
          <header className="ik-ai-task-panel-head">
            <div>
              <span>AI 任务</span>
              <strong>{runningCount ? `${runningCount} 个正在生成` : '暂无运行中任务'}</strong>
            </div>
            <button type="button" className="ik-ai-task-close" onClick={() => onOpenChange(false)} aria-label="关闭任务面板">
              <X size={16} strokeWidth={2.25} />
            </button>
          </header>

          <div className="ik-ai-task-panel-body">
            <div className="ik-ai-task-list">
              {sortedJobs.map((job) => (
                <button
                  key={job.id}
                  type="button"
                  className={`ik-ai-task-row ${selectedJob?.id === job.id ? 'is-active' : ''} is-${job.status}`}
                  onClick={() => setSelectedId(job.id)}
                >
                  <span className="ik-ai-task-row-icon">{statusIcon(job.status)}</span>
                  <span className="ik-ai-task-row-main">
                    <b>{job.domain}</b>
                    <small>{jobKindLabel(job)} · {runningText(job)} · {formatTime(job.updatedAt)}</small>
                  </span>
                  {job.parsed && (
                    <span className="ik-ai-task-row-count">{job.kind === 'folder-init' ? job.parsed.folders : job.parsed.questions}</span>
                  )}
                </button>
              ))}
            </div>

            {selectedJob && (
              <section className="ik-ai-task-detail">
                <div className={`ik-ai-task-status is-${selectedJob.status}`}>
                  <span>{statusIcon(selectedJob.status)}</span>
                  <div>
                    <b>{selectedJob.domain}</b>
                    <small>
                      {selectedKindLabel} · {runningText(selectedJob)} · {selectedJob.parsed
                        ? (selectedJob.kind === 'folder-init'
                          ? `${selectedJob.parsed.folders} 个目录`
                          : `${selectedJob.parsed.folders} 个目录 / ${selectedJob.parsed.questions} 道题`)
                        : '等待结构化结果'}
                    </small>
                  </div>
                </div>

                {selectedJob.result && (
                  <button type="button" className="ik-ai-task-open" onClick={() => onOpenResult(selectedJob)}>
                    <ExternalLink size={15} strokeWidth={2.2} />进入「{selectedJob.result.kb.name}」
                  </button>
                )}

                {selectedJob.error && (
                  <div className="ik-ai-task-error">{selectedJob.error}</div>
                )}

                <div className="ik-ai-task-actions">
                  {(selectedJob.status === 'queued' || selectedJob.status === 'running') && (
                    <button type="button" className="ik-ai-task-secondary is-danger" onClick={() => { void onCancel(selectedJob.id); }}>
                      <Ban size={14} strokeWidth={2.2} />取消任务
                    </button>
                  )}
                  {(selectedJob.status === 'failed' || selectedJob.status === 'cancelled') && (
                    <button type="button" className="ik-ai-task-secondary" onClick={() => { void onRetry(selectedJob.id); }}>
                      <RefreshCw size={14} strokeWidth={2.2} />重新生成
                    </button>
                  )}
                </div>

                <div className="ik-ai-task-log">
                  <div>进度</div>
                  <ul>
                    {selectedJob.logs.slice(-8).map((line, index) => (
                      <li key={`${line}-${index}`}>{line}</li>
                    ))}
                  </ul>
                </div>

                {(output.plan || output.json) && (
                  <div className="ik-ai-task-output">
                    {output.plan && (
                      <div>
                        <span>{selectedJob.kind === 'folder-init' ? '目录规划' : '建库思路'}</span>
                        <pre>{output.plan}</pre>
                      </div>
                    )}
                    <div>
                      <span>{selectedJob.kind === 'folder-init' ? '目录 JSON' : '知识库 JSON'}</span>
                      <pre>{output.json || '等待 Qwen 输出结构化 JSON...'}</pre>
                    </div>
                  </div>
                )}
              </section>
            )}
          </div>
        </aside>
      )}
    </>
  );
}
