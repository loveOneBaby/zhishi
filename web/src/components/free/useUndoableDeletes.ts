import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { Entry, Folder, KnowledgeBase } from '../../types';
import { importAll } from '../../api';
import { folderSubtreeIds } from '../../tree';
import { toast } from '../../toast';
import { newImportBatchId } from './utils';
import type { RestoreSnapshot } from './types';

interface UndoableDeletesDeps {
  entries: Entry[];
  folders: Folder[];
  freeFolder: string | null;
  selectedEntryId: string | null;
  currentKb: KnowledgeBase | null;
  onImported: (entries: Entry[], kbs: KnowledgeBase[], folders: Folder[]) => void;
  onDeleteKb: (id: string) => Promise<void>;
  onDeleteFolder: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  setFreeKb: (id: string | null) => void;
  setFreeFolder: (id: string | null) => void;
  setSelectedEntryId: Dispatch<SetStateAction<string | null>>;
  setPanelMode: (mode: 'detail' | 'create' | 'edit') => void;
  dirtyRef: MutableRefObject<boolean>;
}

// 删除类操作均支持撤销：先把快照通过 importAll(kb-undo-1) 写回，再弹 toast 提供「撤销」入口。
export function useUndoableDeletes(deps: UndoableDeletesDeps) {
  const {
    entries, folders, freeFolder, selectedEntryId, currentKb,
    onImported, onDeleteKb, onDeleteFolder, onDelete,
    setFreeKb, setFreeFolder, setSelectedEntryId, setPanelMode, dirtyRef,
  } = deps;

  async function restoreSnapshot(snapshot: RestoreSnapshot, focus?: { kbId?: string; folderId?: string | null; entryId?: string | null }): Promise<void> {
    try {
      const next = await importAll({
        version: 'kb-undo-1',
        kbs: snapshot.kbs,
        folders: snapshot.folders,
        entries: snapshot.entries,
        importBatchId: newImportBatchId(),
      }, false);
      onImported(next.entries, next.kbs, next.folders);
      if (focus?.kbId) setFreeKb(focus.kbId);
      if (focus && Object.prototype.hasOwnProperty.call(focus, 'folderId')) setFreeFolder(focus.folderId ?? null);
      if (focus?.entryId) setSelectedEntryId(focus.entryId);
      setPanelMode('detail');
      dirtyRef.current = false;
      toast('已撤销删除', 'success');
    } catch (err) {
      toast('撤销失败：' + (err instanceof Error ? err.message : String(err)), 'error');
    }
  }

  function toastUndo(message: string, snapshot: RestoreSnapshot, focus?: { kbId?: string; folderId?: string | null; entryId?: string | null }): void {
    toast(message, 'success', {
      durationMs: 7600,
      action: {
        label: '撤销',
        onClick: () => restoreSnapshot(snapshot, focus),
      },
    });
  }

  function folderSnapshot(folder: Folder): RestoreSnapshot {
    const ids = folderSubtreeIds(folders, folder.id);
    const snapshotFolders = folders.filter((candidate) => ids.has(candidate.id));
    const snapshotEntries = entries.filter((entry) => entry.folderId && ids.has(entry.folderId));
    return { folders: snapshotFolders, entries: snapshotEntries };
  }

  async function deleteKbWithUndo(kb: KnowledgeBase): Promise<void> {
    const snapshot: RestoreSnapshot = {
      kbs: [kb],
      folders: folders.filter((folder) => folder.kbId === kb.id),
      entries: entries.filter((entry) => entry.kbId === kb.id),
    };
    await onDeleteKb(kb.id);
    setSelectedEntryId(null);
    toastUndo(`已删除「${kb.name}」`, snapshot, { kbId: kb.id, folderId: null });
  }

  async function deleteFolderWithUndo(folder: Folder, toastMessage = `已删除「${folder.name}」`): Promise<void> {
    const snapshot = folderSnapshot(folder);
    await onDeleteFolder(folder.id);
    if (freeFolder && snapshot.folders?.some((candidate) => candidate.id === freeFolder)) setFreeFolder(null);
    if (selectedEntryId && snapshot.entries.some((entry) => entry.id === selectedEntryId)) setSelectedEntryId(null);
    toastUndo(toastMessage, snapshot, { kbId: folder.kbId, folderId: folder.id });
  }

  async function deleteEntryWithUndo(entry: Entry, toastMessage = `已删除「${entry.title}」`): Promise<void> {
    const snapshot: RestoreSnapshot = { entries: [entry] };
    await onDelete(entry.id);
    if (selectedEntryId === entry.id) setSelectedEntryId(null);
    toastUndo(toastMessage, snapshot, { kbId: entry.kbId, folderId: entry.folderId ?? null, entryId: entry.id });
  }

  // 只清空文件夹内容(直接子文件夹会连同其子树级联删除 + 直接子知识点),保留文件夹本身
  async function clearFolderWithUndo(folder: Folder): Promise<void> {
    const childFolders = folders.filter((candidate) => (candidate.parentId ?? null) === folder.id);
    const directEntries = entries.filter((entry) => (entry.folderId ?? null) === folder.id);
    if (!childFolders.length && !directEntries.length) {
      toast('该文件夹已经是空的', 'info');
      return;
    }

    const folderIds = new Set<string>();
    for (const child of childFolders) {
      for (const id of folderSubtreeIds(folders, child.id)) folderIds.add(id);
    }
    const snapshotFolders = folders.filter((candidate) => folderIds.has(candidate.id));
    const directEntryIds = new Set(directEntries.map((entry) => entry.id));
    const snapshotEntries = entries.filter((entry) => directEntryIds.has(entry.id) || (entry.folderId && folderIds.has(entry.folderId)));

    for (const child of childFolders) await onDeleteFolder(child.id);
    for (const entry of directEntries) await onDelete(entry.id);

    setSelectedEntryId((id) => (id && snapshotEntries.some((entry) => entry.id === id) ? null : id));
    toastUndo(`已清空「${folder.name}」`, { folders: snapshotFolders, entries: snapshotEntries }, {
      kbId: folder.kbId,
      folderId: folder.id,
    });
  }

  async function deleteSelectionWithUndo(selectedFolders: Folder[], selectedEntries: Entry[]): Promise<void> {
    const folderIds = new Set<string>();
    for (const folder of selectedFolders) {
      for (const id of folderSubtreeIds(folders, folder.id)) folderIds.add(id);
    }
    const snapshotFolders = folders.filter((folder) => folderIds.has(folder.id));
    const selectedEntryIds = new Set(selectedEntries.map((entry) => entry.id));
    const snapshotEntries = entries.filter((entry) => selectedEntryIds.has(entry.id) || (entry.folderId && folderIds.has(entry.folderId)));

    for (const folder of selectedFolders) await onDeleteFolder(folder.id);
    for (const entry of selectedEntries) {
      if (!entry.folderId || !folderIds.has(entry.folderId)) await onDelete(entry.id);
    }
    setSelectedEntryId((id) => (id && snapshotEntries.some((entry) => entry.id === id) ? null : id));
    toastUndo(`已删除 ${selectedFolders.length + selectedEntries.length} 项`, { folders: snapshotFolders, entries: snapshotEntries }, {
      kbId: currentKb?.id,
      folderId: freeFolder,
    });
  }

  return { deleteKbWithUndo, deleteFolderWithUndo, deleteEntryWithUndo, clearFolderWithUndo, deleteSelectionWithUndo };
}
