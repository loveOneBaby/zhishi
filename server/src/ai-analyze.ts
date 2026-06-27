import { chatCompletion, type TokenUsage } from './ai-client.js';
import { getKb, getEntry, listFolders, listEntries } from './db.js';
import { blocksToMarkdown } from './blocks.js';

export type KbSuggestionKind = 'create-folder' | 'rename-folder' | 'create-entry' | 'rewrite-entry' | 'refine-entry' | 'note';

export interface KbSuggestion {
  id: string;
  kind: KbSuggestionKind;
  title: string;
  detail: string;
  folderId?: string | null;   // create-folder 的父目录 / rename-folder 目标 / create-entry 目标目录
  entryId?: string;           // rewrite-entry / refine-entry 目标
  name?: string;              // create-folder 名称 / rename-folder 新名 / create-entry 主题
}

export interface KbAnalysis {
  overview: string;
  scores: { structure: number; coverage: number; depth: number };
  scoreLabels?: [string, string, string];
  suggestions: KbSuggestion[];
}

interface FolderLike { id: string; name: string; parentId: string | null; kbId: string }
interface EntryLike { id: string; title: string; summary?: string; tags?: string[]; folderId: string | null; kbId: string; intro?: string }

function folderPath(folders: FolderLike[], id: string | null): string {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const parts: string[] = [];
  let cur = id;
  let guard = 0;
  while (cur && guard++ < 40) {
    const f = byId.get(cur);
    if (!f) break;
    parts.unshift(f.name);
    cur = f.parentId;
  }
  return parts.join(' / ') || '根层级';
}

function contentSize(entry: EntryLike & { doc?: unknown }): number {
  try {
    return JSON.stringify(entry.doc ?? '').length + (entry.summary?.length ?? 0) + (entry.intro?.length ?? 0);
  } catch {
    return entry.summary?.length ?? 0;
  }
}

function clampScore(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 60;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI 未返回有效 JSON');
  return JSON.parse(text.slice(start, end + 1));
}

const SYSTEM = `你是资深的知识库架构师与面试内容主编。会拿到一个知识库的目录结构和知识点清单(含 id)。
请审视:目录是否合理(命名/层级/分组)、知识点覆盖是否完整、是否有重复或过薄的内容、是否缺少高频必备知识点。
只输出一个 JSON 对象,不要任何解释或 markdown 代码块。`;

function buildUserPrompt(kbName: string, folders: FolderLike[], entries: EntryLike[]): string {
  const folderLines = folders.length
    ? folders.map((f) => `[${f.id}] ${folderPath(folders, f.id)}`).join('\n')
    : '(暂无文件夹,知识点都在根层级)';
  const entryLines = entries.slice(0, 220).map((e) => {
    const path = folderPath(folders, e.folderId);
    const tags = (e.tags ?? []).join('/') || '无标签';
    const size = contentSize(e as EntryLike & { doc?: unknown });
    const summary = (e.summary ?? '').replace(/\s+/g, ' ').slice(0, 60) || '无摘要';
    return `[${e.id}] ${path} / ${e.title} | ${summary} | 标签:${tags} | 内容约${size}字`;
  }).join('\n');

  return `知识库名称:${kbName}
共 ${folders.length} 个文件夹、${entries.length} 条知识点。

== 目录(folderId) ==
${folderLines}

== 知识点(entryId) ==
${entryLines || '(暂无知识点)'}

请输出如下结构的 JSON:
{
  "overview": "2-4 句总体评价,指出当前知识库最突出的优点和问题",
  "scores": { "structure": 0-100 目录结构合理度, "coverage": 0-100 知识点覆盖完整度, "depth": 0-100 内容深度 },
  "suggestions": [
    {
      "kind": "create-folder | rename-folder | create-entry | rewrite-entry | note",
      "title": "一句话建议(简短)",
      "detail": "具体理由,要引用上面的真实目录/知识点名称",
      "folderId": "相关文件夹的真实 id;create-folder 填父目录 id(可为 null=根);rename-folder 填要改名的目录 id;create-entry 填目标目录 id(可为 null)",
      "entryId": "rewrite-entry 必填,要改写的知识点真实 id",
      "name": "create-folder 的新文件夹名 / rename-folder 的新名 / create-entry 的知识点主题"
    }
  ]
}
要求:
- 给 8-14 条建议,优先级从高到低排列。
- folderId/entryId 必须是上面列出的真实 id,不要编造;不涉及具体目标的用 note。
- create-entry 重点补全该领域高频但当前缺失的面试知识点;rewrite-entry 针对内容过薄(字数少)或质量差的知识点。
- 只输出 JSON。`;
}

