import { AiConfigError, getAiConfig } from './ai-client.js';
import { blocksToMarkdown, type Block } from './blocks.js';
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

function imageBlock(url: string, caption: string): Block {
  return { type: 'image', props: { url, caption }, children: [] };
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

function buildIllustrationPrompt(input: EntryInput, ctx: IllustrationContext): string {
  const doc = inputDoc(input);
  const markdown = blocksToMarkdown(doc).slice(0, 6000);
  return [
    '请生成一张中文技术面试知识点图解，适合放进个人知识库文章中。',
    `主题：${ctx.title || input.title}`,
    `知识库：${ctx.kbName || '技术面试知识库'}`,
    `目录：${ctx.folderPath || '根层级'}`,
    `摘要：${ctx.summary || input.summary || '无'}`,
    `标签：${(ctx.tags || input.tags || []).join('、') || '无'}`,
    '内容参考：',
    markdown || input.summary || input.title,
    '视觉要求：白底或浅色背景，清晰信息图风格，中文标题和模块标签可读；包含核心概念、工作流程、面试考点、易错点四类信息；不要生成真实人物，不要品牌 logo，不要复杂装饰。',
    '构图要求：横向 16:9，中心是主题，四周用箭头/分组块表达关系，像技术博客图解而不是海报。',
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
  const asset = createDataAsset(dataUrl, caption);
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
        imageBlock(illustration.url, illustration.caption),
      ],
    };
  } catch (err) {
    emit?.({ type: 'image-stage', message: `图解生成失败，已跳过：${err instanceof Error ? err.message : String(err)}` });
    if (strict) throw err;
    return input;
  }
}
