import { createKb, createFolder, createEntry, ensureFolder } from '../db.js';
import type { EntryInput } from '../db.js';
import { kbQuestionToEntryInput, type GeneratedKbDraft, type GeneratedFolderTreeDraft } from '../ai-generate.js';
import { pathKey } from './utils.js';
import type { KnowledgeBase, Folder, Entry } from '../types.js';

export interface GeneratedKnowledgeBaseResult {
  kb: KnowledgeBase;
  folders: Folder[];
  entries: Entry[];
}

export interface GeneratedKnowledgeBaseWriter extends GeneratedKnowledgeBaseResult {
  ensurePath: (parts: string[]) => Promise<string | null>;
  addEntry: (input: EntryInput, folderPath: string[]) => Promise<Entry>;
}

export async function createKnowledgeBaseWriterFromDraft(draft: GeneratedKbDraft): Promise<GeneratedKnowledgeBaseWriter> {
  const kb = await createKb(draft.kbName);
  const folderByPath = new Map<string, Folder>();
  const createdFolders: Folder[] = [];
  const createdEntries: Entry[] = [];

  const ensurePath = async (parts: string[]): Promise<string | null> => {
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
      const folder = await createFolder({ kbId: kb.id, parentId, name });
      if (!folder) throw new Error('目录创建失败');
      folderByPath.set(key, folder);
      createdFolders.push(folder);
      parentId = folder.id;
    }
    return parentId;
  };

  for (const folder of draft.folders) await ensurePath(folder.path);

  const addEntry = async (input: EntryInput, folderPath: string[]): Promise<Entry> => {
    const folderId = await ensurePath(folderPath);
    const entry = await createEntry({
      ...input,
      kbId: kb.id,
      folderId,
    });
    createdEntries.push(entry);
    return entry;
  };

  return { kb, folders: createdFolders, entries: createdEntries, ensurePath, addEntry };
}

export async function createKnowledgeBaseWriterFromExisting(result: GeneratedKnowledgeBaseResult): Promise<GeneratedKnowledgeBaseWriter> {
  const kb = result.kb;
  const createdFolders = [...result.folders];
  const createdEntries = [...result.entries];
  const folderByPath = new Map<string, Folder>();
  const folderById = new Map(createdFolders.map((folder) => [folder.id, folder]));

  const pathOf = (folder: Folder): string[] => {
    const names: string[] = [];
    let cursor: Folder | undefined = folder;
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

  const ensurePath = async (parts: string[]): Promise<string | null> => {
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
      const folder = await createFolder({ kbId: kb.id, parentId, name });
      if (!folder) throw new Error('目录创建失败');
      folderByPath.set(key, folder);
      folderById.set(folder.id, folder);
      createdFolders.push(folder);
      parentId = folder.id;
    }
    return parentId;
  };

  const addEntry = async (input: EntryInput, folderPath: string[]): Promise<Entry> => {
    const folderId = await ensurePath(folderPath);
    const entry = await createEntry({
      ...input,
      kbId: kb.id,
      folderId,
    });
    createdEntries.push(entry);
    return entry;
  };

  return { kb, folders: createdFolders, entries: createdEntries, ensurePath, addEntry };
}

export async function createKnowledgeBaseFromDraft(domain: string, draft: GeneratedKbDraft): Promise<GeneratedKnowledgeBaseResult> {
  const writer = await createKnowledgeBaseWriterFromDraft(draft);
  for (const question of draft.questions) {
    await writer.addEntry(kbQuestionToEntryInput(question, domain), question.folderPath);
  }
  return { kb: writer.kb, folders: writer.folders, entries: writer.entries };
}

export async function createFoldersFromDraft(
  kb: KnowledgeBase,
  parentId: string | null,
  draft: GeneratedFolderTreeDraft,
): Promise<GeneratedKnowledgeBaseResult> {
  const folderByPath = new Map<string, Folder>();
  const touchedFolders: Folder[] = [];
  const touchedIds = new Set<string>();

  const ensurePath = async (parts: string[]): Promise<void> => {
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
      const folder = await ensureFolder(kb.id, name, currentParentId);
      folderByPath.set(key, folder);
      if (!touchedIds.has(folder.id)) {
        touchedIds.add(folder.id);
        touchedFolders.push(folder);
      }
      currentParentId = folder.id;
    }
  };

  for (const folder of draft.folders) await ensurePath(folder.path);
  return { kb, folders: touchedFolders, entries: [] };
}