export async function analyzeKnowledgeBase(kbId: string, signal?: AbortSignal, onUsage?: (usage: TokenUsage) => void): Promise<KbAnalysis> {
  const kb = await getKb(kbId);
  if (!kb) throw new Error('知识库不存在');
  const folders = ((await listFolders()) as FolderLike[]).filter((f) => f.kbId === kbId);
  const entries = ((await listEntries()) as unknown as EntryLike[]).filter((e) => e.kbId === kbId);

  const raw = await chatCompletion(
    [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: buildUserPrompt(kb.name, folders, entries) },
    ],
    { signal, temperature: 0.3 },
    onUsage,
  );

  const parsed = extractJson(raw) as Record<string, unknown>;
  const folderIds = new Set(folders.map((f) => f.id));
  const entryIds = new Set(entries.map((e) => e.id));
  const rawScores = (parsed.scores ?? {}) as Record<string, unknown>;

  const suggestions: KbSuggestion[] = Array.isArray(parsed.suggestions)
    ? parsed.suggestions.flatMap((item, index): KbSuggestion[] => {
        const s = (item ?? {}) as Record<string, unknown>;
        const kind = String(s.kind ?? 'note') as KbSuggestionKind;
        const title = String(s.title ?? '').trim();
        const detail = String(s.detail ?? '').trim();
        if (!title) return [];
        const folderRaw = s.folderId == null ? null : String(s.folderId).trim();
        const folderId = folderRaw && folderIds.has(folderRaw) ? folderRaw : null;
        const entryId = s.entryId != null && entryIds.has(String(s.entryId)) ? String(s.entryId) : undefined;
        const name = s.name != null ? String(s.name).trim() : undefined;

        // 校验:引用了不存在 id 的可执行建议降级为 note,避免误操作
        if (kind === 'rewrite-entry' && !entryId) return [{ id: `s${index}`, kind: 'note', title, detail }];
        if (kind === 'rename-folder' && !folderId) return [{ id: `s${index}`, kind: 'note', title, detail }];
        if ((kind === 'create-folder' || kind === 'create-entry') && !name) return [{ id: `s${index}`, kind: 'note', title, detail }];

        return [{ id: `s${index}`, kind, title, detail, folderId, entryId, name }];
      })
    : [];

  return {
    overview: String(parsed.overview ?? '').trim() || '已完成分析。',
    scores: {
      structure: clampScore(rawScores.structure),
      coverage: clampScore(rawScores.coverage),
      depth: clampScore(rawScores.depth),
    },
    suggestions,
  };
}

const ENTRY_SYSTEM = `你是资深的面试内容主编与技术编辑。会拿到一个知识点的标题、摘要、标签和正文(markdown)。
请从三个维度审视:页面结构(标题层级/分节是否清晰合理)、内容质量(是否完整、准确、覆盖面试高频考点、有无明显遗漏或错误)、排版规范(列表/代码块/表格/图片/重点标注是否得当、有无大段不分段)。
只输出一个 JSON 对象,不要任何解释或 markdown 代码块。`;

export async function analyzeEntry(entryId: string, signal?: AbortSignal, onUsage?: (usage: TokenUsage) => void): Promise<KbAnalysis> {
  const entry = await getEntry(entryId);
  if (!entry) throw new Error('知识点不存在');
  const md = blocksToMarkdown((entry as { doc?: unknown }).doc).slice(0, 8000) || '(正文为空)';
  const tags = (entry.tags ?? []).join('/') || '无标签';

  const user = `知识点标题:${entry.title}
摘要:${entry.summary || '无'}
标签:${tags}

== 正文(markdown) ==
${md}

请输出如下结构的 JSON:
{
  "overview": "2-4 句总体评价,指出这个知识点最突出的优点和最该改进的问题",
  "scores": { "structure": 0-100 页面结构合理度, "coverage": 0-100 内容质量/完整度, "depth": 0-100 排版规范度 },
  "suggestions": [
    {
      "kind": "refine-entry | rewrite-entry",
      "title": "一句话建议(简短)",
      "detail": "具体说明:哪里结构乱/内容缺/排版差,以及怎么改(这段会作为改写指令)"
    }
  ]
}
要求:
- 给 4-8 条建议,优先级从高到低。
- 每条建议都要可一键应用:具体的改进点(补充某部分内容、调整结构、修正排版)用 kind=refine-entry;如果整体值得推倒重写,用 kind=rewrite-entry。
- detail 要写成明确的改写指令,应用时会据此让 AI 改写本知识点。
- 只输出 JSON。`;

  const raw = await chatCompletion(
    [
      { role: 'system', content: ENTRY_SYSTEM },
      { role: 'user', content: user },
    ],
    { signal, temperature: 0.3 },
    onUsage,
  );

  const parsed = extractJson(raw) as Record<string, unknown>;
  const rawScores = (parsed.scores ?? {}) as Record<string, unknown>;
  const suggestions: KbSuggestion[] = Array.isArray(parsed.suggestions)
    ? parsed.suggestions.flatMap((item, index): KbSuggestion[] => {
        const s = (item ?? {}) as Record<string, unknown>;
        const kind = String(s.kind ?? 'refine-entry') as KbSuggestionKind;
        const title = String(s.title ?? '').trim();
        const detail = String(s.detail ?? '').trim();
        if (!title) return [];
        if (kind === 'rewrite-entry') {
          return [{ id: `s${index}`, kind: 'rewrite-entry', title, detail, entryId: entry.id }];
        }
        // 其余一律作为可应用的「按建议改写」,detail 作为改写指令
        return [{ id: `s${index}`, kind: 'refine-entry', title, detail, entryId: entry.id }];
      })
    : [];

  return {
    overview: String(parsed.overview ?? '').trim() || '已完成分析。',
    scores: {
      structure: clampScore(rawScores.structure),
      coverage: clampScore(rawScores.coverage),
      depth: clampScore(rawScores.depth),
    },
    scoreLabels: ['页面结构', '内容质量', '排版规范'],
    suggestions,
  };
}
