import { db } from './client.js';

export type StoredAiJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface StoredAiJob {
  id: string;
  kind: 'kb-generate' | 'folder-init';
  domain: string;
  questionCount: number;
  kbId?: string;
  kbName?: string;
  parentId?: string | null;
  targetPath?: string;
  status: StoredAiJobStatus;
  logs: string[];
  modelOutput: string;
  parsed?: { kbName: string; folders: number; questions: number };
  plan?: unknown;
  result?: unknown;
  error?: string;
  abortRequested?: boolean;
  createdAt: number;
  updatedAt: number;
}

db.exec(`
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
    updatedAt       INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ai_jobs_updated ON ai_jobs(updatedAt DESC);
`);

const aiJobColumns = db.prepare('PRAGMA table_info(ai_jobs)').all() as { name: string }[];
if (!aiJobColumns.some((c) => c.name === 'plan')) {
  db.exec('ALTER TABLE ai_jobs ADD COLUMN plan TEXT');
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
  return {
    id: String(row.id),
    kind: String(row.kind) === 'folder-init' ? 'folder-init' : 'kb-generate',
    domain: String(row.domain ?? ''),
    questionCount: Number(row.questionCount ?? 0),
    kbId: typeof row.kbId === 'string' && row.kbId ? row.kbId : undefined,
    kbName: typeof row.kbName === 'string' && row.kbName ? row.kbName : undefined,
    parentId: row.parentId == null ? null : String(row.parentId),
    targetPath: typeof row.targetPath === 'string' && row.targetPath ? row.targetPath : undefined,
    status: String(row.status ?? 'failed') as StoredAiJobStatus,
    logs: parseJson<string[]>(String(row.logs ?? '[]'), []),
    modelOutput: String(row.modelOutput ?? ''),
    parsed: parseJson<StoredAiJob['parsed'] | undefined>(row.parsed as string | null, undefined),
    plan: parseJson<unknown | undefined>(row.plan as string | null, undefined),
    result: parseJson<unknown | undefined>(row.result as string | null, undefined),
    error: typeof row.error === 'string' && row.error ? row.error : undefined,
    abortRequested: Number(row.abortRequested ?? 0) === 1,
    createdAt: Number(row.createdAt ?? 0),
    updatedAt: Number(row.updatedAt ?? 0),
  };
}

export function saveAiJob(job: StoredAiJob): void {
  db.prepare(`
    INSERT INTO ai_jobs (
      id, kind, domain, questionCount, kbId, kbName, parentId, targetPath, status,
      logs, modelOutput, parsed, plan, result, error, abortRequested, createdAt, updatedAt
    ) VALUES (
      :id, :kind, :domain, :questionCount, :kbId, :kbName, :parentId, :targetPath, :status,
      :logs, :modelOutput, :parsed, :plan, :result, :error, :abortRequested, :createdAt, :updatedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      kind=excluded.kind,
      domain=excluded.domain,
      questionCount=excluded.questionCount,
      kbId=excluded.kbId,
      kbName=excluded.kbName,
      parentId=excluded.parentId,
      targetPath=excluded.targetPath,
      status=excluded.status,
      logs=excluded.logs,
      modelOutput=excluded.modelOutput,
      parsed=excluded.parsed,
      plan=excluded.plan,
      result=excluded.result,
      error=excluded.error,
      abortRequested=excluded.abortRequested,
      updatedAt=excluded.updatedAt
  `).run({
    ...job,
    logs: JSON.stringify(job.logs ?? []),
    parsed: job.parsed ? JSON.stringify(job.parsed) : null,
    plan: job.plan ? JSON.stringify(job.plan) : null,
    result: job.result ? JSON.stringify(job.result) : null,
    error: job.error ?? null,
    kbId: job.kbId ?? null,
    kbName: job.kbName ?? null,
    parentId: job.parentId ?? null,
    targetPath: job.targetPath ?? null,
    abortRequested: job.abortRequested ? 1 : 0,
  });
}

export function listStoredAiJobs(limit = 30): StoredAiJob[] {
  const rows = db.prepare('SELECT * FROM ai_jobs ORDER BY createdAt DESC LIMIT ?').all(limit) as Record<string, unknown>[];
  return rows.map(rowToJob);
}

export function getStoredAiJob(id: string): StoredAiJob | null {
  const row = db.prepare('SELECT * FROM ai_jobs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToJob(row) : null;
}

export function markInterruptedAiJobs(): StoredAiJob[] {
  const rows = db.prepare("SELECT * FROM ai_jobs WHERE status IN ('queued','running')").all() as Record<string, unknown>[];
  const jobs = rows.map(rowToJob);
  const now = Date.now();
  const stmt = db.prepare(`
    UPDATE ai_jobs
    SET status='queued', error=NULL, abortRequested=0, logs=:logs, updatedAt=:updatedAt
    WHERE id=:id
  `);
  for (const job of jobs) {
    const logs = [...job.logs, '服务重启，任务将从已有进度继续'];
    stmt.run({
      id: job.id,
      logs: JSON.stringify(logs.slice(-60)),
      updatedAt: now,
    });
  }
  return jobs;
}

export function pruneStoredAiJobs(limit = 30): void {
  const rows = db.prepare(`
    SELECT id FROM ai_jobs
    WHERE status NOT IN ('queued','running')
    ORDER BY createdAt DESC
    LIMIT -1 OFFSET ?
  `).all(limit) as { id: string }[];
  if (!rows.length) return;
  const stmt = db.prepare('DELETE FROM ai_jobs WHERE id = ?');
  for (const row of rows) stmt.run(row.id);
}
