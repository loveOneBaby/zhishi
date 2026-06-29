import { createKb, createFolder, createEntry, ensureFolder, listFolders } from '../db.js';
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

function samePathPart(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function startsWithPath(parts: string[], prefix: string[]): boolean {
  return prefix.length > 0
    && parts.length >= prefix.length
    && prefix.every((part, index) => samePathPart(parts[index], part));
}

export function normalizeFolderDraftPathForTarget(path: string[], input: { kbName: string; targetPath: string[] }): string[] {
  let parts = path.map((part) => String(part ?? '').trim()).filter(Boolean);
  const targetPath = input.targetPath.map((part) => part.trim()).filter(Boolean);
  const targetLeaf = targetPath[targetPath.length - 1] ?? '';

  let changed = true;
  while (changed && parts.length) {
    changed = false;
    if (input.kbName && samePathPart(parts[0], input.kbName)) {
      parts = parts.slice(1);
      changed = true;
      continue;
    }
    if (startsWithPath(parts, targetPath)) {
      parts = parts.slice(targetPath.length);
      changed = true;
      continue;
    }
    if (targetLeaf && samePathPart(parts[0], targetLeaf)) {
      parts = parts.slice(1);
      changed = true;
    }
  }
  return parts;
}

function pathOfFolder(folders: Folder[], folderId: string | null): string[] {
  if (!folderId) return [];
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const names: string[] = [];
  const seen = new Set<string>();
  let cursor = byId.get(folderId);
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    names.unshift(cursor.name);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return names;
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
  options: { reuseExisting?: boolean } = {},
): Promise<GeneratedKnowledgeBaseResult> {
  const reuseExisting = options.reuseExisting ?? true;
  const existingFolders = await listFolders();
  const targetPath = pathOfFolder(existingFolders, parentId);
  const folderByPath = new Map<string, Folder>();
  const touchedFolders: Folder[] = [];
  const touchedIds = new Set<string>();
  const occupiedByParent = new Map<string, Set<string>>();

  const parentKey = (id: string | null): string => id ?? 'root';
  const rememberName = (id: string | null, name: string): void => {
    const key = parentKey(id);
    const names = occupiedByParent.get(key) ?? new Set<string>();
    names.add(name.trim().toLowerCase());
    occupiedByParent.set(key, names);
  };
  for (const folder of existingFolders.filter((item) => item.kbId === kb.id)) {
    rememberName(folder.parentId ?? null, folder.name);
  }

  const uniqueName = (parent: string | null, raw: string): string => {
    const base = raw.trim() || '未命名目录';
    const names = occupiedByParent.get(parentKey(parent)) ?? new Set<string>();
    if (!names.has(base.toLowerCase())) {
      names.add(base.toLowerCase());
      occupiedByParent.set(parentKey(parent), names);
      return base;
    }
    for (let index = 2; index < 1000; index += 1) {
      const candidate = `${base} ${index}`;
      if (!names.has(candidate.toLowerCase())) {
        names.add(candidate.toLowerCase());
        occupiedByParent.set(parentKey(parent), names);
        return candidate;
      }
    }
    const fallback = `${base} ${Date.now().toString(36)}`;
    names.add(fallback.toLowerCase());
    occupiedByParent.set(parentKey(parent), names);
    return fallback;
  };

  const ensurePath = async (rawParts: string[]): Promise<void> => {
    const parts = normalizeFolderDraftPathForTarget(rawParts, { kbName: kb.name, targetPath });
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
      const folder = reuseExisting
        ? await ensureFolder(kb.id, name, currentParentId)
        : await createFolder({ kbId: kb.id, parentId: currentParentId, name: uniqueName(currentParentId, name) });
      if (!folder) throw new Error('目录创建失败');
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
