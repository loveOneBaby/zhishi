import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBodyToIndex, normalizeIndex, indexText } from './index-tree.js';
import { blocksToMarkdown, convertEntry } from './blocks-import.js';
import { knowledgeTreeToImportPayload } from './knowledge-tree-import.js';
import { KB_PACKAGE_2_VERSION, kbPackage2ToImportPayload } from './kb-package-2.js';
import { score, searchEntries } from './search.js';
import { toSearchText } from './pinyin-search.js';
import { parseDataUrl, sha256, sniffImageSize, classifyImageSrc } from './assets.js';
import { extractText, blocksToMarkdown as blockNoteToMarkdown } from './blocks.js';
import { normalizeDocBlocks, splitDocToIndex, markdownToDocBlocks, safeImageUrl, safeLinkHref } from './doc.js';
import { assertAuthConfiguredForProduction } from './auth.js';
import { coerceGeneratedDraft, coerceGeneratedFolderTreeDraft, coerceGeneratedKbDraft, draftToMarkdown, extractJsonObject, kbQuestionToEntryInput, kbQuestionToMarkdown } from './ai-generate.js';
import { ensureTags } from './ai/render.js';
import { coerceAgentEditPlan } from './ai-agent-edit.js';
import { normalizeFolderDraftPathForTarget } from './services/kb-draft-writer.js';
import type { Entry } from './types.js';

