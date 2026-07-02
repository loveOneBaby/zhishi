import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const MAX_STYLE_PROMPT_CHARS = 12000;

export const DEFAULT_AI_GENERATION_STYLE_PROMPT = [
  '生成模板如下',
  '1. 简要回答 — 口语化',
  '第一人称,像坐在面试官对面直接念出来。自然衔接、有"我一般这么答""先说…再说…"这种口语连接词,不加粗、不堆术语,流畅可读。',
  '',
  '2. 回答思路步骤图 — ASCII 流程图',
  '用代码块画决策/处理链路,一眼能看全流程和分支。',
  '',
  '3. 详解 — 书面语',
  '基于简要回答直接展开,不解释"为什么这么答"。用 ### 子标题分层(飞书大纲可见),书面语、有结构但不堆 1-2-3-5-6 编号,关键术语加粗。',
  '',
  '4. 可能追问 — 简单 Q/A',
  'Q: 一行问题,A: 一段回答,纯文本,不堆表格/引用/项目符号。',
].join('\n');

export interface AiGenerationStyleConfig {
  prompt: string;
  defaultPrompt: string;
  source: 'default' | 'env' | 'user';
  updatedAt?: number;
}

interface StoredAiStyleConfig {
  prompt?: unknown;
  updatedAt?: unknown;
}

function cleanPrompt(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, MAX_STYLE_PROMPT_CHARS);
}

function dataSiblingConfigPath(filename: string): string {
  const dbConfigPath = process.env.IK_DB_CONFIG_PATH;
  if (dbConfigPath) return path.join(path.dirname(dbConfigPath), filename);
  return path.join(DATA_DIR, filename);
}

export function aiStyleConfigFilePath(): string {
  return process.env.IK_AI_STYLE_CONFIG_PATH || dataSiblingConfigPath('ai-style-config.json');
}

function readStoredConfig(): StoredAiStyleConfig | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(aiStyleConfigFilePath(), 'utf8')) as StoredAiStyleConfig;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredConfig(cfg: StoredAiStyleConfig | null): void {
  const file = aiStyleConfigFilePath();
  if (!cfg || !cleanPrompt(cfg.prompt)) {
    try { fs.unlinkSync(file); } catch { /* 不存在则忽略 */ }
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

export function getAiGenerationStyleConfig(): AiGenerationStyleConfig {
  const envPrompt = cleanPrompt(process.env.AI_GENERATION_STYLE_PROMPT);
  if (envPrompt) {
    return {
      prompt: envPrompt,
      defaultPrompt: DEFAULT_AI_GENERATION_STYLE_PROMPT,
      source: 'env',
    };
  }

  const stored = readStoredConfig();
  const storedPrompt = cleanPrompt(stored?.prompt);
  if (storedPrompt) {
    return {
      prompt: storedPrompt,
      defaultPrompt: DEFAULT_AI_GENERATION_STYLE_PROMPT,
      source: 'user',
      updatedAt: typeof stored?.updatedAt === 'number' ? stored.updatedAt : undefined,
    };
  }

  return {
    prompt: DEFAULT_AI_GENERATION_STYLE_PROMPT,
    defaultPrompt: DEFAULT_AI_GENERATION_STYLE_PROMPT,
    source: 'default',
  };
}

export function getAiGenerationStylePrompt(): string {
  return getAiGenerationStyleConfig().prompt;
}

export function setAiGenerationStyleConfig(input: { prompt?: unknown; clear?: boolean }): AiGenerationStyleConfig {
  if (input.clear) {
    writeStoredConfig(null);
    return getAiGenerationStyleConfig();
  }

  const prompt = cleanPrompt(input.prompt);
  if (!prompt) throw new Error('AI 生成风格提示词不能为空');
  writeStoredConfig({ prompt, updatedAt: Date.now() });
  return getAiGenerationStyleConfig();
}
