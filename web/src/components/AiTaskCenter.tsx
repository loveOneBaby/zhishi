import { AlertCircle, Ban, CheckCircle2, Clock3, ExternalLink, FileText, FolderTree, Loader2, RefreshCw, Sparkles, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { AiKnowledgeBaseJob, KbSuggestion } from '../api';
import KbAnalysisPanel, { type KbApiState } from './KbAnalysisPanel';
import LiveRewritePanel from './free/LiveRewritePanel';

// 前端流式 AI 操作(生成/改写/图解)的任务记录:运行时驱动实时预览,完成后作为记录保留
export interface LiveTask {
  id: string;
  entryId: string;
  title: string;
  label: string;
  mode: 'rewrite' | 'generate';
  status: 'running' | 'succeeded' | 'failed' | 'cancelled';
  stage: string;
  raw: string;
  createdAt: number;
}

export interface AiQuickAction {
  id: string;
  title: string;
  description: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  meta?: string;
  // 需要输入时:点击卡片就地展开输入框(不弹窗),提交后回调
  prompt?: {
    placeholder: string;
    submitLabel?: string;
    optional?: boolean;
    onSubmit: (value: string) => void;
  };
  // 需要二次确认时:点击卡片就地展开"确认/取消",防止误触
  confirm?: boolean;
}

interface Props {
  jobs: AiKnowledgeBaseJob[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenResult: (job: AiKnowledgeBaseJob) => void;
  onCancel: (id: string) => Promise<void>;
  onRetry: (id: string) => Promise<void>;
  onClearHistory: () => Promise<void>;
  actions?: AiQuickAction[];
  contextLabel?: string;
  onApplySuggestion?: (s: KbSuggestion) => void;
  onApplyAllSuggestions?: (list: KbSuggestion[]) => void;
  analysisAppliedIds?: Set<string>;
  analysisRunningId?: string | null;
  analysisApplyingAll?: boolean;
  liveTasks?: LiveTask[];
  onCancelLiveTask?: (id: string) => void;
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
  if (job.kind === 'folder-init') return '目录初始化';
  if (job.kind === 'folder-entries') return '目录生成知识点';
  if (job.kind === 'analyze') return job.entryId ? 'AI 分析知识点' : 'AI 分析知识库';
  return '新建知识库';
}

function runningText(job: AiKnowledgeBaseJob): string {
  if (job.status === 'queued') return '排队中';
  if (job.status === 'running') return job.kind === 'folder-init' ? '初始化中' : job.kind === 'analyze' ? '分析中' : '生成中';
  return statusLabel(job.status);
}

function parsedText(job: AiKnowledgeBaseJob): string {
  if (!job.parsed) return '等待结构化结果';
  if (job.kind === 'folder-init') return `${job.parsed.folders} 个目录`;
  return `${job.parsed.folders} 个目录 / ${job.parsed.questions} 条知识点`;
}

function outputPlanLabel(job: AiKnowledgeBaseJob): string {
  if (job.kind === 'folder-init') return '目录规划';
  if (job.kind === 'folder-entries') return '生成过程';
  return '建库思路';
}

function outputJsonLabel(job: AiKnowledgeBaseJob): string {
  if (job.kind === 'folder-init') return '目录 JSON';
  if (job.kind === 'folder-entries') return '知识点输出';
  return '知识库 JSON';
}

function liveStatusLabel(status: LiveTask['status']): string {
  switch (status) {
    case 'running': return '进行中';
    case 'succeeded': return '已完成';
    case 'failed': return '失败';
    case 'cancelled': return '已取消';
  }
}

function statusIcon(status: AiKnowledgeBaseJob['status'] | LiveTask['status']): ReactNode {
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

type JobResult = NonNullable<AiKnowledgeBaseJob['result']>;

function folderPath(result: JobResult, folderId: string | null): string {
  if (!folderId) return result.kb.name;
  const byId = new Map(result.folders.map((folder) => [folder.id, folder]));
  const names: string[] = [];
  let cursor = byId.get(folderId);
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    names.unshift(cursor.name);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return [result.kb.name, ...names].join(' / ');
}

function growthItems(job: AiKnowledgeBaseJob): Array<{
  id: string;
  kind: 'folder' | 'entry';
  title: string;
  subtitle: string;
  createdAt: number;
}> {
  const result = job.result;
  if (!result) return [];
  const folders = result.folders.map((folder) => ({
    id: folder.id,
    kind: 'folder' as const,
    title: folder.name,
    subtitle: folderPath(result, folder.parentId),
    createdAt: folder.createdAt ?? 0,
  }));
  const entries = result.entries.map((entry) => ({
    id: entry.id,
    kind: 'entry' as const,
    title: entry.title,
    subtitle: folderPath(result, entry.folderId),
    createdAt: entry.createdAt ?? 0,
  }));
  return [...folders, ...entries]
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(-14);
}

export default function AiTaskCenter({
  jobs,
  open,
  onOpenChange,
  onOpenResult,
  onCancel,
  onRetry,
  onClearHistory,
  actions = [],
  contextLabel,
  onApplySuggestion,
  onApplyAllSuggestions,
  analysisAppliedIds,
  analysisRunningId,
  analysisApplyingAll,
  liveTasks = [],
  onCancelLiveTask,
}: Props): ReactNode {
  const runningLive = liveTasks.find((t) => t.status === 'running') ?? null;
  const sortedLive = useMemo(() => [...liveTasks].sort((a, b) => b.createdAt - a.createdAt), [liveTasks]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [promptId, setPromptId] = useState<string | null>(null);
  const [promptValue, setPromptValue] = useState('');
  const closePrompt = () => { setPromptId(null); setPromptValue(''); };
  const sortedJobs = useMemo(() => [...jobs].sort((a, b) => b.createdAt - a.createdAt), [jobs]);
  const runningCount = sortedJobs.filter((job) => job.status === 'queued' || job.status === 'running').length;
  const historyCount = sortedJobs.length - runningCount;
  const failedCount = sortedJobs.filter((job) => job.status === 'failed').length;
  const selectedJob = sortedJobs.find((job) => job.id === selectedId) ?? sortedJobs[0] ?? null;
  const output = splitModelOutput(selectedJob?.modelOutput ?? '');
  const selectedKindLabel = selectedJob ? jobKindLabel(selectedJob) : 'AI 任务';
  const liveItems = selectedJob ? growthItems(selectedJob) : [];
  const retryText = selectedJob?.resumable ? '继续生成' : '重新生成';

  useEffect(() => {
    if (!sortedJobs.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !sortedJobs.some((job) => job.id === selectedId)) {
      setSelectedId(sortedJobs[0].id);
    }
  }, [selectedId, sortedJobs]);

  // 新建任务时自动定位过去:监测最新任务 id,出现更新的任务就选中它
  const lastTopIdRef = useRef<string | null>(null);
  useEffect(() => {
    const top = sortedJobs[0];
    if (!top) { lastTopIdRef.current = null; return; }
    if (lastTopIdRef.current !== null && top.id !== lastTopIdRef.current) {
      setSelectedId(top.id);
    }
    lastTopIdRef.current = top.id;
  }, [sortedJobs]);

  if (!sortedJobs.length && !actions.length) return null;

  return (
    <>
      <button
        type="button"
        className={`ik-ai-task-dock ${runningCount ? 'is-running' : ''} ${failedCount ? 'has-error' : ''}`}
        onClick={() => onOpenChange(!open)}
        title="AI 控制台"
      >
        <span className="ik-ai-task-dock-icon">
          {runningCount ? <Loader2 size={16} strokeWidth={2.2} className="ik-ai-task-spin" /> : <Sparkles size={16} strokeWidth={2.15} />}
        </span>
        <span>
          <b>{runningCount ? `${runningCount} 个运行中` : 'AI 控制台'}</b>
          <small>{failedCount ? `${failedCount} 个失败` : sortedJobs.length ? `${sortedJobs.length} 个记录` : `${actions.length} 个快捷动作`}</small>
        </span>
      </button>

      {open && (
        <aside className="ik-ai-task-panel" aria-label="AI 控制台">
          <header className="ik-ai-task-panel-head">
            <div>
              <span>AI Control</span>
              <strong>AI 控制台</strong>
              {contextLabel && <small className="ik-ai-task-context">{contextLabel}</small>}
            </div>
            <div className="ik-ai-task-head-actions">
              {historyCount > 0 && (
                <button type="button" className="ik-ai-task-clear" onClick={() => { void onClearHistory(); }}>
                  <Trash2 size={14} strokeWidth={2.2} />清除历史
                </button>
              )}
              <button type="button" className="ik-ai-task-close" onClick={() => onOpenChange(false)} aria-label="关闭任务面板">
                <X size={16} strokeWidth={2.25} />
              </button>
            </div>
          </header>

          {actions.length > 0 && (
            <section className="ik-ai-command-zone">
              <div className="ik-ai-command-head">
                <span>快捷动作</span>
                <b>{runningCount ? `${runningCount} 个后台任务运行中` : '按当前位置执行'}</b>
              </div>
              <div className="ik-ai-command-grid">
                {actions.map((action, index) => {
                  const open = promptId === action.id && (Boolean(action.prompt) || Boolean(action.confirm));
                  const alignRight = index % 3 === 2;
                  return (
                    <div className={`ik-ai-command-cell ${open ? 'is-open' : ''} ${alignRight ? 'is-right' : ''}`} key={action.id}>
                      <button
                        type="button"
                        className="ik-ai-command-card"
                        disabled={action.disabled}
                        title={action.description}
                        onClick={() => {
                          if (action.disabled) return;
                          if (action.prompt || action.confirm) { setPromptValue(''); setPromptId(open ? null : action.id); return; }
                          action.onClick();
                        }}
                      >
                        <span className="ik-ai-command-icon">{action.icon}</span>
                        <b className="ik-ai-command-label">{action.title}</b>
                      </button>
                      {open && (
                        <>
                          <div className="ik-ai-pop-backdrop" onClick={closePrompt} />
                          <div className="ik-ai-command-pop" role="dialog">
                            {action.prompt ? (
                              <form
                                onSubmit={(e) => {
                                  e.preventDefault();
                                  const value = promptValue.trim();
                                  if (!value && !action.prompt?.optional) return;
                                  action.prompt?.onSubmit(value);
                                  closePrompt();
                                }}
                              >
                                <input
                                  autoFocus
                                  className="ik-ai-command-input"
                                  placeholder={action.prompt.placeholder}
                                  value={promptValue}
                                  onChange={(e) => setPromptValue(e.target.value)}
                                  onKeyDown={(e) => { if (e.key === 'Escape') closePrompt(); }}
                                />
                                <div className="ik-ai-pop-actions">
                                  <button type="button" className="ik-ai-pop-cancel" onClick={closePrompt}>取消</button>
                                  <button type="submit" className="ik-ai-command-go">{action.prompt.submitLabel ?? '生成'}</button>
                                </div>
                              </form>
                            ) : (
                              <>
                                <div className="ik-ai-pop-text">确认执行「{action.title}」？</div>
                                <div className="ik-ai-pop-actions">
                                  <button type="button" className="ik-ai-pop-cancel" onClick={closePrompt}>取消</button>
                                  <button type="button" className="ik-ai-command-go" onClick={() => { action.onClick(); closePrompt(); }}>确认</button>
                                </div>
                              </>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {(sortedJobs.length > 0 || liveTasks.length > 0) ? (
          <div className="ik-ai-task-panel-body">
            <div className="ik-ai-task-list">
              {sortedLive.map((task) => (
                <div key={task.id} className={`ik-ai-task-row is-${task.status === 'running' ? 'live-active' : task.status} ${task.status === 'running' ? 'is-active' : ''}`}>
                  <span className="ik-ai-task-row-icon">{statusIcon(task.status)}</span>
                  <span className="ik-ai-task-row-main">
                    <b>{task.title}</b>
                    <small>{task.label} · {task.stage || liveStatusLabel(task.status)}</small>
                  </span>
                  {task.status === 'running' && onCancelLiveTask && (
                    <button type="button" className="ik-ai-task-row-cancel" onClick={() => onCancelLiveTask(task.id)} aria-label="取消"><X size={14} strokeWidth={2.3} /></button>
                  )}
                </div>
              ))}
              {sortedJobs.map((job) => (
                <button
                  key={job.id}
                  type="button"
                  className={`ik-ai-task-row ${!runningLive && selectedJob?.id === job.id ? 'is-active' : ''} is-${job.status}`}
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

            {runningLive ? (
              <section className="ik-ai-task-detail ik-ai-task-detail-live">
                <LiveRewritePanel title={runningLive.title} raw={runningLive.raw} stage={runningLive.stage} mode={runningLive.mode} onCancel={() => onCancelLiveTask?.(runningLive.id)} />
              </section>
            ) : selectedJob && selectedJob.kind === 'analyze' ? (
              <section className="ik-ai-task-detail">
                <KbAnalysisPanel
                  kbName={selectedJob.kbName ?? selectedJob.domain}
                  analysis={(
                    selectedJob.status === 'succeeded' && selectedJob.analysis
                      ? { status: 'ready', data: selectedJob.analysis }
                      : selectedJob.status === 'failed' || selectedJob.status === 'cancelled'
                        ? { status: 'error', message: selectedJob.error ?? (selectedJob.status === 'cancelled' ? '已取消分析' : '分析失败') }
                        : { status: 'loading' }
                  ) as KbApiState}
                  appliedIds={analysisAppliedIds ?? new Set()}
                  runningId={analysisRunningId ?? null}
                  applyingAll={Boolean(analysisApplyingAll)}
                  onRetry={() => { void onRetry(selectedJob.id); }}
                  onApply={(s) => onApplySuggestion?.(s)}
                  onApplyAll={(list) => onApplyAllSuggestions?.(list)}
                  onCancel={() => { void onCancel(selectedJob.id); }}
                />
              </section>
            ) : selectedJob && (
              <section className="ik-ai-task-detail">
                <div className={`ik-ai-task-status is-${selectedJob.status}`}>
                  <span>{statusIcon(selectedJob.status)}</span>
                  <div>
                    <b>{selectedJob.domain}</b>
                      <small>{selectedKindLabel} · {runningText(selectedJob)} · {parsedText(selectedJob)}</small>
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
                      <RefreshCw size={14} strokeWidth={2.2} />{retryText}
                    </button>
                  )}
                </div>

                {selectedJob.result && (
                  <div className="ik-ai-growth">
                    <div className="ik-ai-growth-head">
                      <span>实时写入</span>
                      <b>{selectedJob.result.folders.length} 目录 · {selectedJob.result.entries.length} 知识点</b>
                    </div>
                    <div className="ik-ai-growth-list">
                      {liveItems.map((item) => (
                        <div key={`${item.kind}-${item.id}`} className={`ik-ai-growth-node is-${item.kind}`}>
                          <span>{item.kind === 'folder' ? <FolderTree size={15} strokeWidth={2.15} /> : <FileText size={15} strokeWidth={2.15} />}</span>
                          <div>
                            <b>{item.title}</b>
                            <small>{item.subtitle}</small>
                          </div>
                        </div>
                      ))}
                      {!liveItems.length && <div className="ik-ai-growth-empty">等待 LangChain 写入第一个节点...</div>}
                    </div>
                  </div>
                )}

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
                        <span>{outputPlanLabel(selectedJob)}</span>
                        <pre>{output.plan}</pre>
                      </div>
                    )}
                    <div>
                      <span>{outputJsonLabel(selectedJob)}</span>
                      <pre>{output.json || '等待 Qwen 输出结构化 JSON...'}</pre>
                    </div>
                  </div>
                )}
              </section>
            )}
          </div>
          ) : (
            <div className="ik-ai-task-empty">
              <Sparkles size={20} strokeWidth={2.15} />
              <b>暂无后台任务</b>
              <span>开始 AI 建库或初始化目录后，进度和模型输出会显示在这里。</span>
            </div>
          )}
        </aside>
      )}
    </>
  );
}