const PNG_1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function withEnv(patch: Record<string, string | undefined>, fn: () => void): void {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(patch)) previous.set(key, process.env[key]);
  try {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function entry(over: Partial<Entry>): Entry {
  return {
    id: 'e1', cat: 'AI', kbId: 'kb1', folderId: null, title: '示例', py: '', tags: [], summary: '', intro: '',
    nodes: [], doc: [], sort: 0, createdAt: 0, updatedAt: 0, ...over,
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

test('searchEntries: doc 块正文参与检索', () => {
  const list = [
    entry({ id: 'doc', title: 'Git Commit', doc: [{ type: 'paragraph', content: '不可变对象模型和 DAG 历史。' }] }),
  ];
  assert.deepEqual(searchEntries(list, '不可变对象').map((e) => e.id), ['doc']);
});

test('assets: parseDataUrl / sha256 / sniffImageSize / classifyImageSrc', () => {
  const parsed = parseDataUrl(PNG_1x1);
  assert.ok(parsed);
  assert.equal(parsed!.mime, 'image/png');
  assert.ok(parsed!.bytes.length > 0);
  // 同内容哈希稳定
  assert.equal(sha256(parsed!.bytes), sha256(parseDataUrl(PNG_1x1)!.bytes));
  // 1x1 PNG 尺寸嗅探
  assert.deepEqual(sniffImageSize(parsed!.bytes), { width: 1, height: 1 });
  // 地址归类
  assert.equal(classifyImageSrc('https://x.com/a.png')!.kind, 'external');
  assert.equal(classifyImageSrc('/static/a.png')!.kind, 'external');
  assert.equal(classifyImageSrc(PNG_1x1)!.kind, 'data');
  assert.equal(classifyImageSrc('C:\\local\\a.png'), null);
  assert.equal(parseDataUrl('not-a-data-url'), null);
});

test('blocks.extractText: BlockNote 形态抽纯文本(含 caption/表格/子块/未知块)', () => {
  const blocks = [
    { type: 'paragraph', content: [{ type: 'text', text: 'Query 预处理 → ' }, { type: 'text', text: '多路召回' }] },
    { type: 'image', props: { url: 'https://x/a.png', caption: '检索链路' } },
    { type: 'table', content: { type: 'tableContent', rows: [{ cells: [[{ type: 'text', text: '稠密' }], [{ type: 'text', text: '语义' }]] }] } },
    { type: 'someFutureBlock', content: [{ type: 'text', text: '未知块文本' }], children: [{ type: 'paragraph', content: 'child 文本' }] },
  ];
  const txt = extractText(blocks);
  assert.ok(txt.includes('多路召回'));
  assert.ok(txt.includes('检索链路'));   // 图片 caption 进检索
  assert.ok(txt.includes('稠密') && txt.includes('语义')); // 表格文字
  assert.ok(txt.includes('未知块文本') && txt.includes('child 文本')); // 未知块不丢
});

test('blocks.blocksToMarkdown: heading/quote/table/code/list 不丢块', () => {
  const md = blockNoteToMarkdown([
    { type: 'heading', props: { level: 1 }, content: [{ type: 'text', text: '标题' }] },
    { type: 'quote', content: [{ type: 'text', text: '名言' }] },
    { type: 'codeBlock', props: { language: 'python' }, content: 'print(1)' },
    { type: 'bulletListItem', content: [{ type: 'text', text: '稠密' }] },
    { type: 'table', content: { type: 'tableContent', rows: [{ cells: [[{ type: 'text', text: '策略' }], [{ type: 'text', text: '场景' }]] }] } },
  ]);
  assert.ok(md.includes('## 标题'));
  assert.ok(md.includes('> 名言'));
  assert.ok(md.includes('```python\nprint(1)\n```'));
  assert.ok(md.includes('- 稠密'));
  assert.ok(md.includes('| 策略 | 场景 |'));
});

test('doc.normalizeDocBlocks: 简写 content/image 归一为合法块', () => {
  const blocks = normalizeDocBlocks([
    { type: 'heading', props: { level: 1 }, content: '定义' },
    { type: 'paragraph', content: 'ReAct 循环' },
    { type: 'image', url: 'https://cdn/x.png', caption: '流程' },
  ]);
  assert.equal(blocks.length, 3);
  // content 字符串 → 行内数组
  assert.ok(Array.isArray(blocks[0].content));
  assert.equal((blocks[0].content as any)[0].text, '定义');
  assert.ok(typeof blocks[0].id === 'string' && blocks[0].id.length > 0);
  // image: 顶层 url/caption 收敛进 props,且无行内 content
  assert.equal((blocks[2].props as any).url, 'https://cdn/x.png');
  assert.equal((blocks[2].props as any).caption, '流程');
  assert.equal(blocks[2].content, undefined);
});

test('doc URL safety: 清理危险链接与图片协议', () => {
  assert.equal(safeLinkHref('javascript:alert(1)'), '');
  assert.equal(safeLinkHref('https://example.com/a'), 'https://example.com/a');
  assert.equal(safeImageUrl('data:image/svg+xml;base64,PHN2Zy8+', true), '');
  assert.equal(safeImageUrl(PNG_1x1, true), PNG_1x1);

  const blocks = normalizeDocBlocks([
    { type: 'paragraph', content: [{ type: 'link', href: 'javascript:alert(1)', content: [{ type: 'text', text: '坏链接', styles: {} }] }] },
    { type: 'image', props: { url: 'javascript:alert(1)', caption: '坏图' } },
  ]);
  assert.deepEqual(blocks[0].content, [{ type: 'text', text: '坏链接', styles: {} }]);
  assert.equal((blocks[1].props as any).url, undefined);
});

test('auth: 线上环境必须配置 AUTH_TOKEN', () => {
  withEnv({
    NODE_ENV: 'production',
    AUTH_TOKEN: undefined,
    ALLOW_UNAUTHENTICATED_ADMIN: undefined,
    TURSO_DATABASE_URL: undefined,
    RENDER: undefined,
  }, () => {
    assert.throws(() => assertAuthConfiguredForProduction(), /AUTH_TOKEN/);
  });
  withEnv({ NODE_ENV: 'production', AUTH_TOKEN: 'secret' }, () => {
    assert.doesNotThrow(() => assertAuthConfiguredForProduction());
  });
});

test('doc.splitDocToIndex: 标题块切分为多级索引(顶层标题=二级索引)', () => {
  const doc = normalizeDocBlocks([
    { type: 'paragraph', content: '开篇说明' },
    { type: 'heading', props: { level: 1 }, content: '定义' },
    { type: 'paragraph', content: '正文A' },
    { type: 'heading', props: { level: 2 }, content: '子点' },
    { type: 'paragraph', content: '正文B' },
    { type: 'heading', props: { level: 1 }, content: '追问' },
  ]);
  const tree = splitDocToIndex(doc);
  assert.equal(tree.intro, '开篇说明');
  assert.deepEqual(tree.nodes.map((n) => n.title), ['定义', '追问']);
  assert.equal(tree.nodes[0].children[0].title, '子点');
  assert.ok(tree.nodes[0].content.includes('正文A'));
  assert.ok(tree.nodes[0].children[0].content.includes('正文B'));
  // 每个索引节点带 blocks 切片
  assert.ok(Array.isArray(tree.nodes[0].blocks) && tree.nodes[0].blocks!.length >= 1);
});

test('doc.markdownToDocBlocks: markdown → 块(种子/旧数据)', () => {
  const blocks = markdownToDocBlocks('# 标题\n段落\n- 列表项\n![图](https://cdn/a.png)\n```py\nprint(1)\n```');
  const types = blocks.map((b) => b.type);
  assert.ok(types.includes('heading'));
  assert.ok(types.includes('paragraph'));
  assert.ok(types.includes('bulletListItem'));
  assert.ok(types.includes('image'));
  assert.ok(types.includes('codeBlock'));
  const img = blocks.find((b) => b.type === 'image')!;
  assert.equal((img.props as any).url, 'https://cdn/a.png');
});

test('ai-generate: 抽取模型 JSON 并转成知识点 markdown', () => {
  const json = extractJsonObject('```json\n{"title":"RAG","summary":"检索增强生成","tags":["RAG"],"sections":[{"title":"定义","content":"先检索再生成","bullets":["降低幻觉"]}],"interviewPoints":["召回","重排"],"commonQuestions":["为什么需要 RAG？"],"pitfalls":["上下文不是越多越好"],"answerTemplate":"RAG 是..."}\n```');
  assert.ok(json);
  const draft = coerceGeneratedDraft(JSON.parse(json!), 'RAG');
  assert.equal(draft.title, 'RAG');
  assert.deepEqual(draft.interviewPoints, ['召回', '重排']);
  const md = draftToMarkdown(draft);
  assert.ok(md.includes('## 面试考点'));
  assert.ok(md.includes('- 召回'));
  assert.ok(md.includes('## 高频追问'));
});

test('ai-generate: 标签规范化并保留 AI生成', () => {
  assert.deepEqual(
    ensureTags(['#Git', '版本控制/工程规范', 'git', ''], 'Git Commit'),
    ['Git Commit', 'Git', '版本控制 工程规范', 'AI生成'],
  );
});

test('ai-generate: 知识库 JSON 转目录与 Q&A markdown', () => {
  const draft = coerceGeneratedKbDraft({
    kbName: 'Redis 面试知识库',
    folders: [{ path: ['数据结构'] }],
    questions: [{
      folderPath: ['数据结构', 'String'],
      title: 'Redis String 如何实现计数器？',
      question: 'Redis String 如何实现计数器？',
      summary: '围绕 String 原子自增和使用边界。',
      tags: ['Redis'],
      shortAnswer: '使用 INCR/DECR 这类原子命令，避免应用层读改写竞争。',
      keyPoints: ['单线程执行命令', '注意溢出和过期时间'],
      followUps: ['如何保证过期时间不被覆盖？'],
      pitfalls: ['不要用 GET 后 SET 模拟自增'],
    }],
  }, 'Redis');
  assert.equal(draft.kbName, 'Redis 面试知识库');
  assert.deepEqual(draft.folders.map((folder) => folder.path), [['数据结构'], ['数据结构', 'String']]);
  const md = kbQuestionToMarkdown(draft.questions[0]);
  assert.ok(md.includes('## 一句话结论'));
  assert.ok(md.includes('## 面试题'));
  assert.ok(md.includes('## 高频追问'));
});

test('ai-generate: kb-package-2 风格 containers/entries 可还原目录挂载', () => {
  const draft = coerceGeneratedKbDraft({
    kbName: 'AI Agent 面试知识库',
    containers: [
      { sourceId: 'folder_llm', kind: 'folder', parentSourceId: null, name: 'LLM', sort: 1 },
      { sourceId: 'folder_llm_explain', kind: 'folder', parentSourceId: 'folder_llm', name: '解释', sort: 1 },
      { sourceId: 'folder_agent', kind: 'folder', parentSourceId: null, name: 'Agent', sort: 2 },
    ],
    entries: [{
      sourceId: 'agent_001',
      containerSourceId: 'folder_llm_explain',
      title: '什么是 LLM',
      tags: ['LLM'],
      doc: [
        { type: 'heading', props: { level: 3 }, content: '基本定义' },
        { type: 'paragraph', content: 'LLM 通过学习海量文本掌握语言规律。' },
      ],
    }],
  }, 'AI Agent');
  assert.deepEqual(draft.folders.map((folder) => folder.path), [['LLM'], ['LLM', '解释'], ['Agent']]);
  assert.deepEqual(draft.questions[0].folderPath, ['LLM', '解释']);
  const input = kbQuestionToEntryInput(draft.questions[0], 'AI Agent');
  assert.equal(input.doc?.[0]?.type, 'heading');
  assert.ok((input.tags ?? []).includes('AI生成'));
});

test('ai-generate: 目录初始化 JSON 只转文件夹路径', () => {
  const draft = coerceGeneratedFolderTreeDraft({
    title: 'Kafka 目录',
    folders: [
      { path: ['基础概念'] },
      { name: '核心原理', children: [{ name: '副本机制' }, { name: '消费组' }] },
      { path: ['核心原理', '副本机制'] },
    ],
    questions: [{ title: '不应进入目录初始化结果' }],
  }, 'Kafka');
  assert.equal(draft.title, 'Kafka 目录');
  assert.deepEqual(draft.folders.map((folder) => folder.path), [
    ['基础概念'],
    ['核心原理'],
    ['核心原理', '副本机制'],
    ['核心原理', '消费组'],
  ]);
});

test('kb-draft-writer: 目录初始化路径按目标目录归一为相对路径', () => {
  const targetPath = ['基础与原理', '数据类型与范式'];
  assert.deepEqual(
    normalizeFolderDraftPathForTarget(['Mysql', '基础与原理', '数据类型与范式', '索引类型'], { kbName: 'Mysql', targetPath }),
    ['索引类型'],
  );
  assert.deepEqual(
    normalizeFolderDraftPathForTarget(['数据类型与范式', '反范式设计'], { kbName: 'Mysql', targetPath }),
    ['反范式设计'],
  );
  assert.deepEqual(
    normalizeFolderDraftPathForTarget(['执行计划', '索引选择'], { kbName: 'Mysql', targetPath }),
    ['执行计划', '索引选择'],
  );
});

test('ai-agent-edit: 校验动作引用并保留 create-folder ref', () => {
  const plan = coerceAgentEditPlan({
    summary: '重组缓存目录并补内容',
    actions: [
      { kind: 'create-folder', ref: 'cache_high_availability', parentFolderId: 'fd_cache', name: '高可用' },
      { kind: 'move-entry', entryId: 'e_redis_lock', folderId: 'cache_high_availability' },
      { kind: 'rewrite-entry', entryId: 'missing_entry', instruction: '补充故障恢复' },
    ],
  }, {
    folderIds: new Set(['fd_cache']),
    entryIds: new Set(['e_redis_lock']),
  });
  assert.equal(plan.actions.length, 3);
  assert.equal(plan.actions[0].kind, 'create-folder');
  assert.equal(plan.actions[0].ref, 'cache_high_availability');
  assert.equal(plan.actions[1].kind, 'move-entry');
  assert.equal(plan.actions[1].folderRef, 'cache_high_availability');
  assert.equal(plan.actions[2].kind, 'note');
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

test('convertEntry: 扁平条目直通', () => {
  const out = convertEntry({
    id: 'x', cat: '前端', title: '闭包', intro: '引言',
    nodes: [{ id: 'n', title: 't', content: 'c', children: [] }],
  });
  assert.equal(out.intro, '引言');
  assert.equal(out.nodes![0].content, 'c');
});

test('convertEntry: 支持 kb-package-2 的 sourceId / containerSourceId / 元信息标签', () => {
  const out = convertEntry({
    sourceId: 'agent_001',
    containerSourceId: 'container_llm_explain',
    title: '什么是 LLM',
    tags: ['LLM'],
    aliases: ['大语言模型', 'Large Language Model'],
    importance: 'high',
    difficulty: 'basic',
    summary: '核心是预测下一个字。',
  });
  assert.equal(out.id, 'agent_001');
  assert.equal(out.folderId, 'container_llm_explain');
  assert.equal(out.title, '什么是 LLM');
  assert.deepEqual(out.tags, ['LLM', '大语言模型', 'Large Language Model', '重要度:high', '难度:basic']);
});

test('kbPackage2ToImportPayload: 容器映射为文件夹，知识点挂到对应容器', () => {
  const payload = kbPackage2ToImportPayload({
    version: KB_PACKAGE_2_VERSION,
    package: { sourceId: 'agent-demo', title: 'AI Agent' },
    schema: { contentFormat: 'block-doc-v1' },
    targetKbId: 'kb_current',
    targetKbName: '当前知识库',
    targetFolderId: 'fd_target',
    importBatchId: 'batch_v2',
    containers: [
      { sourceId: 'c_llm', kind: 'folder', name: 'LLM', sort: 1 },
      { sourceId: 'c_llm_explain', kind: 'folder', parentSourceId: 'c_llm', name: '解释', sort: 2 },
    ],
    entries: [
      {
        sourceId: 'e_llm',
        containerSourceId: 'c_llm_explain',
        title: '什么是 LLM',
        tags: ['LLM'],
        aliases: ['大语言模型'],
        importance: 'high',
        summary: '核心是预测下一个字。',
        doc: [{ type: 'paragraph', content: 'LLM 是大语言模型。' }],
        sourceRefs: [{ title: '原文', url: 'https://example.com/llm' }],
      },
    ],
  });

  assert.equal(payload.kbs, undefined);
  assert.equal(payload.folders?.length, 2);
  const parent = payload.folders?.find((f) => f.name === 'LLM')!;
  const child = payload.folders?.find((f) => f.name === '解释')!;
  assert.equal(parent.parentId, 'fd_target');
  assert.equal(child.parentId, parent.id);
  assert.equal(payload.entries[0].folderId, child.id);
  assert.equal(payload.entries[0].kbId, 'kb_current');
  assert.ok(payload.entries[0].tags?.includes('大语言模型'));
  assert.ok(payload.entries[0].tags?.includes('重要度:high'));
  assert.ok(payload.entries[0].doc?.some((block) => block.type === 'heading' && block.content === '参考链接'));
  assert.ok(JSON.stringify(payload.entries[0].doc).includes('https://example.com/llm'));
});

test('kbPackage2ToImportPayload: 无容器知识点可明确导入到根目录', () => {
  const payload = kbPackage2ToImportPayload({
    version: KB_PACKAGE_2_VERSION,
    package: { sourceId: 'root-demo', title: 'Root Demo' },
    targetKbId: 'kb_current',
    targetKbName: '当前知识库',
    targetFolderId: null,
    importBatchId: 'batch_root',
    entries: [{ sourceId: 'root_entry', title: '根级知识点', summary: '直接挂在知识库根下。' }],
  });

  assert.deepEqual(payload.folders, []);
  assert.equal(payload.entries[0].folderId, null);
  assert.equal(payload.entries[0].cat, '当前知识库');
});

test('kbPackage2ToImportPayload: 无 doc 时 sourceRefs 追加到 intro，不覆盖正文', () => {
  const payload = kbPackage2ToImportPayload({
    version: KB_PACKAGE_2_VERSION,
    package: { sourceId: 'intro-demo', title: 'Intro Demo' },
    entries: [
      {
        sourceId: 'intro_entry',
        title: '只有引言的知识点',
        intro: '这是原始引言。',
        sourceRefs: [{ title: '参考', url: 'https://example.com/ref' }],
      },
    ],
  });

  assert.ok(payload.entries[0].intro?.includes('这是原始引言。'));
  assert.ok(payload.entries[0].intro?.includes('https://example.com/ref'));
  assert.equal(payload.entries[0].doc, undefined);
});

test('kbPackage2ToImportPayload: package.sourceUrl 作为 entry 默认来源', () => {
  const payload = kbPackage2ToImportPayload({
    version: KB_PACKAGE_2_VERSION,
    package: {
      sourceId: 'package-source-demo',
      title: 'Package Source Demo',
      source: '整包来源',
      sourceUrl: 'https://example.com/package',
    },
    entries: [
      {
        sourceId: 'doc_entry',
        title: '有 doc 的知识点',
        doc: [{ type: 'paragraph', content: '正文。' }],
      },
      {
        sourceId: 'intro_entry',
        title: '只有 intro 的知识点',
        intro: '正文引言。',
      },
      {
        sourceId: 'own_ref_entry',
        title: '独立来源知识点',
        intro: '独立正文。',
        sourceRefs: [{ title: '独立来源', url: 'https://example.com/entry' }],
      },
    ],
  });

  assert.ok(JSON.stringify(payload.entries[0].doc).includes('https://example.com/package'));
  assert.ok(payload.entries[1].intro?.includes('https://example.com/package'));
  assert.ok(payload.entries[2].intro?.includes('https://example.com/entry'));
  assert.equal(payload.entries[2].intro?.includes('https://example.com/package'), false);
});

test('knowledgeTreeToImportPayload: tree 文件夹 + knowledge 叶子转为导入结构', () => {
  const payload = knowledgeTreeToImportPayload({
    version: 'knowledge-tree-v1',
    meta: { title: 'AI Agent 面试知识树', source: 'xiaolinnote', sourceUrl: 'https://example.com' },
    tree: [
      {
        type: 'folder',
        title: 'Agent',
        children: [
          {
            type: 'knowledge',
            title: 'ReAct',
            summary: '边思考边行动。',
            tags: ['Agent'],
            aliases: ['reason act'],
            interview: {
              question: 'ReAct 是什么？',
              answer: 'ReAct 通过 Thought / Action / Observation 循环工作。',
              keyPoints: ['推理与行动交替'],
              pitfalls: ['不是单次函数调用'],
              followUps: ['如何避免无限循环？'],
            },
            content: [{ title: '定义', body: 'ReAct 是经典 Agent 工作模式。' }],
            links: [{ title: '原文', url: 'https://example.com/react' }],
          },
        ],
      },
    ],
  });
  assert.equal(payload.kbs?.[0].name, 'AI Agent 面试知识树');
  assert.equal(payload.folders?.length, 1);
  assert.equal(payload.entries.length, 1);
  assert.equal(payload.entries[0].title, 'ReAct');
  assert.equal(payload.entries[0].folderId, payload.folders?.[0].id);
  assert.ok(payload.entries[0].tags?.includes('reason act'));
  assert.equal(payload.entries[0].nodes?.[0].title, '面试回答');
  assert.deepEqual(payload.entries[0].nodes?.[0].children.map((n) => n.title), ['关键点', '易错点', '常见追问']);
});

test('knowledgeTreeToImportPayload: 指定 targetKbId 时仍写入知识库映射', () => {
  const payload = knowledgeTreeToImportPayload({
    version: 'knowledge-tree-v1',
    meta: { title: 'AI Agent 面试知识树' },
    targetKbId: 'kb_current',
    targetKbName: '当前知识库',
    tree: [{ type: 'knowledge', title: 'Agent', summary: '智能体' }],
  });
  assert.deepEqual(payload.kbs, [{ id: 'kb_current', name: '当前知识库', sort: 0 }]);
  assert.equal(payload.entries[0].kbId, 'kb_current');
});

test('knowledgeTreeToImportPayload: 指定 targetFolderId 时挂到目标文件夹', () => {
  const tree = [
    { type: 'folder', title: '工作模式', children: [{ type: 'knowledge', title: 'ReAct', summary: '循环调用工具' }] },
    { type: 'knowledge', title: 'Agent', summary: '智能体' },
  ];
  const rootPayload = knowledgeTreeToImportPayload({
    version: 'knowledge-tree-v1',
    meta: { title: 'AI Agent 面试知识树' },
    targetKbId: 'kb_current',
    targetKbName: '当前知识库',
    importBatchId: 'batch_target_test',
    tree,
  });
  const payload = knowledgeTreeToImportPayload({
    version: 'knowledge-tree-v1',
    meta: { title: 'AI Agent 面试知识树' },
    targetKbId: 'kb_current',
    targetKbName: '当前知识库',
    targetFolderId: 'fd_target',
    importBatchId: 'batch_target_test',
    tree,
  });

  assert.equal(payload.folders?.[0].parentId, 'fd_target');
  assert.notEqual(payload.folders?.[0].id, rootPayload.folders?.[0].id);
  assert.equal(payload.entries.find((entry) => entry.title === 'Agent')?.folderId, 'fd_target');
  assert.equal(payload.entries.find((entry) => entry.title === 'ReAct')?.folderId, payload.folders?.[0].id);
});

test('knowledgeTreeToImportPayload: 同一目标重复导入会生成新的目录和知识点', () => {
  const input = {
    version: 'knowledge-tree-v1',
    meta: { title: 'AI Agent 面试知识树' },
    targetKbId: 'kb_current',
    targetKbName: '当前知识库',
    targetFolderId: 'fd_target',
    tree: [
      { type: 'folder', title: '工作模式', children: [{ type: 'knowledge', title: 'ReAct', summary: '循环调用工具' }] },
    ],
  };
  const first = knowledgeTreeToImportPayload({ ...input, importBatchId: 'batch_1' });
  const second = knowledgeTreeToImportPayload({ ...input, importBatchId: 'batch_2' });

  assert.notEqual(first.folders?.[0].id, second.folders?.[0].id);
  assert.notEqual(first.entries[0].id, second.entries[0].id);
  assert.equal(first.folders?.[0].parentId, 'fd_target');
  assert.equal(second.folders?.[0].parentId, 'fd_target');
});

test('knowledgeTreeToImportPayload: 导入知识点图片和内容图片', () => {
  const payload = knowledgeTreeToImportPayload({
    version: 'knowledge-tree-v1',
    meta: { title: 'AI Agent 面试知识树' },
    tree: [
      {
        type: 'knowledge',
        title: 'Agent 架构图',
        summary: '带图知识点。',
        images: [{ title: 'Agent 总览', url: 'https://cdn.example.com/agent-flow.png' }],
        content: [
          {
            title: '执行链路',
            body: '先规划，再调用工具。',
            images: [{ caption: '执行流程', src: 'data:image/png;base64,abc123' }],
          },
        ],
      },
    ],
  });
  const entry = payload.entries[0];
  assert.equal(entry.nodes?.[0].title, '图片');
  assert.ok(entry.nodes?.[0].content.includes('![Agent 总览](https://cdn.example.com/agent-flow.png)'));
  assert.ok(entry.nodes?.[1].content.includes('![执行流程](data:image/png;base64,abc123)'));
});
