import { chatCompletion, type TokenUsage } from './ai-client.js';
import { extractJsonObject } from './ai/parse.js';
import { listEntries, listFolders } from './db.js';
import type { Entry, Folder } from './types.js';

export type AgentEditActionKind =
  | 'create-folder'
  | 'rename-folder'
  | 'create-entry'
  | 'rewrite-entry'
  | 'move-entry'
  | 'note';

export interface AgentEditAction {
  id: string;
  kind: AgentEditActionKind;
  title: string;
  detail: string;
  folderId?: string | null;
  folderRef?: string;
  entryId?: string;
  name?: string;
  topic?: string;
  instruction?: string;
  ref?: string;
}

export interface AgentEditPlan {
  summary: string;
  actions: AgentEditAction[];
}

export interface PlanAgentEditInput {
  kbId: string;
  kbName: string;
  instruction: string;
  folderId?: string | null;
  entryId?: string;
  signal?: AbortSignal;
  onUsage?: (usage: TokenUsage) => void;
}

export interface PlannedAgentEdit {
  raw: string;
  plan: AgentEditPlan;
}

const PLAN_SCHEMA = `{
  "summary": "一句话说明本次会怎样调整",
  "actions": [
    {
      "kind": "create-folder | rename-folder | create-entry | rewrite-entry | move-entry | note",
      "title": "面向用户的一句话动作标题",
      "detail": "为什么这样调整 / 会改什么",
      "folderId": "已有 folderId、null 表示根层级；create-folder 时表示父目录，create-entry/move-entry 时表示目标目录",
      "folderRef": "可选：引用本计划前面 create-folder 的 ref",
      "entryId": "rewrite-entry/move-entry 必填，必须是已有 entryId",
      "name": "create-folder/rename-folder 的目录名，或 create-entry 的知识点主题",
      "topic": "create-entry 生成知识点时的具体题目/主题",
      "instruction": "rewrite-entry 的改写要求",
      "ref": "create-folder 可选：给后续动作引用的新目录短标识，如 cache_folder"
    }
  ]
}`;

const SYSTEM_PROMPT = `你是知识库架构师与技术内容编辑。你会把用户的自然语言想法转换为一组安全、可执行的知识库编辑动作。
只能输出 JSON 对象，不能输出 Markdown 代码围栏或解释。

安全边界：
- 只能规划这些动作:create-folder、rename-folder、create-entry、rewrite-entry、move-entry、note。
- 不允许删除知识库、删除目录、删除知识点、修改登录/鉴权/系统配置。
- folderId/entryId 必须来自用户给出的知识库快照；不要编造真实 id。
- 如果需要先创建目录再把知识点放进去，create-folder 使用 ref，后续动作使用 folderRef 引用这个 ref。
- 不确定或高风险的需求用 note 说明，不要硬改。`;

function text(value: unknown, fallback = '', limit = 1200): string {
  if (typeof value !== 'string') return fallback;
  return value.replace(/\s+/g, ' ').trim().slice(0, limit) || fallback;
}

