import type { Router } from 'express';
import {
  createDataAsset,
  registerExternalAsset,
  getAsset,
  getAssetBytes,
} from '../db.js';

export function registerAssetRoutes(api: Router): void {
  // ───────────── 资源(图片) ─────────────
  // 上传:body = { dataUrl } 落库去重 / { url } 登记外链；alt 可选
  api.post('/assets', (req, res) => {
    const alt = String(req.body?.alt ?? '');
    const dataUrl = req.body?.dataUrl;
    const url = req.body?.url;
    if (typeof dataUrl === 'string' && dataUrl) {
      const asset = createDataAsset(dataUrl, alt);
      if (!asset) return res.status(400).json({ error: '无法解析 dataUrl' });
      return res.status(201).json({ asset });
    }
    if (typeof url === 'string' && url) {
      return res.status(201).json({ asset: registerExternalAsset(url, alt) });
    }
    res.status(400).json({ error: '需要 dataUrl 或 url' });
  });

  api.get('/assets/:id', (req, res) => {
    const a = getAsset(req.params.id);
    if (!a) return res.status(404).json({ error: 'not found' });
    res.json({ asset: a });
  });

  // 原始二进制(站内存储的 data 资源)
  api.get('/assets/:id/raw', (req, res) => {
    const a = getAsset(req.params.id);
    if (!a) return res.status(404).end();
    if (a.kind === 'external') return res.redirect(a.url);
    const raw = getAssetBytes(req.params.id);
    if (!raw) return res.status(404).end();
    res.setHeader('Content-Type', raw.mime || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(raw.bytes);
  });
}
