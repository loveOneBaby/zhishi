import { AiConfigError, getAiConfig } from './ai-client.js';
import { extractText, type Block } from './blocks.js';
import { createDataAsset, type EntryInput } from './db.js';
import { markdownToDocBlocks, normalizeDocBlocks } from './doc.js';
import type { GenerateEntryEvent } from './ai/types.js';

interface GeneratedIllustration {
  assetId: string;
  url: string;
  caption: string;
  prompt: string;
}

interface IllustrationContext {
  title: string;
  summary?: string;
  tags?: string[];
  kbName?: string;
  folderPath?: string;
}

type ImageEmitter = (event: Extract<GenerateEntryEvent, { type: 'image-stage' | 'image' }>) => void;

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function enabled(): boolean {
  return !/^false|0|off$/i.test(String(process.env.AI_IMAGE_ENABLED ?? 'true').trim());
}

function imageModel(): string {
  return clean(process.env.AI_IMAGE_MODEL)
    || clean(process.env.QWEN_IMAGE_MODEL)
    || 'qwen-image-2.0-pro';
}

function imageEndpoint(): string {
  const explicit = clean(process.env.AI_IMAGE_ENDPOINT) || clean(process.env.AI_IMAGE_BASE_URL);
  const raw = explicit || getAiConfig().baseUrl || 'https://dashscope.aliyuncs.com';
  const base = trimTrailingSlash(raw);
  if (/\/api\/v1\/services\/aigc\/multimodal-generation\/generation$/i.test(base)) return base;
  try {
    const url = new URL(base);
    if (/compatible-mode\/v1$/i.test(url.pathname)) {
      return `${url.origin}/api/v1/services/aigc/multimodal-generation/generation`;
    }
    if (url.pathname === '' || url.pathname === '/') {
      return `${url.origin}/api/v1/services/aigc/multimodal-generation/generation`;
    }
  } catch {
    // fall through to append
  }
  return `${base}/api/v1/services/aigc/multimodal-generation/generation`;
}

function inline(content: string): Block['content'] {
  return [{ type: 'text', text: content, styles: {} }];
}

function headingBlock(text: string): Block {
  return { type: 'heading', props: { level: 2 }, content: inline(text), children: [] };
}

function imageBlock(url: string): Block {
  return { type: 'image', props: { url, caption: '' }, children: [] };
}

function mergeTags(tags: string[] | undefined, extra: string[]): string[] {
  const out: string[] = [];
  for (const tag of [...(tags ?? []), ...extra]) {
    const next = String(tag ?? '').trim();
    if (next && !out.some((item) => item.toLowerCase() === next.toLowerCase())) out.push(next);
    if (out.length >= 8) break;
  }
  return out;
}

function inputDoc(input: EntryInput): Block[] {
  if (input.doc?.length) return normalizeDocBlocks(input.doc);
  if (input.intro || input.nodes?.length) {
    const lines = [
      input.intro ?? '',
      ...(input.nodes ?? []).map((node) => `## ${node.title}\n${node.content}`),
    ];
    return markdownToDocBlocks(lines.join('\n\n'));
  }
  return markdownToDocBlocks(input.summary ?? '');
}

function plainInline(content: unknown): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(plainInline).join('');
  const c = content as Record<string, unknown>;
  if (typeof c.text === 'string') return c.text;
  if (c.type === 'link') return plainInline(c.content);
  if (c.type === 'tableContent' && Array.isArray(c.rows)) {
    return (c.rows as Array<{ cells?: unknown[] }>)
      .map((row) => (Array.isArray(row.cells) ? row.cells.map(plainInline).join(' ') : ''))
      .join(' ');
  }
  return '';
}

