import { db, tryAlter } from './client.js';

export type StoredAiJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type StoredAiJobKind = 'kb-generate' | 'folder-init' | 'folder-entries' | 'analyze';

export interface StoredAiJob {
  id: string;
  kind: StoredAiJobKind;
  domain: string;
  questionCount: number;
  kbId?: string;
  kbName?: string;
  entryId?: string;
  parentId?: string | null;
  targetPath?: string;
  status: StoredAiJobStatus;
  logs: string[];
  modelOutput: string;
  parsed?: { kbName: string; folders: number; questions: number };
  plan?: unknown;
  result?: unknown;
  analysis?: unknown;
  error?: string;
  abortRequested?: boolean;
  createdAt: number;
  updatedAt: number;
  startedAt: number;
  durationMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export async function ensureAiJobsTable(): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS ai_jobs (
      id              TEXT PRIMARY KEY,
      kind            TEXT NOT NULL,
      domain          TEXT NOT NULL,
      questionCount   INTEGER NOT NULL DEFAULT 0,
      kbId            TEXT,
      kbName          TEXT,
      parentId        TEXT,
      targetPath      TEXT,
      status          TEXT NOT NULL,
      logs            TEXT NOT NULL DEFAULT '[]',
      modelOutput     TEXT NOT NULL DEFAULT '',
      parsed          TEXT,
      plan            TEXT,
      result          TEXT,
      error           TEXT,
      abortRequested  INTEGER NOT NULL DEFAULT 0,
      createdAt       INTEGER NOT NULL,
      updatedAt       INTEGER NOT NULL,
      startedAt       INTEGER NOT NULL DEFAULT 0,
      durationMs      INTEGER NOT NULL DEFAULT 0,
      promptTokens    INTEGER NOT NULL DEFAULT 0,
      completionTokens INTEGER NOT NULL DEFAULT 0,
      totalTokens     INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_ai_jobs_updated ON ai_jobs(updatedAt DESC);
  `);
  // 列迁移：列已存在则忽略（去掉对 PRAGMA table_info 的依赖）
  await tryAlter('ALTER TABLE ai_jobs ADD COLUMN plan TEXT');
  await tryAlter('ALTER TABLE ai_jobs ADD COLUMN analysis TEXT');
  await tryAlter('ALTER TABLE ai_jobs ADD COLUMN entryId TEXT');
  await tryAlter('ALTER TABLE ai_jobs ADD COLUMN startedAt INTEGER NOT NULL DEFAULT 0');
  await tryAlter('ALTER TABLE ai_jobs ADD COLUMN durationMs INTEGER NOT NULL DEFAULT 0');
  await tryAlter('ALTER TABLE ai_jobs ADD COLUMN promptTokens INTEGER NOT NULL DEFAULT 0');
  await tryAlter('ALTER TABLE ai_jobs ADD COLUMN completionTokens INTEGER NOT NULL DEFAULT 0');
  await tryAlter('ALTER TABLE ai_jobs ADD COLUMN totalTokens INTEGER NOT NULL DEFAULT 0');
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function rowToJob(row: Record<string, unknown>): StoredAiJob {
  const rawKind = String(row.kind);
  const kind: StoredAiJobKind = rawKind === 'folder-init' || rawKind === 'folder-entries' || rawKind === 'analyze' ? rawKind : 'kb-generate';
  return {
    id: String(row.id),
    kind,
    domain: String(row.domain ?? ''),
    questionCount: Number(row.questionCount ?? 0),
    kbId: typeof row.kbId === 'string' && row.kbId ? row.kbId : undefined,
    kbName: typeof row.kbName === 'string' && row.kbName ? row.kbName : undefined,
    entryId: typeof row.entryId === 'string' && row.entryId ? row.entryId : undefined,
    parentId: row.parentId == null ? null : String(row.parentId),
    targetPath: typeof row.targetPath === 'string' && row.targetPath ? row.targetPath : undefined,
    status: String(row.status ?? 'failed') as StoredAiJobStatus,
    logs: parseJson<string[]>(String(row.logs ?? '[]'), []),
    modelOutput: String(row.modelOutput ?? ''),
    parsed: parseJson<StoredAiJob['parsed'] | undefined>(row.parsed as string | null, undefined),
    plan: parseJson<unknown | undefined>(row.plan as string | null, undefined),
    result: parseJson<unknown | undefined>(row.result as string | null, undefined),
    analysis: parseJson<unknown | undefined>(row.analysis as string | null, undefined),
    error: typeof row.error === 'string' && row.error ? row.error : undefined,
    abortRequested: Number(row.abortRequested ?? 0) === 1,
    createdAt: Number(row.createdAt ?? 0),
    updatedAt: Number(row.updatedAt ?? 0),
    startedAt: Number(row.startedAt ?? 0),
    durationMs: Number(row.durationMs ?? 0),
    promptTokens: Number(row.promptTokens ?? 0),
    completionTokens: Number(row.completionTokens ?? 0),
    totalTokens: Number(row.totalTokens ?? 0),
  };
}

export async function saveAiJob(job: StoredAiJob): Promise<void> {
  await db.prepare(`
    INSERT INTO ai_jobs (
      id, kind, domain, questionCount, kbId, kbName, entryId, parentId, targetPath, status,
      logs, modelOutput, parsed, plan, result, analysis, error, abortRequested, createdAt, updatedAt,
      startedAt, durationMs, promptTokens, completionTokens, totalTokens
    ) VALUES (
      :id, :kind, :domain, :questionCount, :kbId, :kbName, :entryId, :parentId, :targetPath, :status,
      :logs, :modelOutput, :parsed, :plan, :result, :analysis, :error, :abortRequested, :createdAt, :updatedAt,
      :startedAt, :durationMs, :promptTokens, :completionTokens, :totalTokens
    )
    ON CONFLICT(id) DO UPDATE SET
      kind=excluded.kind,
      domain=excluded.domain,
      questionCount=excluded.questionCount,
      kbId=excluded.kbId,
      kbName=excluded.kbName,
      entryId=excluded.entryId,
      parentId=excluded.parentId,
      targetPath=excluded.targetPath,
      status=excluded.status,
      logs=excluded.logs,
      modelOutput=excluded.modelOutput,
      parsed=excluded.parsed,
      plan=excluded.plan,
      result=excluded.result,
      analysis=excluded.analysis,
      error=excluded.error,
      abortRequested=excluded.abortRequested,
      updatedAt=excluded.updatedAt,
      startedAt=excluded.startedAt,
      durationMs=excluded.durationMs,
      promptTokens=excluded.promptTokens,
      completionTokens=excluded.completionTokens,
      totalTokens=excluded.totalTokens
  `).run({
    ...job,
    logs: JSON.stringify(job.logs ?? []),
    parsed: job.parsed ? JSON.stringify(job.parsed) : null,
    plan: job.plan ? JSON.stringify(job.plan) : null,
    result: job.result ? JSON.stringify(job.result) : null,
    analysis: job.analysis ? JSON.stringify(job.analysis) : null,
    error: job.error ?? null,
    kbId: job.kbId ?? null,
    kbName: job.kbName ?? null,
    entryId: job.entryId ?? null,
    parentId: job.parentId ?? null,
    targetPath: job.targetPath ?? null,
    abortRequested: job.abortRequested ? 1 : 0,
  });
}

export async function listStoredAiJobs(limit = 30): Promise<StoredAiJob[]> {
  const rows = await db.prepare('SELECT * FROM ai_jobs ORDER BY createdAt DESC LIMIT ?').all(limit) as Record<string, unknown>[];
  return rows.map(rowToJob);
}

export async function getStoredAiJob(id: string): Promise<StoredAiJob | null> {
  const row = await db.prepare('SELECT * FROM ai_jobs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToJob(row) : null;
}

export async function markInterruptedAiJobs(): Promise<StoredAiJob[]> {
  const rows = await db.prepare("SELECT * FROM ai_jobs WHERE status IN ('queued','running')").all() as Record<string, unknown>[];
  const jobs = rows.map(rowToJob);
  const now = Date.now();
  const stmt = db.prepare(`
    UPDATE ai_jobs
    SET status='queued', error=NULL, abortRequested=0, logs=:logs, updatedAt=:updatedAt
    WHERE id=:id
  `);
  for (const job of jobs) {
    const logs = [...job.logs, '服务重启，任务将从已有进度继续'];
    await stmt.run({
      id: job.id,
      logs: JSON.stringify(logs.slice(-60)),
      updatedAt: now,
    });
  }
  return jobs;
}

export async function pruneStoredAiJobs(limit = 30): Promise<void> {
  const rows = await db.prepare(`
    SELECT id FROM ai_jobs
    WHERE status NOT IN ('queued','running')
    ORDER BY createdAt DESC
    LIMIT -1 OFFSET ?
  `).all(limit) as { id: string }[];
  if (!rows.length) return;
  const stmt = db.prepare('DELETE FROM ai_jobs WHERE id = ?');
  for (const row of rows) await stmt.run(row.id);
}

export async function clearStoredAiJobHistory(): Promise<number> {
  const info = await db.prepare("DELETE FROM ai_jobs WHERE status NOT IN ('queued','running')").run();
  return Number(info.changes ?? 0);
}
