import type { Router } from 'express';
import { asyncHandler } from '../app.js';
import { listEntries } from '../db.js';
import { searchEntries } from '../search.js';
import { askAI } from '../ask.js';
import { rateLimit } from '../rateLimit.js';
import { aiJobs, applyAgentEditJob, cancelAiJob, clearAiJobHistory, jobSnapshot, listJobSnapshots, retryAiJob, revertAgentEditJob } from '../services/ai-jobs.js';

// /ask 默认需要登录；显式 AI_PUBLIC_ASK=true 时公开，仍按 IP 收紧限流防刷额度消耗。
const askLimiter = rateLimit({ windowMs: 60_000, max: 20, message: 'AI 问答过于频繁,请稍后再试' });
const MAX_ASK_QUERY_CHARS = 1000;

export function registerAiRoutes(api: Router): void {
  api.get('/ai/jobs', asyncHandler(async (_req, res) => {
    res.json({ jobs: await listJobSnapshots() });
  }));

  api.get('/ai/jobs/:id', asyncHandler(async (req, res) => {
    const job = aiJobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: '任务不存在' });
    res.json({ job: await jobSnapshot(job) });
  }));

  api.delete('/ai/jobs/history', asyncHandler(async (_req, res) => {
    res.json({ jobs: await clearAiJobHistory() });
  }));

  api.post('/ai/jobs/:id/cancel', asyncHandler(async (req, res) => {
    const job = await cancelAiJob(req.params.id);
    if (!job) return res.status(404).json({ error: '任务不存在' });
    res.json({ job });
  }));

  api.post('/ai/jobs/:id/retry', asyncHandler(async (req, res) => {
    const job = await retryAiJob(req.params.id);
    if (!job) return res.status(404).json({ error: '任务不存在或缺少重试参数' });
    res.status(202).json({ job: await jobSnapshot(job) });
  }));

  api.post('/ai/jobs/:id/apply', asyncHandler(async (req, res) => {
    const job = await applyAgentEditJob(req.params.id);
    if (!job) return res.status(404).json({ error: '任务不存在或缺少可应用的调整计划' });
    res.status(202).json({ job });
  }));

  api.post('/ai/jobs/:id/revert', asyncHandler(async (req, res) => {
    const job = await revertAgentEditJob(req.params.id);
    if (!job) return res.status(404).json({ error: '任务不存在或缺少可撤销的调整记录' });
    res.json({ job });
  }));

  // AI 问答（预留接口）
  api.post('/ask', askLimiter, asyncHandler(async (req, res) => {
    const q = String(req.body?.query ?? '').trim();
    if (!q) return res.status(400).json({ error: 'query 不能为空' });
    if (q.length > MAX_ASK_QUERY_CHARS) return res.status(400).json({ error: `query 不超过 ${MAX_ASK_QUERY_CHARS} 个字符` });
    const context = searchEntries(await listEntries(), q);
    const result = await askAI(q, context);
    res.json(result);
  }));
}
