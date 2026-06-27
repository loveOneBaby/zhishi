import type { Router } from 'express';
import { asyncHandler } from '../app.js';
import {
  createDataAsset,
  registerExternalAsset,
  getAsset,
  getAssetBytes,
} from '../db.js';
import { isSafeExternalUrl } from '../assets.js';

export function registerAssetRoutes(api: Router): void {
  // ───────────── 资源(图片) ─────────────
  // 上传:body = { dataUrl } 落库去重 / { url } 登记外链；alt 可选
  api.post('/assets', asyncHandler(async (req, res) => {
    const alt = String(req.body?.alt ?? '');
    const dataUrl = req.body?.dataUrl;
    const url = req.body?.url;
    if (typeof dataUrl === 'string' && dataUrl) {
      const asset = await createDataAsset(dataUrl, alt);
      if (!asset) return res.status(400).json({ error: '无法解析 dataUrl 或非允许的图片类型' });
      return res.status(201).json({ asset });
    }
    if (typeof url === 'string' && url) {
      // 仅允许 http/https 或站内相对路径,阻断 javascript: / 协议相对 URL 的开放重定向
      if (!isSafeExternalUrl(url)) return res.status(400).json({ error: '仅支持 http/https 图片地址' });
      return res.status(201).json({ asset: await registerExternalAsset(url, alt) });
    }
    res.status(400).json({ error: '需要 dataUrl 或 url' });
  }));

  api.get('/assets/:id', asyncHandler(async (req, res) => {
    const a = await getAsset(req.params.id);
    if (!a) return res.status(404).json({ error: 'not found' });
    res.json({ asset: a });
  }));

  // 原始二进制(站内存储的 data 资源)
  api.get('/assets/:id/raw', asyncHandler(async (req, res) => {
    const a = await getAsset(req.params.id);
    if (!a) return res.status(404).end();
    if (a.kind === 'external') {
      return res.status(404).end();
    }
    const raw = await getAssetBytes(req.params.id);
    if (!raw) return res.status(404).end();
    // 新数据仅图片;旧库可能存有非图片,强制下载以防被当 HTML 渲染
    if (!raw.mime.startsWith('image/')) {
      res.setHeader('Content-Disposition', 'attachment');
    }
    res.setHeader('Content-Type', raw.mime || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(raw.bytes);
  }));
}
