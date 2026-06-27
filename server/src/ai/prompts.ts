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
    '版式目标：面向面试前快速复习，不要写成长文章；必须“答案优先、对比清晰、追问可背”。',
    'summary 必须是一句话结论，30-60 字，直接回答题目。',
    'answerTemplate 必须是 30 秒面试回答，先结论、再 2-3 个关键原因、最后一句工程边界，不要超过 180 字。',
    'sections 建议 3-5 个，优先使用这些标题：核心流程、阶段对比、展开理解、工程场景、边界与取舍。每个 section.content 控制在 1-3 句；bullets 每条是短句。',
    '如果主题包含流程、阶段、对比或选型，必须用一个 section 做“阶段对比”或“核心流程”，bullets 写成“阶段/方案：输入/时机/输出/优点/局限”的短句，便于扫读。',
    'commonQuestions 必须是“问题？答题抓手：一句话提示”的格式，至少 3 条。',
    '要求：中文，结构化，偏工程面试，内容准确克制；interviewPoints 至少 5 条；避免大段解释性铺垫。',
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
  const questionCount = Math.min(36, Math.max(12, Math.floor(options.questionCount ?? 18)));
  const prompt = [
    `请为「${domain}」创建一套工程面试知识库。`,
    '参考结构：先有 containers 目录树，再用 entries[].containerSourceId 把每个知识点挂到明确目录。这个结构类似 kb-package-2，但本次只输出生成草稿，不要加 version/package/assets。',
    '输出必须分两段：',
    '1）先输出“建库思路”，用 4-8 条短 bullet 说明一级目录、二级目录、每类知识点覆盖哪些高频面试场景。这里是可公开说明，不要输出隐藏推理链路。',
    '2）然后输出一行 ---JSON---，后面只放一个 JSON 对象，不要 Markdown 代码围栏。',
    'JSON 字段必须是：',
    '{"kbName":"知识库名称","description":"一句话说明","containers":[{"sourceId":"folder_unique_id","kind":"folder","parentSourceId":null,"name":"一级目录","sort":1},{"sourceId":"folder_child_id","kind":"folder","parentSourceId":"folder_unique_id","name":"二级目录","sort":1}],"entries":[{"sourceId":"entry_unique_id","containerSourceId":"folder_child_id","title":"知识点标题","question":"面试题","summary":"一句话摘要","tags":["标签"],"shortAnswer":"30-80字直接回答","answer":"展开回答","keyPoints":["关键点"],"followUps":["常见追问"],"pitfalls":["易错点"],"answerTemplate":"可直接复述的回答模板"}]}',
    `结构要求：中文；entries 生成 ${questionCount} 条高频知识点；containers 生成 5-8 个一级目录，核心一级目录至少 1 个二级目录，最多二级；核心一级目录至少挂 2 条 entries，补充/对比类目录可 1 条；所有 entries.containerSourceId 必须指向已有 container.sourceId；sourceId 用英文小写、数字、下划线，稳定可读。`,
    '目录组织建议：按知识体系拆，不按“定义/原理/场景/追问”这种通用模板拆。优先使用：基础概念、核心原理、关键机制、工程实践、性能优化、故障排查、对比选型、项目表达，也可以按该领域更自然的模块命名。',
    '内容要求：每个知识点必须是可面试复述的 Q&A；shortAnswer 是一句话结论；answerTemplate 是 30 秒面试回答；followUps 必须写成“问题？答题抓手：一句话提示”；覆盖定义、原理、实现、场景、性能、排障、对比、项目表达；避免空话和营销话术；标题适合作为知识点列表展示，不要全部以“什么是”开头。',
    '质量要求：同一目录下知识点围绕同一主题递进；不要把大量知识点都挂到根目录或同一个目录；不要生成空目录，除非它是父目录。',
  ].join('\n');

  return [
    { role: 'system', content: '你是资深技术面试官和知识库架构师，擅长把一个技术领域整理成目录清晰、问题高频、回答可复述的面试知识库。可以输出可公开的建库说明，但不要泄露隐藏推理链路。' },
    { role: 'user', content: prompt },
  ];
}

