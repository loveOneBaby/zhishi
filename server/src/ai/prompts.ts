import { blocksToMarkdown } from '../blocks.js';
import { markdownToDocBlocks } from '../doc.js';
import type { AiMessage } from '../ai-client.js';
import type { Entry } from '../types.js';
import type {
  GenerateEntryOptions,
  GenerateFolderTreeOptions,
  GenerateKnowledgeBaseOptions,
  RewriteEntryOptions,
} from './types.js';

function contextText(context: Entry[] = []): string {
  return context.slice(0, 5).map((entry) => `- ${entry.title}：${entry.summary}`).join('\n') || '（暂无相似知识点）';
}

export function buildGenerateMessages(options: GenerateEntryOptions): AiMessage[] {
  const { topic, kbName, folderPath, context = [] } = options;
  const prompt = [
    '请为面试知识库生成一个完整知识点。',
    '输出必须分两段：',
    '1）先输出“生成思路”，用 3-6 条短 bullet 说明你会如何组织知识点、选择哪些面试考点、参考了哪些相似知识点。这里是可公开的生成说明，不要输出隐藏推理链路。',
    '2）然后输出一行 ---JSON---，后面只放一个 JSON 对象，不要 Markdown 代码围栏。',
    'JSON 字段必须是：',
    '{"title":"知识点标题","summary":"一句话摘要","tags":["标签"],"sections":[{"title":"小节标题","content":"正文","bullets":["要点"]}],"interviewPoints":["面试考点"],"commonQuestions":["常见追问"],"pitfalls":["易错点"],"answerTemplate":"可直接用于面试回答的模板"}',
    '要求：中文，结构化，偏工程面试，内容准确克制；sections 至少包含“基本定义/核心原理/应用场景”中的两个；interviewPoints 至少 5 条。',
    `知识库：${kbName}`,
    `当前文件夹：${folderPath || '根层级'}`,
    `主题：${topic}`,
    '相似知识点参考：',
    contextText(context),
  ].join('\n');

  return [
    { role: 'system', content: '你是资深技术面试官和知识库编辑，擅长把主题整理成可复习、可追问的结构化知识点。可以输出可公开的生成说明，但不要泄露隐藏推理链路。' },
    { role: 'user', content: prompt },
  ];
}

export function buildGenerateKnowledgeBaseMessages(options: GenerateKnowledgeBaseOptions): AiMessage[] {
  const { domain } = options;
  const questionCount = Math.min(24, Math.max(8, Math.floor(options.questionCount ?? 14)));
  const prompt = [
    `请为「${domain}」创建一套工程面试知识库。`,
    '输出必须分两段：',
    '1）先输出“建库思路”，用 4-8 条短 bullet 说明目录如何划分、哪些问题是高频、回答如何组织。这里是可公开说明，不要输出隐藏推理链路。',
    '2）然后输出一行 ---JSON---，后面只放一个 JSON 对象，不要 Markdown 代码围栏。',
    'JSON 字段必须是：',
    '{"kbName":"知识库名称","description":"一句话说明","folders":[{"path":["一级目录","二级目录"]}],"questions":[{"folderPath":["一级目录","二级目录"],"title":"知识点标题","question":"面试题","summary":"一句话摘要","tags":["标签"],"shortAnswer":"30-80字直接回答","answer":"展开回答","keyPoints":["关键点"],"followUps":["常见追问"],"pitfalls":["易错点"],"answerTemplate":"可直接复述的回答模板"}]}',
    `要求：中文；questions 生成 ${questionCount} 道高频题；目录 4-7 个、最多二级；每道题必须是 Q&A 形式；覆盖定义、原理、实现、场景、性能、排障、对比、项目表达；避免空话和营销话术；标题适合作为知识点列表展示，不要全部以“什么是”开头。`,
  ].join('\n');

  return [
    { role: 'system', content: '你是资深技术面试官和知识库架构师，擅长把一个技术领域整理成目录清晰、问题高频、回答可复述的面试知识库。可以输出可公开的建库说明，但不要泄露隐藏推理链路。' },
    { role: 'user', content: prompt },
  ];
}

export function buildGenerateFolderTreeMessages(options: GenerateFolderTreeOptions): AiMessage[] {
  const { domain, kbName, targetPath, existingFolders = [] } = options;
  const folderCount = Math.min(36, Math.max(8, Math.floor(options.folderCount ?? 18)));
  const existing = existingFolders.slice(0, 80).map((folder) => `- ${folder}`).join('\n') || '（暂无）';
  const prompt = [
    `请为「${kbName}」知识库初始化「${domain}」相关文件目录。`,
    '只生成目录，不要生成知识点、题目、正文或答案。',
    '输出必须分两段：',
    '1）先输出“目录规划”，用 4-7 条短 bullet 说明目录分层逻辑、覆盖哪些面试复习维度。这里是可公开说明，不要输出隐藏推理链路。',
    '2）然后输出一行 ---JSON---，后面只放一个 JSON 对象，不要 Markdown 代码围栏。',
    'JSON 字段必须是：',
    '{"title":"目录方案名称","description":"一句话说明","folders":[{"path":["一级目录","二级目录"]}]}',
    `要求：中文；生成约 ${folderCount} 个目录路径；最多 3 层；目录名短、稳定、适合长期维护；覆盖基础概念、核心原理、架构组件、工程实践、性能优化、故障排查、对比选型、项目表达；避免与已有目录重复；path 是相对目标位置的路径。`,
    `目标位置：${targetPath || '知识库根层级'}`,
    '已有目录：',
    existing,
  ].join('\n');

  return [
    { role: 'system', content: '你是资深技术面试知识库架构师，擅长为一个技术领域设计清晰、可扩展、便于复习和检索的文件目录。可以输出可公开的目录规划说明，但不要泄露隐藏推理链路。' },
    { role: 'user', content: prompt },
  ];
}

export function buildRewriteMessages(options: RewriteEntryOptions): AiMessage[] {
  const { entry } = options;
  const currentMarkdown = blocksToMarkdown(entry.doc);
  const prompt = [
    '请改写下面这个面试知识点，让它更适合复习和面试表达。',
    '输出必须分两段：',
    '1）先输出“改写思路”，用 3-6 条短 bullet 说明你会补强哪些知识、删减哪些冗余、如何组织面试考点。这里是可公开说明，不要输出隐藏推理链路。',
    '2）然后输出一行 ---JSON---，后面只放一个 JSON 对象，不要 Markdown 代码围栏。',
    'JSON 字段必须是：',
    '{"title":"知识点标题","summary":"一句话摘要","tags":["标签"],"sections":[{"title":"小节标题","content":"正文","bullets":["要点"]}],"interviewPoints":["面试考点"],"commonQuestions":["常见追问"],"pitfalls":["易错点"],"answerTemplate":"可直接用于面试回答的模板"}',
    '要求：中文，结构化，偏工程面试，内容准确克制；保留原知识点主题，不要凭空扩展到无关领域；sections 至少 3 个，interviewPoints 至少 5 条。',
    `原标题：${entry.title}`,
    `原摘要：${entry.summary || '（无）'}`,
    `原标签：${entry.tags.join('、') || '（无）'}`,
    '原正文：',
    currentMarkdown || blocksToMarkdown(markdownToDocBlocks(entry.intro)),
  ].join('\n');

  return [
    { role: 'system', content: '你是资深技术面试官和知识库编辑，擅长把已有笔记改写成结构清楚、面试可用的知识点。可以输出可公开的改写说明，但不要泄露隐藏推理链路。' },
    { role: 'user', content: prompt },
  ];
}
