import { createKb, createFolder, createEntry, ensureFolder } from '../db.js';
import { kbQuestionToEntryInput, type GeneratedKbDraft, type GeneratedFolderTreeDraft } from '../ai-generate.js';
import { pathKey } from './utils.js';

export interface GeneratedKnowledgeBaseResult {
  kb: ReturnType<typeof createKb>;
  folders: NonNullable<ReturnType<typeof createFolder>>[];
  entries: ReturnType<typeof createEntry>[];
}

export function createKnowledgeBaseFromDraft(domain: string, draft: GeneratedKbDraft): GeneratedKnowledgeBaseResult {
  const kb = createKb(draft.kbName);
  const folderByPath = new Map<string, NonNullable<ReturnType<typeof createFolder>>>();
  const createdFolders: NonNullable<ReturnType<typeof createFolder>>[] = [];

  const ensurePath = (parts: string[]): string | null => {
    let parentId: string | null = null;
    const current: string[] = [];
    for (const raw of parts) {
      const name = raw.trim();
      if (!name) continue;
      current.push(name);
      const key = pathKey(current);
      const existing = folderByPath.get(key);
      if (existing) {
        parentId = existing.id;
        continue;
      }
      const folder = createFolder({ kbId: kb.id, parentId, name });
      if (!folder) throw new Error('目录创建失败');
      folderByPath.set(key, folder);
      createdFolders.push(folder);
      parentId = folder.id;
    }
    return parentId;
  };

  for (const folder of draft.folders) ensurePath(folder.path);
  const entries = draft.questions.map((question) => {
    const folderId = ensurePath(question.folderPath);
    return createEntry({
      ...kbQuestionToEntryInput(question, domain),
      kbId: kb.id,
      folderId,
    });
  });

  return { kb, folders: createdFolders, entries };
}

export function createFoldersFromDraft(
  kb: ReturnType<typeof createKb>,
  parentId: string | null,
  draft: GeneratedFolderTreeDraft,
): GeneratedKnowledgeBaseResult {
  const folderByPath = new Map<string, NonNullable<ReturnType<typeof createFolder>>>();
  const touchedFolders: NonNullable<ReturnType<typeof createFolder>>[] = [];
  const touchedIds = new Set<string>();

  const ensurePath = (parts: string[]): void => {
    let currentParentId = parentId;
    const current: string[] = [];
    for (const raw of parts) {
      const name = raw.trim();
      if (!name) continue;
      current.push(name);
      const key = pathKey([parentId ?? 'root', ...current]);
      const existing = folderByPath.get(key);
      if (existing) {
        currentParentId = existing.id;
        continue;
      }
      const folder = ensureFolder(kb.id, name, currentParentId);
      folderByPath.set(key, folder);
      if (!touchedIds.has(folder.id)) {
        touchedIds.add(folder.id);
        touchedFolders.push(folder);
      }
      currentParentId = folder.id;
    }
  };

  for (const folder of draft.folders) ensurePath(folder.path);
  return { kb, folders: touchedFolders, entries: [] };
}
