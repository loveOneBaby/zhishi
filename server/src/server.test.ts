import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBodyToIndex, normalizeIndex, indexText } from './index-tree.js';
import { blocksToMarkdown, convertEntry } from './blocks-import.js';
import { score, searchEntries } from './search.js';
import { toSearchText } from './pinyin-search.js';
import type { Entry } from './types.js';

function entry(over: Partial<Entry>): Entry {
  return {
    id: 'e1', cat: 'AI', title: '示例', py: '', tags: [], summary: '', intro: '',
    nodes: [], sort: 0, createdAt: 0, updatedAt: 0, ...over,
  };
}

test('parseBodyToIndex: 嵌套标题与引言', () => {
  const tree = parseBodyToIndex('引言文字\n## 一级\n内容A\n### 子级\n内容B\n## 二级\n内容C');
  assert.equal(tree.intro, '引言文字');
  assert.equal(tree.nodes.length, 2);
  assert.equal(tree.nodes[0].title, '一级');
  assert.equal(tree.nodes[0].content, '内容A');
  assert.equal(tree.nodes[0].children.length, 1);
  assert.equal(tree.nodes[0].children[0].title, '子级');
  assert.equal(tree.nodes[1].title, '二级');
});

test('normalizeIndex: 补 id / 默认标题 / 深度上限', () => {
  const t = normalizeIndex({ intro: 'x', nodes: [{ title: '', content: 'c' }] });
  assert.equal(t.nodes[0].title, '未命名索引');
  assert.ok(t.nodes[0].id.length > 0);
  // 构造超深结构，应在 MAX_DEPTH(6) 处截断
  let deep: any = { title: 'd', content: '', children: [] };
  let cur = deep;
  for (let i = 0; i < 12; i++) { const c = { title: 'd' + i, content: '', children: [] }; cur.children.push(c); cur = c; }
  const nt = normalizeIndex({ intro: '', nodes: [deep] });
  let depth = 0; let p = nt.nodes[0];
  while (p.children.length) { depth++; p = p.children[0]; }
  assert.ok(depth <= 6, `深度应 <=6, 实际 ${depth}`);
});

test('indexText: 含引言/标题/内容', () => {
  const txt = indexText({ intro: '导语', nodes: [{ id: 'a', title: '标题甲', content: '正文乙', children: [] }] });
  assert.ok(txt.includes('导语'));
  assert.ok(txt.includes('标题甲'));
  assert.ok(txt.includes('正文乙'));
});

test('toSearchText: 中文输出含原文与拼音', () => {
  const s = toSearchText('闭包');
  assert.ok(s.includes('闭包'));
  assert.ok(s.includes('bibao'));
  assert.ok(s.includes('bb'));
});

test('searchEntries: 中文子串 / 拼音 / 缩写命中, 无关不命中', () => {
  const list = [
    entry({ id: 'r', cat: 'AI', title: 'RAG', py: 'rag', nodes: [{ id: 'n', title: '多路召回', content: 'RRF 融合', children: [] }] }),
    entry({ id: 'b', cat: '前端', title: '闭包', py: 'bibao bb closure', summary: '词法作用域' }),
  ];
  const byCn = searchEntries(list, '多路').map((e) => e.title);
  assert.deepEqual(byCn, ['RAG']);
  const byPy = searchEntries(list, 'bibao').map((e) => e.title);
  assert.deepEqual(byPy, ['闭包']);
  const byAbbr = searchEntries(list, 'bb').map((e) => e.title);
  assert.deepEqual(byAbbr, ['闭包']);
  assert.equal(searchEntries(list, '完全不相关xyz').length, 0);
});

test('score: 标题前缀分高于全文包含', () => {
  const e = entry({ title: '快速排序', py: 'kuaisupaixu', nodes: [{ id: 'x', title: '复杂度', content: '平均 nlogn', children: [] }] });
  assert.ok(score(e, '快速') >= 80);     // 标题包含/前缀
  assert.ok(score(e, '复杂度') >= 50);   // 索引全文包含
  assert.equal(score(e, '无关'), -1);
});

test('blocksToMarkdown: 段落/代码/引用/列表/折叠', () => {
  const md = blocksToMarkdown([
    { id: 'p', type: 'paragraph', data: { text: 'Query 预处理 → **多路召回**' } },
    { id: 'cd', type: 'code', data: { lang: 'python', text: 'retriever.search(q)' } },
    { id: 'cl', type: 'callout', data: { tone: 'warn', text: '上下文不是越多越好' } },
    { id: 'li', type: 'list', data: { ordered: false, items: ['稠密', '稀疏', '规则'] } },
    { id: 'tg', type: 'toggle', data: { text: '展开:三种召回' },
      children: [{ id: 'li2', type: 'list', data: { ordered: false, items: ['稠密', '稀疏', '规则'] } }] },
  ]);
  assert.ok(md.includes('Query 预处理 → **多路召回**'));
  assert.ok(md.includes('```python\nretriever.search(q)\n```'));
  assert.ok(md.includes('⚠️ 上下文不是越多越好'));
  assert.ok(md.includes('- 稠密'));
  assert.ok(md.includes('### 展开:三种召回'));
});

test('convertEntry: image 经 assetId 解析 + searchText 并入 intro', () => {
  const assets = [{ id: 'img_1', type: 'image', url: 'https://cdn/flow.png' }];
  const out = convertEntry({
    id: 'rag', cat: 'AI', title: 'RAG', tags: ['检索'], summary: 's',
    intro: { blocks: [{ id: 'p0', type: 'paragraph', data: { text: '四段梳理' } }] },
    nodes: [
      { id: 'n1', title: '在线检索流程',
        blocks: [
          { id: 'p1', type: 'paragraph', data: { text: '融合' } },
          { id: 'im1', type: 'image', data: { assetId: 'img_1', caption: '检索链路' } },
        ],
        children: [] },
    ],
    searchText: '检索增强 rag',
  }, assets);
  assert.equal(out.id, 'rag');
  assert.equal(out.intro, '四段梳理\n\n检索增强 rag');
  assert.ok(out.nodes![0].content.includes('[🖼 检索链路](https://cdn/flow.png)'));
  // 资源缺失时优雅降级为纯文本 caption
  const out2 = convertEntry({
    intro: { blocks: [{ type: 'image', data: { assetId: 'nope', caption: '无图' } }] },
  }, []);
  assert.equal(out2.intro, '🖼 无图');
});

test('convertEntry: 扁平旧条目直通（v1 兼容）', () => {
  const out = convertEntry({
    id: 'x', cat: '前端', title: '闭包', intro: '引言',
    nodes: [{ id: 'n', title: 't', content: 'c', children: [] }],
  });
  assert.equal(out.intro, '引言');
  assert.equal(out.nodes![0].content, 'c');
});
