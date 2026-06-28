import { AlertCircle, Ban, CheckCircle2, Clock3, ExternalLink, FileText, FolderTree, ListChecks, Loader2, RefreshCw, Sparkles, Trash2, Undo2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { AgentEditAction, AgentEditPlan, AiKnowledgeBaseJob, KbSuggestion } from '../api';
import KbAnalysisPanel, { type KbApiState } from './KbAnalysisPanel';
import LiveRewritePanel from './free/LiveRewritePanel';

// 前端流式 AI 操作(生成/改写/图解)的任务记录:运行时驱动实时预览,完成后作为记录保留
export interface LiveTask {
  id: string;
  entryId: string;
  title: string;
  label: string;
  mode: 'rewrite' | 'generate' | 'illustrate';
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

export interface AiContextCrumb {
  key: string;
  label: string;
  title?: string;
  current?: boolean;
  onClick?: () => void;
}

interface Props {
  jobs: AiKnowledgeBaseJob[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenResult: (job: AiKnowledgeBaseJob) => void;
  onCancel: (id: string) => Promise<void>;
  onRetry: (id: string) => Promise<void>;
  onApplyAgentEdit?: (id: string) => Promise<void>;
  onRevertAgentEdit?: (id: string) => Promise<void>;
  onClearHistory: () => Promise<void>;
  actions?: AiQuickAction[];
  contextLabel?: string;
  contextCrumbs?: AiContextCrumb[];
  onApplySuggestion?: (s: KbSuggestion) => void;
  onApplyAllSuggestions?: (list: KbSuggestion[]) => void;
  analysisAppliedIds?: Set<string>;
  analysisRunningId?: string | null;
  analysisApplyingAll?: boolean;
  liveTasks?: LiveTask[];
  onCancelLiveTask?: (id: string) => void;
  onClearLiveHistory?: () => void;
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
  if (job.kind === 'agent-edit') return 'AI 调整知识库';
  return '新建知识库';
}

function runningText(job: AiKnowledgeBaseJob): string {
  if (job.status === 'queued') return '排队中';
  if (job.status === 'running') {
    if (job.kind === 'folder-init') return '初始化中';
    if (job.kind === 'analyze') return '分析中';
    if (job.kind === 'agent-edit') return '调整中';
    return '生成中';
  }
  return statusLabel(job.status);
}

function parsedText(job: AiKnowledgeBaseJob): string {
  if (!job.parsed) return '等待结构化结果';
  if (job.kind === 'folder-init') return `${job.parsed.folders} 个目录`;
  if (job.kind === 'agent-edit') return `${job.parsed.folders} 个结构动作 / ${job.parsed.questions} 个内容动作`;
  return `${job.parsed.folders} 个目录 / ${job.parsed.questions} 条知识点`;
}

function agentPhaseText(job: AiKnowledgeBaseJob): string {
  if (job.kind !== 'agent-edit') return runningText(job);
  if (job.status === 'queued' || job.status === 'running') {
    return job.agentPhase === 'applying' ? '应用中' : '规划中';
  }
  if (job.agentPhase === 'draft') return '待确认';
  if (job.agentPhase === 'applied') return '已应用';
  if (job.agentPhase === 'reverted') return '已撤销';
  return statusLabel(job.status);
}

function outputPlanLabel(job: AiKnowledgeBaseJob): string {
  if (job.kind === 'folder-init') return '目录规划';
  if (job.kind === 'folder-entries') return '生成过程';
  if (job.kind === 'agent-edit') return '调整计划';
  return '建库思路';
}

function outputJsonLabel(job: AiKnowledgeBaseJob): string {
  if (job.kind === 'folder-init') return '目录 JSON';
  if (job.kind === 'folder-entries') return '知识点输出';
  if (job.kind === 'agent-edit') return '计划 JSON';
  return '知识库 JSON';
}

function rowCount(job: AiKnowledgeBaseJob): number {
  if (!job.parsed) return 0;
  if (job.kind === 'folder-init') return job.parsed.folders;
  if (job.kind === 'agent-edit') return job.parsed.folders + job.parsed.questions;
  return job.parsed.questions;
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

function isAgentEditPlan(value: unknown): value is AgentEditPlan {
  const plan = value as AgentEditPlan | undefined;
  return Boolean(plan && typeof plan === 'object' && typeof plan.summary === 'string' && Array.isArray(plan.actions));
}

function agentPlanFromJob(job: AiKnowledgeBaseJob | null): AgentEditPlan | null {
  if (!job || job.kind !== 'agent-edit') return null;
  if (isAgentEditPlan(job.plan)) return job.plan;
  const output = splitModelOutput(job.modelOutput);
  if (!output.json) return null;
  try {
    const parsed = JSON.parse(output.json) as unknown;
    return isAgentEditPlan(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function actionKindLabel(action: AgentEditAction): string {
  switch (action.kind) {
    case 'create-folder': return '新目录';
    case 'rename-folder': return '改目录名';
    case 'create-entry': return '新知识点';
    case 'rewrite-entry': return '改写';
    case 'move-entry': return '移动';
    case 'note': return '备注';
  }
}

function actionTarget(action: AgentEditAction): string {
  return action.topic || action.name || action.entryId || action.folderId || action.folderRef || action.ref || action.kind;
}

function formatTime(ts: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(ms: number): string {
  if (!ms || ms < 0) return '<1秒';
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}秒`;
  const minutes = Math.floor(seconds / 60);
  const remain = Math.round(seconds % 60);
  return `${minutes}分${remain}秒`;
}

function formatTokens(n: number): string {
  if (!n || n < 0) return '0';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

// 任务执行耗时与 token 消耗统计条；运行中以 now - startedAt 实时计时，结束后用 durationMs
function JobStatsBar({ job, now }: { job: AiKnowledgeBaseJob; now: number }): ReactNode {
  const running = job.status === 'running';
  const duration = running ? Math.max(0, now - (job.startedAt || job.createdAt)) : job.durationMs;
  const hasTokens = job.totalTokens > 0 || job.promptTokens > 0 || job.completionTokens > 0;
  if (!duration && !hasTokens) return null;
  return (
    <div className="ik-ai-task-stats">
      <span className="ik-ai-task-stat">
        <Clock3 size={13} strokeWidth={2.1} />
        <b>耗时</b>
        <small>{formatDuration(duration)}</small>
      </span>
      {hasTokens && (
        <span className="ik-ai-task-stat is-token">
          <b>Token</b>
          <small>
            <em>{formatTokens(job.totalTokens)}</em>
            <i>输入 {formatTokens(job.promptTokens)} · 输出 {formatTokens(job.completionTokens)}</i>
          </small>
        </span>
      )}
    </div>
  );
}

function AgentEditPreview({
  job,
  plan,
  onApply,
  onRevert,
  onRetry,
}: {
  job: AiKnowledgeBaseJob;
  plan: AgentEditPlan;
  onApply?: (id: string) => Promise<void>;
  onRevert?: (id: string) => Promise<void>;
  onRetry: (id: string) => Promise<void>;
}): ReactNode {
  const phase = job.agentPhase;
  const canApply = job.status === 'succeeded' && (phase === 'draft' || phase === 'reverted') && Boolean(onApply);
  const canRevert = job.status === 'succeeded' && phase === 'applied' && Boolean(job.rollback) && Boolean(onRevert);
  const isBusy = job.status === 'queued' || job.status === 'running';
  return (
    <div className={`ik-agent-plan is-${phase ?? job.status}`}>
      <div className="ik-agent-plan-head">
        <span>
          <ListChecks size={15} strokeWidth={2.2} />
          {phase === 'draft' ? '待确认变更' : phase === 'applied' ? '已应用变更' : phase === 'reverted' ? '已撤销变更' : '调整计划'}
        </span>
        <b>{plan.actions.length} 个动作</b>
      </div>
      <p>{plan.summary}</p>
      <div className="ik-agent-action-list">
        {plan.actions.map((action, index) => (
          <div key={action.id || `${action.kind}-${index}`} className={`ik-agent-action is-${action.kind}`}>
            <span>{index + 1}</span>
            <div>
              <b>{action.title || actionKindLabel(action)}</b>
              <small>
                <em>{actionKindLabel(action)}</em>
                <i>{actionTarget(action)}</i>
              </small>
              {action.detail && <p>{action.detail}</p>}
            </div>
          </div>
        ))}
      </div>
      <div className="ik-agent-plan-actions">
        {canApply && (
          <button type="button" className="ik-agent-plan-primary" onClick={() => { void onApply?.(job.id); }}>
            <CheckCircle2 size={15} strokeWidth={2.25} />应用调整
          </button>
        )}
        {phase === 'draft' && (
          <button type="button" className="ik-ai-task-secondary" onClick={() => { void onRetry(job.id); }}>
            <RefreshCw size={14} strokeWidth={2.2} />重做计划
          </button>
        )}
        {canRevert && (
          <button type="button" className="ik-ai-task-secondary is-danger" onClick={() => { void onRevert?.(job.id); }}>
            <Undo2 size={14} strokeWidth={2.2} />撤销本次调整
          </button>
        )}
        {isBusy && (
          <span className="ik-agent-plan-busy">
            <Loader2 size={14} strokeWidth={2.2} className="ik-ai-task-spin" />{phase === 'applying' ? '正在应用调整' : '正在生成计划'}
          </span>
        )}
      </div>
    </div>
  );
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
  onApplyAgentEdit,
  onRevertAgentEdit,
  onClearHistory,
  actions = [],
  contextLabel,
  contextCrumbs,
  onApplySuggestion,
  onApplyAllSuggestions,
  analysisAppliedIds,
  analysisRunningId,
  analysisApplyingAll,
  liveTasks = [],
  onCancelLiveTask,
  onClearLiveHistory,
}: Props): ReactNode {
  const sortedLive = useMemo(() => [...liveTasks].sort((a, b) => b.createdAt - a.createdAt), [liveTasks]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [promptId, setPromptId] = useState<string | null>(null);
  const [promptValue, setPromptValue] = useState('');
  const closePrompt = () => { setPromptId(null); setPromptValue(''); };
  const sortedJobs = useMemo(() => [...jobs].sort((a, b) => b.createdAt - a.createdAt), [jobs]);
  const liveId = (id: string): string => `live:${id}`;
  const taskKeys = useMemo(() => [
    ...sortedLive.map((task) => ({ id: liveId(task.id), createdAt: task.createdAt })),
    ...sortedJobs.map((job) => ({ id: job.id, createdAt: job.createdAt })),
  ].sort((a, b) => b.createdAt - a.createdAt), [sortedJobs, sortedLive]);
  const taskRows = useMemo(() => [
    ...sortedLive.map((task) => ({ kind: 'live' as const, id: liveId(task.id), createdAt: task.createdAt, task })),
    ...sortedJobs.map((job) => ({ kind: 'job' as const, id: job.id, createdAt: job.createdAt, job })),
  ].sort((a, b) => b.createdAt - a.createdAt), [sortedJobs, sortedLive]);
  const runningJobCount = sortedJobs.filter((job) => job.status === 'queued' || job.status === 'running').length;
  const runningLiveCount = sortedLive.filter((task) => task.status === 'running').length;
  const runningCount = runningJobCount + runningLiveCount;
  const historyCount = (sortedJobs.length - runningJobCount) + sortedLive.filter((task) => task.status !== 'running').length;
  const failedCount = sortedJobs.filter((job) => job.status === 'failed').length + sortedLive.filter((task) => task.status === 'failed').length;
  const recordCount = sortedJobs.length + sortedLive.length;
  const selectedLive = sortedLive.find((task) => selectedId === liveId(task.id)) ?? null;
  const selectedJob = selectedLive ? null : (sortedJobs.find((job) => job.id === selectedId) ?? sortedJobs[0] ?? null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (selectedJob?.status !== 'running') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [selectedJob?.status, selectedJob?.id]);
  const output = splitModelOutput(selectedJob?.modelOutput ?? '');
  const selectedKindLabel = selectedJob ? jobKindLabel(selectedJob) : 'AI 任务';
  const selectedAgentPlan = agentPlanFromJob(selectedJob);
  const liveItems = selectedJob ? growthItems(selectedJob) : [];
  const retryText = selectedJob?.resumable ? '继续生成' : '重新生成';
  const showGrowth = Boolean(selectedJob?.result && (selectedJob.kind !== 'agent-edit' || selectedJob.agentPhase === 'applying' || selectedJob.agentPhase === 'applied'));
  const hasContextCrumbs = Boolean(contextCrumbs?.length);

  useEffect(() => {
    if (!taskKeys.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !taskKeys.some((item) => item.id === selectedId)) {
      setSelectedId(taskKeys[0].id);
    }
  }, [selectedId, taskKeys]);

  // 新建任务时自动定位过去:监测最新任务 id,出现更新的任务就选中它
  const lastTopIdRef = useRef<string | null>(null);
  useEffect(() => {
    const top = taskKeys[0];
    if (!top) { lastTopIdRef.current = null; return; }
    if (lastTopIdRef.current !== null && top.id !== lastTopIdRef.current) {
      setSelectedId(top.id);
    }
    lastTopIdRef.current = top.id;
  }, [taskKeys]);

  if (!recordCount && !actions.length) return null;

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
          <small>{failedCount ? `${failedCount} 个失败` : recordCount ? `${recordCount} 个记录` : `${actions.length} 个快捷动作`}</small>
        </span>
      </button>

      {open && (
        <aside className="ik-ai-task-panel" aria-label="AI 控制台">
          <header className="ik-ai-task-panel-head">
            <div>
              <span>AI Control</span>
              <strong>AI 控制台</strong>
              {hasContextCrumbs ? (
                <nav className="ik-ai-task-context ik-ai-task-breadcrumb" aria-label="AI 执行位置">
                  {contextCrumbs!.map((crumb, index) => {
                    const clickable = Boolean(crumb.onClick) && !crumb.current;
                    return (
                      <span className="ik-ai-task-crumb-wrap" key={crumb.key}>
                        {index > 0 && <span className="ik-ai-task-crumb-sep">/</span>}
                        {clickable ? (
                          <button
                            type="button"
                            className="ik-ai-task-crumb"
                            title={crumb.title ?? `切换到 ${crumb.label}`}
                            onClick={crumb.onClick}
                          >
                            {crumb.label}
                          </button>
                        ) : (
                          <span className={`ik-ai-task-crumb is-current ${crumb.current ? 'is-active' : ''}`} title={crumb.title ?? crumb.label}>
                            {crumb.label}
                          </span>
                        )}
                      </span>
                    );
                  })}
                </nav>
              ) : contextLabel && <small className="ik-ai-task-context">{contextLabel}</small>}
            </div>
            <div className="ik-ai-task-head-actions">
              {historyCount > 0 && (
                <button type="button" className="ik-ai-task-clear" onClick={() => {
                  void (async () => {
                    await onClearHistory();
                    onClearLiveHistory?.();
                  })();
                }}>
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
              {taskRows.map((row) => {
                if (row.kind === 'live') {
                  const task = row.task;
                  return (
                    <div
                      key={row.id}
                      className={`ik-ai-task-row is-${task.status === 'running' ? 'live-active' : task.status} ${selectedLive?.id === task.id ? 'is-active' : ''}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedId(row.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedId(row.id);
                        }
                      }}
                    >
                      <span className="ik-ai-task-row-icon">{statusIcon(task.status)}</span>
                      <span className="ik-ai-task-row-main">
                        <b>{task.title}</b>
                        <small>{task.label} · {task.stage || liveStatusLabel(task.status)}</small>
                      </span>
                      {task.status === 'running' && onCancelLiveTask && (
                        <button
                          type="button"
                          className="ik-ai-task-row-cancel"
                          onClick={(event) => {
                            event.stopPropagation();
                            onCancelLiveTask(task.id);
                          }}
                          aria-label="取消"
                        >
                          <X size={14} strokeWidth={2.3} />
                        </button>
                      )}
                    </div>
                  );
                }
                const job = row.job;
                return (
                  <button
                    key={row.id}
                    type="button"
                    className={`ik-ai-task-row ${selectedJob?.id === job.id ? 'is-active' : ''} is-${job.status}`}
                    onClick={() => setSelectedId(job.id)}
                  >
                    <span className="ik-ai-task-row-icon">{statusIcon(job.status)}</span>
                    <span className="ik-ai-task-row-main">
                      <b>{job.domain}</b>
                      <small>{jobKindLabel(job)} · {agentPhaseText(job)} · {formatTime(job.updatedAt)}{job.status !== 'queued' && job.status !== 'running' && (job.durationMs > 0 || job.totalTokens > 0) ? ` · ${formatDuration(job.durationMs)} · ${formatTokens(job.totalTokens)}` : ''}</small>
                    </span>
                    {job.parsed && (
                      <span className="ik-ai-task-row-count">{rowCount(job)}</span>
                    )}
                  </button>
                );
              })}
            </div>

            {selectedLive && selectedLive.status === 'running' ? (
              <section className="ik-ai-task-detail ik-ai-task-detail-live">
                <LiveRewritePanel title={selectedLive.title} raw={selectedLive.raw} stage={selectedLive.stage} mode={selectedLive.mode} onCancel={() => onCancelLiveTask?.(selectedLive.id)} />
              </section>
            ) : selectedLive ? (
              <section className="ik-ai-task-detail">
                <div className={`ik-ai-task-status is-${selectedLive.status}`}>
                  <span>{statusIcon(selectedLive.status)}</span>
                  <div>
                    <b>{selectedLive.title}</b>
                    <small>{selectedLive.label} · {liveStatusLabel(selectedLive.status)} · {selectedLive.stage}</small>
                  </div>
                </div>
                {selectedLive.raw.trim() && (
                  <div className="ik-ai-task-output">
                    <div>
                      <span>{selectedLive.mode === 'illustrate' ? '图片资源' : '模型输出'}</span>
                      <pre>{selectedLive.raw}</pre>
                    </div>
                  </div>
                )}
              </section>
            ) : selectedJob && selectedJob.kind === 'analyze' ? (
              <section className="ik-ai-task-detail">
                <JobStatsBar job={selectedJob} now={now} />
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
                      <small>{selectedKindLabel} · {agentPhaseText(selectedJob)} · {parsedText(selectedJob)}</small>
                  </div>
                </div>

                <JobStatsBar job={selectedJob} now={now} />

                {selectedJob.kind === 'agent-edit' && selectedAgentPlan && (
                  <AgentEditPreview
                    job={selectedJob}
                    plan={selectedAgentPlan}
                    onApply={onApplyAgentEdit}
                    onRevert={onRevertAgentEdit}
                    onRetry={onRetry}
                  />
                )}

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

                {showGrowth && selectedJob.result && (
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
