import { createKb, createFolder, createEntry, ensureFolder } from '../db.js';
import type { EntryInput } from '../db.js';
import { kbQuestionToEntryInput, type GeneratedKbDraft, type GeneratedFolderTreeDraft } from '../ai-generate.js';
import { pathKey } from './utils.js';

export interface GeneratedKnowledgeBaseResult {
  kb: ReturnType<typeof createKb>;
  folders: NonNullable<ReturnType<typeof createFolder>>[];
  entries: ReturnType<typeof createEntry>[];
}

export interface GeneratedKnowledgeBaseWriter extends GeneratedKnowledgeBaseResult {
  ensurePath: (parts: string[]) => string | null;
  addEntry: (input: EntryInput, folderPath: string[]) => ReturnType<typeof createEntry>;
}

export function createKnowledgeBaseWriterFromDraft(draft: GeneratedKbDraft): GeneratedKnowledgeBaseWriter {
  const kb = createKb(draft.kbName);
  const folderByPath = new Map<string, NonNullable<ReturnType<typeof createFolder>>>();
  const createdFolders: NonNullable<ReturnType<typeof createFolder>>[] = [];
  const createdEntries: ReturnType<typeof createEntry>[] = [];

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

  const addEntry = (input: EntryInput, folderPath: string[]): ReturnType<typeof createEntry> => {
    const folderId = ensurePath(folderPath);
    const entry = createEntry({
      ...input,
      kbId: kb.id,
      folderId,
    });
    createdEntries.push(entry);
    return entry;
  };

  return { kb, folders: createdFolders, entries: createdEntries, ensurePath, addEntry };
}

export function createKnowledgeBaseWriterFromExisting(result: GeneratedKnowledgeBaseResult): GeneratedKnowledgeBaseWriter {
  const kb = result.kb;
  const createdFolders = [...result.folders];
  const createdEntries = [...result.entries];
  const folderByPath = new Map<string, NonNullable<ReturnType<typeof createFolder>>>();
  const folderById = new Map(createdFolders.map((folder) => [folder.id, folder]));

  const pathOf = (folder: NonNullable<ReturnType<typeof createFolder>>): string[] => {
    const names: string[] = [];
    let cursor: typeof folder | undefined = folder;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      names.unshift(cursor.name);
      cursor = cursor.parentId ? folderById.get(cursor.parentId) : undefined;
    }
    return names;
  };

  for (const folder of createdFolders) {
    folderByPath.set(pathKey(pathOf(folder)), folder);
  }

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
      folderById.set(folder.id, folder);
      createdFolders.push(folder);
      parentId = folder.id;
    }
    return parentId;
  };

  const addEntry = (input: EntryInput, folderPath: string[]): ReturnType<typeof createEntry> => {
    const folderId = ensurePath(folderPath);
    const entry = createEntry({
      ...input,
      kbId: kb.id,
      folderId,
    });
    createdEntries.push(entry);
    return entry;
  };

  return { kb, folders: createdFolders, entries: createdEntries, ensurePath, addEntry };
}

export function createKnowledgeBaseFromDraft(domain: string, draft: GeneratedKbDraft): GeneratedKnowledgeBaseResult {
  const writer = createKnowledgeBaseWriterFromDraft(draft);
  for (const question of draft.questions) {
    writer.addEntry(kbQuestionToEntryInput(question, domain), question.folderPath);
  }
  return { kb: writer.kb, folders: writer.folders, entries: writer.entries };
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
