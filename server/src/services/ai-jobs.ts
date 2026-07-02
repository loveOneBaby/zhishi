// Barrel：重导出 ai-jobs-core 的全部公开 API；并在 core 初始化完成后侧效导入各 runner，
// 触发其调用 registerJobRunner 注册到 core 的 jobRunners 表。
// 必须先 `export *` 加载 core（让 const jobRunners 越过 TDZ），再 import runner，否则循环依赖下注册会命中 TDZ。
export * from './ai-jobs-core.js';
import './ai-jobs-runners/analyze.js';
import './ai-jobs-runners/kb.js';
import './ai-jobs-runners/agent-edit.js';
import './ai-jobs-runners/folder.js';
