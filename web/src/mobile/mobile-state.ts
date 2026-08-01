export type ReaderProgressMap = Record<string, { progress: number; updatedAt: number }>;

export function calculateReadingProgress(scrollTop: number, scrollHeight: number, clientHeight: number): number {
  const maxScroll = Math.max(0, scrollHeight - clientHeight);
  if (maxScroll === 0) return 0;
  return Math.max(0, Math.min(100, Math.round((scrollTop / maxScroll) * 100)));
}

export function formatViewCount(views: number): string {
  if (views < 1000) return `${views} 次阅读`;
  const value = views < 10_000 ? (views / 1000).toFixed(1) : Math.round(views / 1000).toString();
  return `${value.replace(/\.0$/, '')}k 阅读`;
}

function localDayKey(ts: number): string {
  const date = new Date(ts);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

export function weeklyReading(readerProgress: ReaderProgressMap, now = new Date()): { days: Array<{ label: string; done: boolean; active: boolean }>; streak: number } {
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const weekday = (now.getDay() + 6) % 7;
  const monday = todayStart - weekday * 86_400_000;
  const readDays = new Set(Object.values(readerProgress).map((item) => localDayKey(item.updatedAt)));
  const labels = ['一', '二', '三', '四', '五', '六', '日'];
  const days = labels.map((label, index) => {
    const ts = monday + index * 86_400_000;
    return { label, done: readDays.has(localDayKey(ts)), active: ts === todayStart };
  });
  let streak = 0;
  for (let cursor = todayStart; readDays.has(localDayKey(cursor)); cursor -= 86_400_000) streak += 1;
  return { days, streak };
}