function compactText(value: unknown, max = 42): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).replace(/[，。；、：,.:\s]+$/u, '')}…`;
}

function uniqueList(values: unknown[], limit: number): string[] {
  const out: string[] = [];
  for (const raw of values) {
    const text = compactText(raw, 30);
    if (!text || text.length < 2) continue;
    if (out.some((item) => item.toLowerCase() === text.toLowerCase())) continue;
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function collectHeadings(blocks: Block[], out: string[] = []): string[] {
  for (const block of blocks) {
    if (String(block?.type ?? '') === 'heading') {
      const text = compactText(plainInline(block.content), 18);
      if (text && !['图解', '参考链接'].includes(text)) out.push(text);
    }
    if (Array.isArray(block?.children) && block.children.length) collectHeadings(block.children, out);
  }
  return out;
}

function splitHints(text: string): string[] {
  return text
    .split(/[\n。！？!?；;]/u)
    .map((line) => compactText(line, 28))
    .filter((line) => line.length >= 4);
}

function inferDiagramPattern(seed: string): string {
  if (/对比|区别|vs|VS|选型|比较|差异|优劣|取舍/u.test(seed)) {
    return '中心用左右对比图或决策天平，突出差异和选型依据';
  }
  if (/树|索引|B\+|B树|Trie|红黑树|跳表|层级|节点/u.test(seed)) {
    return '中心用分层树状节点图，节点之间用箭头和连线表达查找路径';
  }
  if (/流程|链路|生命周期|过程|执行|调用|提交|事务|同步/u.test(seed)) {
    return '中心用横向流程图或循环箭头，表达阶段、输入输出和关键状态';
  }
  if (/架构|模块|组件|系统|生态|协议|网关|服务/u.test(seed)) {
    return '中心用分层架构图，模块之间用清晰连线表达职责边界';
  }
  return '中心用概念关系图，围绕主题放置 4-6 个关键节点和箭头';
}

function buildIllustrationPrompt(input: EntryInput, ctx: IllustrationContext): string {
  const doc = inputDoc(input);
  const title = compactText(ctx.title || input.title, 30);
  const summary = compactText(ctx.summary || input.summary || extractText(doc), 90);
  const tags = uniqueList(ctx.tags || input.tags || [], 8);
  const headings = collectHeadings(doc);
  const bodyHints = splitHints(extractText(doc));
  const concepts = uniqueList([...headings, ...tags, ...splitHints(summary), ...bodyHints], 8);
  const pattern = inferDiagramPattern([title, summary, tags.join(' '), concepts.join(' ')].join(' '));

  return [
    '生成一张横向 16:9 的中文技术流程图。目标是“面试复习用核心示意图”，不是文档截图，也不是文章排版。',
    '',
    `画面标题文案：${title}`,
    `理解用摘要（不要整句排版）：${summary || title}`,
    `候选关键词（选择少量使用）：${concepts.join(' / ') || tags.join(' / ') || title}`,
    '',
    `中心图设计：${pattern}。中心图必须占画面 65% 以上，优先表达“流程/阶段/对比/取舍”，用 3-5 个大节点、箭头、分层结构或天平表达技术关系。`,
    '信息卡：最多放 3 个小卡片，标题可用「结论」「面试抓手」「易错点」。每张卡最多 2 行短句，每行不超过 10 个中文字符。',
    '版式参考：顶部只放大标题，不放副标题；中间是清晰主体图；说明卡放边缘；留白充足，层次像高质量技术课件。',
    '视觉风格：白色或极浅蓝背景，深色大标题，蓝灰主线，少量浅绿/浅橙节点，细边框圆角卡片，柔和阴影，清爽、现代、专业。',
    '文字要求：只使用关键词和短句，中文必须清晰可读；全图文字总量控制在 70 个中文字以内；不要把正文原文排进图里；不要生成小字号密集文字。',
    '严禁内容：大段正文、密集表格、灰色文档块堆叠、网页截图、代码块、二维码、水印、品牌 logo、真实人物、乱码、英文长句。',
    '严禁把这些字段名画进图片：知识库、目录、摘要、标签、内容参考、画面标题文案、候选关键词。',
  ].join('\n');
}

function collectImageStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    if (/^(https?:\/\/|data:image\/)/i.test(value) || /^[A-Za-z0-9+/=]{200,}$/.test(value)) out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectImageStrings(item, out);
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (['image', 'url', 'b64_json', 'base64', 'data'].includes(key) && typeof child === 'string') {
        collectImageStrings(child, out);
      } else {
        collectImageStrings(child, out);
      }
    }
  }
  return out;
}

function dataUrlFromBase64(raw: string): string {
  return raw.startsWith('data:image/') ? raw : `data:image/png;base64,${raw}`;
}

async function downloadImageAsDataUrl(url: string, signal?: AbortSignal): Promise<string> {
  if (url.startsWith('data:image/')) return url;
  if (!/^https?:\/\//i.test(url)) return dataUrlFromBase64(url);
  const resp = await fetch(url, { signal });
  if (!resp.ok) throw new Error(`图解下载失败（${resp.status}）`);
  const contentType = resp.headers.get('content-type')?.split(';')[0]?.trim() || 'image/png';
  const bytes = Buffer.from(await resp.arrayBuffer());
  if (!bytes.length) throw new Error('图解下载结果为空');
  return `data:${contentType};base64,${bytes.toString('base64')}`;
}

export async function generateIllustration(input: EntryInput, ctx: IllustrationContext, signal?: AbortSignal): Promise<GeneratedIllustration> {
  if (!enabled()) throw new Error('AI 图解生成已关闭');
  const config = getAiConfig();
  if (!config.apiKey) throw new AiConfigError();
  const prompt = buildIllustrationPrompt(input, ctx);
  const resp = await fetch(imageEndpoint(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    signal,
    body: JSON.stringify({
      model: imageModel(),
      input: {
        messages: [{
          role: 'user',
          content: [{ text: prompt }],
        }],
      },
      parameters: {
        size: clean(process.env.AI_IMAGE_SIZE) || '1664*928',
        watermark: false,
      },
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Qwen Image 接口返回错误（${resp.status}）：${text.slice(0, 500)}`);
  }
  const payload = await resp.json() as unknown;
  const candidates = collectImageStrings(payload);
  const image = candidates.find((item) => /^(https?:\/\/|data:image\/)/i.test(item)) ?? candidates[0];
  if (!image) throw new Error('Qwen Image 未返回图片');
  const caption = `${ctx.title || input.title} 图解`;
  const dataUrl = await downloadImageAsDataUrl(image, signal);
  const asset = await createDataAsset(dataUrl, caption);
  if (!asset) throw new Error('图解落库失败');
  return { assetId: asset.id, url: asset.url, caption, prompt };
}

export async function appendAiIllustration(
  input: EntryInput,
  ctx: IllustrationContext,
  signal?: AbortSignal,
  emit?: ImageEmitter,
  strict = false,
): Promise<EntryInput> {
  if (!enabled()) {
    if (strict) throw new Error('AI 图解生成已关闭');
    return input;
  }
  try {
    emit?.({ type: 'image-stage', message: `调用 ${imageModel()} 生成图解` });
    const illustration = await generateIllustration(input, ctx, signal);
    emit?.({
      type: 'image',
      url: illustration.url,
      assetId: illustration.assetId,
      caption: illustration.caption,
      prompt: illustration.prompt,
    });
    const doc = inputDoc(input);
    return {
      ...input,
      tags: mergeTags(input.tags, ['图解']),
      doc: [
        ...doc,
        headingBlock('图解'),
        imageBlock(illustration.url),
      ],
    };
  } catch (err) {
    emit?.({ type: 'image-stage', message: `图解生成失败，已跳过：${err instanceof Error ? err.message : String(err)}` });
    if (strict) throw err;
    return input;
  }
}
