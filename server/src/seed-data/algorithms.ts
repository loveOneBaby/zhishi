import type { SeedEntry } from './types.js';

export const ALGORITHM_ENTRIES: SeedEntry[] = [
  { id: 'al1', cat: '算法', title: '快速排序', py: 'kuaisupaixu kspx quicksort kuaipai', tags: ['排序'], summary: '分治 + 基准划分，平均 O(n log n)。', body: '## 思想\n选基准 pivot，划分为左小右大两部分，递归处理。\n\n## 复杂度\n- 平均 O(n log n)，最坏 O(n²)（已有序）\n- 原地排序，空间 O(log n)\n- 不稳定\n\n## 优化\n随机基准 / 三数取中，避免最坏情况。' },
  { id: 'al2', cat: '算法', title: '二分查找', py: 'erfenchazhao efcz binarysearch erfen', tags: ['查找'], summary: '有序数组中 O(log n) 定位目标。', body: '前提：数组必须**有序**，每次将搜索区间折半。\n\n## 实现\n```js\nfunction bs(a, t) {\n  let l = 0, r = a.length - 1;\n  while (l <= r) {\n    const m = (l + r) >> 1;\n    if (a[m] === t) return m;\n    a[m] < t ? l = m + 1 : r = m - 1;\n  }\n  return -1;\n}\n```\n\n## 边界要点\n- 循环条件 `l <= r`\n- 收缩用 `m+1` / `m-1`，防止死循环\n- 中点用 `(l + r) >> 1` 或 `l + (r-l)/2` 防溢出\n\n## 复杂度\n- 时间 O(log n)，空间 O(1)' },
];