function textOrNull(value: unknown): string | null | undefined {
  if (value == null) return null;
  const next = text(value, '', 120);
  if (!next) return undefined;
  if (/^(null|root|根层级|知识库根)$/i.test(next)) return null;
  return next;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function folderPath(folders: Folder[], id: string | null): string {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const names: string[] = [];
  const seen = new Set<string>();
  let current = id ? byId.get(id) : undefined;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return names.join(' / ') || '根层级';
}

function contentSize(entry: Entry): number {
  try {
    return JSON.stringify(entry.doc ?? '').length + (entry.summary?.length ?? 0) + (entry.intro?.length ?? 0);
  } catch {
    return entry.summary?.length ?? 0;
  }
}

function readFolderTarget(
  raw: Record<string, unknown>,
  folderIds: Set<string>,
  fieldNames: string[],
): Pick<AgentEditAction, 'folderId' | 'folderRef'> {
  for (const field of fieldNames) {
    const value = textOrNull(raw[field]);
    if (value === undefined) continue;
    if (value === null) return { folderId: null };
    if (folderIds.has(value)) return { folderId: value };
    return { folderRef: value };
  }
  const folderRef = text(raw.folderRef ?? raw.parentFolderRef ?? raw.targetFolderRef, '', 80);
  return folderRef ? { folderRef } : {};
}

function noteFrom(index: number, title: string, detail: string): AgentEditAction {
  return {
    id: `a${index}`,
    kind: 'note',
    title: title || '跳过一项不可执行调整',
    detail: detail || '该动作缺少可验证的目录或知识点引用，已按安全策略跳过。',
  };
}

export function coerceAgentEditPlan(raw: unknown, context: {
  folderIds: Set<string>;
  entryIds: Set<string>;
}): AgentEditPlan {
  const obj = asRecord(raw);
  const source = Array.isArray(obj.actions) ? obj.actions : [];
  const actions = source.flatMap((item, index): AgentEditAction[] => {
    const action = asRecord(item);
    const kind = text(action.kind, 'note', 40) as AgentEditActionKind;
    const title = text(action.title, '', 120);
    const detail = text(action.detail, '', 1600);
    const name = text(action.name, '', 60);
    const topic = text(action.topic, '', 260);
    const instruction = text(action.instruction, '', 1600);
    const ref = text(action.ref ?? action.id, '', 80).replace(/[^\w:-]/g, '_').slice(0, 80);

    if (kind === 'create-folder') {
      if (!name) return [noteFrom(index, title, detail || 'create-folder 缺少目录名')];
      return [{
        id: `a${index}`,
        kind,
        title: title || `创建目录「${name}」`,
        detail,
        name,
        ref: ref || undefined,
        ...readFolderTarget(action, context.folderIds, ['parentFolderId', 'folderId', 'targetFolderId']),
      }];
    }

    if (kind === 'rename-folder') {
      const folder = readFolderTarget(action, context.folderIds, ['folderId', 'targetFolderId']);
      if (!name || !folder.folderId) return [noteFrom(index, title, detail || 'rename-folder 缺少已有目录 id 或新名称')];
      return [{ id: `a${index}`, kind, title: title || `重命名目录为「${name}」`, detail, name, folderId: folder.folderId }];
    }

    if (kind === 'create-entry') {
      const entryTopic = topic || name || title;
      if (!entryTopic) return [noteFrom(index, title, detail || 'create-entry 缺少知识点主题')];
      return [{
        id: `a${index}`,
        kind,
        title: title || `新增知识点「${entryTopic}」`,
        detail,
        name: name || entryTopic,
        topic: entryTopic,
        ...readFolderTarget(action, context.folderIds, ['folderId', 'targetFolderId']),
      }];
    }

    if (kind === 'rewrite-entry') {
      const entryId = text(action.entryId, '', 120);
      if (!entryId || !context.entryIds.has(entryId)) return [noteFrom(index, title, detail || 'rewrite-entry 缺少已有知识点 id')];
      return [{
        id: `a${index}`,
        kind,
        title: title || '改写知识点',
        detail,
        entryId,
        instruction: instruction || detail || title,
      }];
    }

    if (kind === 'move-entry') {
      const entryId = text(action.entryId, '', 120);
      if (!entryId || !context.entryIds.has(entryId)) return [noteFrom(index, title, detail || 'move-entry 缺少已有知识点 id')];
      return [{
        id: `a${index}`,
        kind,
        title: title || '移动知识点',
        detail,
        entryId,
        ...readFolderTarget(action, context.folderIds, ['folderId', 'targetFolderId']),
      }];
    }

    return [noteFrom(index, title || '备注', detail)];
  }).slice(0, 10);

  return {
    summary: text(obj.summary, '已根据用户想法生成调整计划。', 500),
    actions,
  };
}

function parsePlanJson(raw: string, folderIds: Set<string>, entryIds: Set<string>): AgentEditPlan {
  const json = extractJsonObject(raw);
  if (!json) throw new Error('AI 未返回有效调整计划 JSON');
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('AI 调整计划 JSON 解析失败');
  }
  const plan = coerceAgentEditPlan(parsed, { folderIds, entryIds });
  if (!plan.actions.length) throw new Error('AI 未返回可执行的调整动作');
  return plan;
}