export function buildPlanKnowledgeBaseMessages(options: GenerateKnowledgeBaseOptions): AiMessage[] {
  const { domain } = options;
  const questionCount = Math.min(60, Math.max(12, Math.floor(options.questionCount ?? 24)));
  const prompt = [
    `请为「${domain}」规划一套工程面试知识库骨架。`,
    '这是一个多步 Agent 任务的第 1 步：只规划目录和知识点清单，不要生成长正文，不要输出完整答案。',
    '输出必须分两段：',
    '1）先输出“建库规划”，用 4-8 条短 bullet 说明目录划分、知识点分布和覆盖面。',
    '2）然后输出一行 ---JSON---，后面只放一个 JSON 对象，不要 Markdown 代码围栏。',
    'JSON 字段必须是：',
    '{"kbName":"知识库名称","description":"一句话说明","containers":[{"sourceId":"folder_unique_id","kind":"folder","parentSourceId":null,"name":"一级目录","sort":1},{"sourceId":"folder_child_id","kind":"folder","parentSourceId":"folder_unique_id","name":"二级目录","sort":1}],"entries":[{"sourceId":"entry_unique_id","containerSourceId":"folder_child_id","title":"知识点标题","question":"面试题","summary":"一句话摘要","tags":["标签"]}]}',
    `结构要求：entries 生成 ${questionCount} 条；containers 生成 5-10 个一级目录，核心一级目录至少 1 个二级目录，最多二级；核心一级目录至少挂 2 条 entries；所有 entries.containerSourceId 必须指向已有 container.sourceId。`,
    '目录必须按知识体系拆分，不按“定义/原理/场景/追问”这种通用模板拆。目录名短、稳定、适合长期维护。',
    'entry 只给规划字段：title/question/summary/tags，不要输出 answer/keyPoints/followUps/pitfalls/doc，后续步骤会逐条生成正文。',
  ].join('\n');

  return [
    { role: 'system', content: '你是面试知识库架构 Agent。你的任务是先规划清晰、可扩展、可逐步写入的知识树骨架，不要一次性写长正文。' },
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
  const { entry, instruction } = options;
  const currentMarkdown = blocksToMarkdown(entry.doc);
  const focusLines = instruction && instruction.trim()
    ? ['本次改写必须优先落实以下改进建议（在保留主题的前提下重点补强）：', instruction.trim(), '']
    : [];
  const prompt = [
    '请改写下面这个面试知识点，让它更适合复习和面试表达。',
    ...focusLines,
    '输出必须分两段：',
    '1）先输出“改写思路”，用 3-6 条短 bullet 说明你会补强哪些知识、删减哪些冗余、如何组织面试考点。这里是可公开说明，不要输出隐藏推理链路。',
    '2）然后输出一行 ---JSON---，后面只放一个 JSON 对象，不要 Markdown 代码围栏。',
    'JSON 字段必须是：',
    '{"title":"知识点标题","summary":"一句话摘要","tags":["标签"],"sections":[{"title":"小节标题","content":"正文","bullets":["要点"]}],"interviewPoints":["面试考点"],"commonQuestions":["常见追问"],"pitfalls":["易错点"],"answerTemplate":"可直接用于面试回答的模板"}',
    '版式目标：面向面试前快速复习，不要写成长文章；必须“答案优先、对比清晰、追问可背”。',
    'summary 必须是一句话结论，30-60 字，直接回答题目。',
    'answerTemplate 必须是 30 秒面试回答，先结论、再 2-3 个关键原因、最后一句工程边界，不要超过 180 字。',
    'sections 建议 3-5 个，优先使用这些标题：核心流程、阶段对比、展开理解、工程场景、边界与取舍。每个 section.content 控制在 1-3 句；bullets 每条是短句。',
    '如果主题包含流程、阶段、对比或选型，必须用一个 section 做“阶段对比”或“核心流程”，bullets 写成“阶段/方案：输入/时机/输出/优点/局限”的短句，便于扫读。',
    'commonQuestions 必须是“问题？答题抓手：一句话提示”的格式，至少 3 条。',
    '要求：中文，结构化，偏工程面试，内容准确克制；保留原知识点主题，不要凭空扩展到无关领域；interviewPoints 至少 5 条；避免大段解释性铺垫。',
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
