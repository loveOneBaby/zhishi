import { AI_ENTRIES } from './ai.js';
import { ALGORITHM_ENTRIES } from './algorithms.js';
import { FRONTEND_ENTRIES } from './frontend.js';
import { FUNDAMENTAL_ENTRIES } from './fundamentals.js';
import { JAVA_ENTRIES } from './java.js';

export type { SeedEntry } from './types.js';

const BASE_ENTRIES = [
  ...FRONTEND_ENTRIES,
  ...JAVA_ENTRIES,
  ...FUNDAMENTAL_ENTRIES,
  ...ALGORITHM_ENTRIES,
];

export const SEED_LIBRARIES = [
  { version: 'base-v1', entries: BASE_ENTRIES },
  {
    version: 'ai-agent-merged-v4',
    entries: AI_ENTRIES,
    overwrite: true,
    removeIds: ['ai5', 'ai6', 'ai7', 'ai8', 'ai9', 'ai10'],
  },
];

export const SEED_ENTRIES = [...BASE_ENTRIES, ...AI_ENTRIES];
