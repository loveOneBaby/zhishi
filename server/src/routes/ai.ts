import type { Router } from 'express';
import { listEntries } from '../db.js';
import { searchEntries } from '../search.js';
import { askAI } from '../ask.js';
import { aiJobs, jobSnapshot, listJobSnapshots } from '../services/ai-jobs.js';

export function registerAiRoutes(api: Router): void {
  api.get('/ai/jobs', (_req, res) => {
    res.json({ jobs: listJobSnapshots() });
  });

  api.get('/ai/jobs/:id', (req, res) => {
    const job = aiJobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: '任务不存在' });
    res.json({ job: jobSnapshot(job) });
  });

  // AI 问答（预留接口）
  api.post('/ask', async (req, res) => {
    const q = String(req.body?.query ?? '').trim();
    if (!q) return res.status(400).json({ error: 'query 不能为空' });
    const context = searchEntries(listEntries(), q);
    const result = await askAI(q, context);
    res.json(result);
  });
}
