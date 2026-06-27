import type { Request, Response, NextFunction } from 'express';

interface Bucket {
  count: number;
  reset: number;
}

// 轻量内存限流(固定窗口,按 IP)。多实例部署下各自计数,够用于单机 / 小规模。
// Map 无上界:典型用法是少量 IP,长期运行可按需加定期清理。
export function rateLimit(opts: { windowMs: number; max: number; message?: string }) {
  const buckets = new Map<string, Bucket>();
  const message = opts.message ?? '请求过于频繁,请稍后再试';
  let lastSweep = 0;
  return function limiter(req: Request, res: Response, next: NextFunction): void {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    if (now - lastSweep > opts.windowMs) {
      lastSweep = now;
      for (const [key, bucket] of buckets) {
        if (now > bucket.reset) buckets.delete(key);
      }
    }
    const b = buckets.get(ip);
    if (!b || now > b.reset) {
      buckets.set(ip, { count: 1, reset: now + opts.windowMs });
      return next();
    }
    b.count += 1;
    if (b.count > opts.max) {
      res.setHeader('Retry-After', Math.max(1, Math.ceil((b.reset - now) / 1000)));
      res.status(429).json({ error: message });
      return;
    }
    next();
  };
}
