import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newNode, addChild, moveNode, removeNode, patchNode } from './outline';
import { buildNeedles, matchesQuery, toSearchText } from './pinyin-search';
import { filterEntries } from './search';
import { buildModel, collectVisible, buildTreeLayout } from './components/canvas/model';
import type { Entry, KnowledgeBase, Folder } from './types';

function entry(over: Partial<Entry>): Entry {
  return { id: 'e', cat: 'AI', kbId: 'kb1', folderId: null, title: '示例', py: '', tags: [], summary: '', intro: '', nodes: [], ...over };
}

const noFolders: Folder[] = [];
const kbAi: KnowledgeBase[] = [{ id: 'kb1', name: 'AI', sort: 0 }];

test('outline: 增/改/移/删 树操作', () => {
  let nodes = [newNode('A'), newNode('B')];
  const aId = nodes[0].id;
  nodes = patchNode(nodes, aId, { title: 'A改' });
  assert.equal(nodes[0].title, 'A改');
  nodes = addChild(nodes, aId, newNode('A1'));
  assert.equal(nodes[0].children[0].title, 'A1');
  nodes = moveNode(nodes, nodes[1].id, -1); // B 上移到首
  assert.equal(nodes[0].title, 'B');
  nodes = removeNode(nodes, aId);
  assert.equal(nodes.find((n) => n.id === aId), undefined);
});

test('buildNeedles: 只用整词形式, 不拆单音节', () => {
  const n = buildNeedles('多路');
  assert.ok(n.includes('多路'));
  assert.ok(n.includes('duolu'));
  assert.ok(n.includes('dl'));
  assert.ok(!n.includes('duo'));
  assert.ok(!n.includes('lu'));
});

test('matchesQuery: 多路命中“多路召回”, 不命中“多问题”', () => {
  const hit = toSearchText('多路召回', 'RRF 融合');
  const miss = toSearchText('Query Rewrite', '拆分多问题');
  assert.equal(matchesQuery(hit, '多路'), true);
  assert.equal(matchesQuery(miss, '多路'), false);
});

test('filterEntries: 中文/拼音命中, 无关排除', () => {
  const list = [
    entry({ id: 'r', title: 'RAG', py: 'rag', nodes: [{ id: 'n', title: '多路召回', content: 'RRF', children: [] }] }),
    entry({ id: 'b', title: '闭包', py: 'bibao bb', summary: '词法作用域' }),
  ];
  assert.deepEqual(filterEntries(list, '多路').map((e) => e.title), ['RAG']);
  assert.deepEqual(filterEntries(list, 'bibao').map((e) => e.title), ['闭包']);
  assert.equal(filterEntries(list, '无关xyz').length, 0);
});

test('filterEntries: doc 块正文参与前端检索', () => {
  const list = [
    entry({ id: 'doc', title: 'Git Commit', doc: [{ type: 'paragraph', content: '不可变对象模型和 DAG 历史。' }] }),
  ];
  assert.deepEqual(filterEntries(list, 'DAG 历史').map((e) => e.id), ['doc']);
});

test('canvas model: buildModel / collectVisible / layout', () => {
  const list = [
    entry({ id: 'k1', cat: 'AI', title: '知识点1', nodes: [
      { id: 's1', title: '二级A', content: '内容', children: [{ id: 's11', title: '三级', content: 'x', children: [] }] },
    ] }),
  ];
  const { map, kbs } = buildModel(list, noFolders, kbAi);
  assert.equal(kbs.length, 1);
  const kbId = kbs[0];
  assert.equal(map.get(kbId)!.type, 'cat');
  // 默认可见（depth 限制内）应含知识点与二级/三级
  const visible = collectVisible(map, kbId, '', false, new Set(), false);
  assert.ok(visible.has('ent::k1'));
  assert.ok([...visible].some((id) => map.get(id)!.label === '二级A'));
  const layout = buildTreeLayout(map, kbId, visible);
  assert.ok(layout.nodes.length >= 3);
  assert.ok(layout.width > 0 && layout.height > 0);
  // 根在最左
  const root = layout.byId.get(kbId)!;
  assert.ok(layout.nodes.every((p) => p.x >= root.x));
});