async function repairPlanJson(raw: string, signal?: AbortSignal, onUsage?: (usage: TokenUsage) => void): Promise<string> {
  return chatCompletion([
    {
      role: 'system',
      content: '你是 JSON 修复器。只修复用户给出的模型输出为合法 JSON，不补充事实，不解释，不输出 Markdown 代码围栏。',
    },
    {
      role: 'user',
      content: [
        '把下面内容修复成一个合法 JSON 对象。',
        `目标字段结构：${PLAN_SCHEMA}`,
        '要求：只输出 JSON 对象本身。',
        '原始输出：',
        raw.slice(0, 30000),
      ].join('\n'),
    },
  ], { temperature: 0, signal }, onUsage);
}

function buildUserPrompt(input: PlanAgentEditInput, folders: Folder[], entries: Entry[]): string {
  const folderLines = folders.length
    ? folders.map((folder) => `[${folder.id}] ${folderPath(folders, folder.id)}`).join('\n')
    : '(暂无目录，知识点位于根层级)';
  const entryLines = entries.slice(0, 240).map((entry) => {
    const tags = entry.tags?.length ? entry.tags.join('/') : '无标签';
    const summary = (entry.summary ?? '').replace(/\s+/g, ' ').slice(0, 90) || '无摘要';
    return `[${entry.id}] ${folderPath(folders, entry.folderId)} / ${entry.title} | ${summary} | 标签:${tags} | 内容约${contentSize(entry)}字`;
  }).join('\n');
  const currentFolder = input.folderId !== undefined ? folderPath(folders, input.folderId ?? null) : '未指定';
  const currentEntry = input.entryId ? entries.find((entry) => entry.id === input.entryId) : null;

  return `知识库:${input.kbName}
当前目录:${currentFolder}
当前知识点:${currentEntry ? `[${currentEntry.id}] ${currentEntry.title}` : '未指定'}

用户想法:
${input.instruction}

== 已有目录(folderId) ==
${folderLines}

== 已有知识点(entryId) ==
${entryLines || '(暂无知识点)'}

请把用户想法拆成 1-10 个动作，输出 JSON:
${PLAN_SCHEMA}

规划要求:
- 优先满足用户想法；如果用户只是表达方向，你可以合理补齐目录结构和高频知识点。
- 统一粒度：目录是分类桶，不是单个面试题或单个机制；优先少目录、多知识点。只有能长期承载多条知识点的分类才用 create-folder。
- 需要补内容时用 create-entry；topic 要是完整可复习的面试模块或具体机制，例如“线程池核心参数与执行流程”“ThreadLocal 原理、泄漏与使用场景”，不要生成只有一句定义的小题。
- 需要优化已有内容时用 rewrite-entry，并把 instruction 写成明确改写要求，要求补齐“基本概念 + 机制原理 + 对比/场景 + 追问/易错点”。
- 需要整理归类已有知识点时用 move-entry；目标目录可以是已有 folderId，也可以是本计划前面 create-folder 的 folderRef。
- create-folder 的 ref 只用于本次计划内部引用，不是真实数据库 id。
- 只输出 JSON。`;
}

export async function planKnowledgeBaseEdit(input: PlanAgentEditInput): Promise<PlannedAgentEdit> {
  const folders = (await listFolders()).filter((folder) => folder.kbId === input.kbId);
  const entries = (await listEntries()).filter((entry) => entry.kbId === input.kbId);
  const folderIds = new Set(folders.map((folder) => folder.id));
  const entryIds = new Set(entries.map((entry) => entry.id));
  const raw = await chatCompletion([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt(input, folders, entries) },
  ], { signal: input.signal, temperature: 0.25 }, input.onUsage);

  try {
    return { raw, plan: parsePlanJson(raw, folderIds, entryIds) };
  } catch {
    const repaired = await repairPlanJson(raw, input.signal, input.onUsage);
    return { raw: repaired, plan: parsePlanJson(repaired, folderIds, entryIds) };
  }
}
