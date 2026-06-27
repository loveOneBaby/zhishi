import type { Router } from 'express';
import { asyncHandler } from '../app.js';
import { listEntries } from '../db.js';
import { searchEntries } from '../search.js';
import { askAI } from '../ask.js';
import { aiJobs, cancelAiJob, clearAiJobHistory, jobSnapshot, listJobSnapshots, retryAiJob } from '../services/ai-jobs.js';

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

  // AI 问答（预留接口）
  api.post('/ask', asyncHandler(async (req, res) => {
    const q = String(req.body?.query ?? '').trim();
    if (!q) return res.status(400).json({ error: 'query 不能为空' });
    const context = searchEntries(await listEntries(), q);
    const result = await askAI(q, context);
    res.json(result);
  }));
}
