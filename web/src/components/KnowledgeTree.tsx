import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import {
  BookOpen,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder as FolderIcon,
  FolderOpen,
  FolderPlus,
  Home,
  ListCollapse,
  ListTree,
  MoveRight,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { Tree, type MoveHandler, type NodeApi, type NodeRendererProps, type TreeApi } from 'react-arborist';
import type { Entry, Folder } from '../types';
import { folderPathName, folderSubtreeIds } from '../tree';
import { toast } from '../toast';
import CommandDialog from './CommandDialog';

type TreeItem =
  | {
      id: string;
      name: string;
      type: 'folder';
      folder: Folder;
      count: number;
      childFolderCount: number;
      children: TreeItem[];
    }
  | {
      id: string;
      name: string;
      type: 'entry';
      entry: Entry;
      summary: string;
    };

type MenuState =
  | { kind: 'root'; x: number; y: number }
  | { kind: 'folder'; x: number; y: number; folder: Folder }
  | { kind: 'entry'; x: number; y: number; entry: Entry };
type MenuTarget =
  | { kind: 'root' }
  | { kind: 'folder'; folder: Folder }
  | { kind: 'entry'; entry: Entry };

interface Props {
  kbId: string;
  folders: Folder[];
  entries: Entry[];
  selectedFolderId: string | null;
  selectedEntryId: string | null;
  folderEntryCount: (folderId: string) => number;
  onSelectFolder: (folder: Folder) => void;
  onSelectEntry: (entry: Entry) => void;
  onCreateFolder: (parentId: string | null) => void;
  onCreateEntry: (folderId: string | null) => void;
  onRenameFolder: (folder: Folder) => void;
  onDeleteFolder: (folder: Folder) => void;
  onEditEntry: (entry: Entry) => void;
  onDeleteEntry: (entry: Entry) => void;
  onDeleteBatch: (folders: Folder[], entries: Entry[]) => Promise<void>;
  onMoveFolder: (id: string, opts: { parentId?: string | null; kbId?: string }) => Promise<void>;
  onReorderFolders: (ids: string[]) => Promise<void>;
  onMoveEntry: (entry: Entry, folderId: string | null) => Promise<void>;
  onReorderEntries: (ids: string[]) => Promise<void>;
}

function sortFolders(list: Folder[]): Folder[] {
  return [...list].sort((a, b) =>
    (a.sort ?? 0) - (b.sort ?? 0)
    || (a.createdAt ?? 0) - (b.createdAt ?? 0)
    || a.name.localeCompare(b.name, 'zh-Hans-CN'),
  );
}

function sortEntries(list: Entry[]): Entry[] {
  return [...list].sort((a, b) =>
    (a.sort ?? 0) - (b.sort ?? 0)
    || (a.createdAt ?? 0) - (b.createdAt ?? 0)
    || a.title.localeCompare(b.title, 'zh-Hans-CN'),
  );
}

function useMeasuredHeight(min = 260): readonly [(node: HTMLDivElement | null) => void, number] {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [height, setHeight] = useState(min);

  useEffect(() => {
    if (!node) return undefined;
    const update = () => setHeight(Math.max(min, Math.floor(node.getBoundingClientRect().height)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [min, node]);

  return [setNode, height] as const;
}

function clampMenuPosition(x: number, y: number): { x: number; y: number } {
  const width = 210;
  const height = 190;
  return {
    x: Math.min(Math.max(8, x), Math.max(8, window.innerWidth - width - 8)),
    y: Math.min(Math.max(8, y), Math.max(8, window.innerHeight - height - 8)),
  };
}

function itemClass(active: boolean, selected: boolean, type: TreeItem['type'], dragging: boolean, dropTarget: boolean): string {
  return [
    'ik-kt-node',
    `ik-kt-node-${type}`,
    active ? 'is-active' : '',
    selected ? 'is-selected' : '',
    dragging ? 'is-dragging' : '',
    dropTarget ? 'is-drop-target' : '',
  ].filter(Boolean).join(' ');
}

export default function KnowledgeTree(props: Props): ReactNode {
  const {
    kbId,
    folders,
    entries,
    selectedFolderId,
    selectedEntryId,
    folderEntryCount,
    onSelectFolder,
    onSelectEntry,
    onCreateFolder,
    onCreateEntry,
    onRenameFolder,
    onDeleteFolder,
    onEditEntry,
    onDeleteEntry,
    onDeleteBatch,
    onMoveFolder,
    onReorderFolders,
    onMoveEntry,
    onReorderEntries,
  } = props;

  const treeRef = useRef<TreeApi<TreeItem> | undefined>(undefined);
  const [measureTree, treeHeight] = useMeasuredHeight();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [moveMenuOpen, setMoveMenuOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const treeData = useMemo<TreeItem[]>(() => {
    const foldersByParent = new Map<string | null, Folder[]>();
    for (const folder of folders) {
      const key = folder.parentId ?? null;
      if (!foldersByParent.has(key)) foldersByParent.set(key, []);
      foldersByParent.get(key)!.push(folder);
    }
    const entriesByFolder = new Map<string | null, Entry[]>();
    for (const entry of entries) {
      const key = entry.folderId ?? null;
      if (!entriesByFolder.has(key)) entriesByFolder.set(key, []);
      entriesByFolder.get(key)!.push(entry);
    }

    const build = (parentId: string | null): TreeItem[] => {
      const childFolders = sortFolders(foldersByParent.get(parentId) ?? []).map((folder) => ({
        id: folder.id,
        name: folder.name,
        type: 'folder' as const,
        folder,
        count: folderEntryCount(folder.id),
        childFolderCount: folders.filter((candidate) => candidate.parentId === folder.id).length,
        children: build(folder.id),
      }));
      const childEntries = sortEntries(entriesByFolder.get(parentId) ?? []).map((entry) => ({
        id: entry.id,
        name: entry.title,
        type: 'entry' as const,
        entry,
        summary: entry.summary,
      }));
      return [...childFolders, ...childEntries];
    };

    return build(null);
  }, [entries, folders, folderEntryCount]);

  useEffect(() => {
    if (!selectedEntryId) return;
    treeRef.current?.get(selectedEntryId)?.openParents();
  }, [selectedEntryId, treeData]);

  useEffect(() => {
    const validIds = new Set([...folders.map((folder) => folder.id), ...entries.map((entry) => entry.id)]);
    setSelectedIds((current) => current.filter((id) => validIds.has(id)));
  }, [entries, folders]);

  useEffect(() => {
    if (!menu && !moveMenuOpen) return undefined;
    const close = () => setMenu(null);
    const closeMove = () => setMoveMenuOpen(false);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
        closeMove();
      }
    };
    document.addEventListener('click', close);
    document.addEventListener('click', closeMove);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('click', closeMove);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu, moveMenuOpen]);

  const openMenu = (event: React.MouseEvent, next: MenuTarget): void => {
    event.preventDefault();
    event.stopPropagation();
    const point = clampMenuPosition(event.clientX, event.clientY);
    setMenu({ ...next, ...point } as MenuState);
  };

  const orderFoldersForMove = (dragId: string, parentId: string | null, index: number): string[] => {
    const current = folders.find((folder) => folder.id === dragId);
    const sameParent = current && (current.parentId ?? null) === parentId;
    const siblings = sortFolders(folders.filter((folder) => folder.kbId === kbId && (folder.parentId ?? null) === parentId && folder.id !== dragId))
      .map((folder) => folder.id);
    const currentIndex = sameParent
      ? sortFolders(folders.filter((folder) => folder.kbId === kbId && (folder.parentId ?? null) === parentId)).findIndex((folder) => folder.id === dragId)
      : -1;
    const effectiveIndex = sameParent && currentIndex >= 0 && currentIndex < index ? index - 1 : index;
    const nextIndex = Math.max(0, Math.min(effectiveIndex, siblings.length));
    siblings.splice(nextIndex, 0, dragId);
    return siblings;
  };

  const orderEntriesForMove = (dragId: string, parentId: string | null, index: number): string[] => {
    const folderOffset = sortFolders(folders.filter((folder) => folder.kbId === kbId && (folder.parentId ?? null) === parentId)).length;
    const current = entries.find((entry) => entry.id === dragId);
    const sameParent = current && (current.folderId ?? null) === parentId;
    const siblings = sortEntries(entries.filter((entry) => (entry.folderId ?? null) === parentId && entry.id !== dragId)).map((entry) => entry.id);
    const currentEntryIndex = sameParent
      ? sortEntries(entries.filter((entry) => (entry.folderId ?? null) === parentId)).findIndex((entry) => entry.id === dragId)
      : -1;
    const currentTreeIndex = currentEntryIndex >= 0 ? folderOffset + currentEntryIndex : -1;
    const effectiveIndex = sameParent && currentTreeIndex >= 0 && currentTreeIndex < index ? index - 1 : index;
    const entryIndex = Math.max(0, Math.min(effectiveIndex - folderOffset, siblings.length));
    siblings.splice(entryIndex, 0, dragId);
    return siblings;
  };

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedFolders = useMemo(() => folders.filter((folder) => selectedIdSet.has(folder.id)), [folders, selectedIdSet]);
  const selectedEntries = useMemo(() => entries.filter((entry) => selectedIdSet.has(entry.id)), [entries, selectedIdSet]);
  const selectedCount = selectedFolders.length + selectedEntries.length;

  const targetFolders = useMemo(
    () => sortFolders(folders).map((folder) => ({
      folder,
      label: folderPathName(folders, folder.id) || folder.name,
    })).sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans-CN')),
    [folders],
  );

  const topLevelSelectedFolders = (): Folder[] => {
    const selectedFolderIds = new Set(selectedFolders.map((folder) => folder.id));
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    return selectedFolders.filter((folder) => {
      let parentId = folder.parentId;
      while (parentId) {
        if (selectedFolderIds.has(parentId)) return false;
        parentId = byId.get(parentId)?.parentId ?? null;
      }
      return true;
    });
  };

  const collectBatchTargets = (): { foldersToHandle: Folder[]; entriesToHandle: Entry[] } => {
    const foldersToHandle = topLevelSelectedFolders();
    const coveredFolderIds = new Set<string>();
    for (const folder of foldersToHandle) {
      for (const id of folderSubtreeIds(folders, folder.id)) coveredFolderIds.add(id);
    }
    const entriesToHandle = selectedEntries.filter((entry) => !entry.folderId || !coveredFolderIds.has(entry.folderId));
    return { foldersToHandle, entriesToHandle };
  };

  const clearBatchSelection = (): void => {
    treeRef.current?.deselectAll();
    setSelectedIds([]);
    setMoveMenuOpen(false);
  };

  const enterBatchMode = (): void => {
    clearBatchSelection();
    setBatchMode(true);
  };

  const exitBatchMode = (): void => {
    clearBatchSelection();
    setBatchMode(false);
  };

  const handleNodeClick = (event: React.MouseEvent, node: NodeApi<TreeItem>): void => {
    event.stopPropagation();
    if (!batchMode) {
      activateNode(node);
      return;
    }
    if (event.metaKey || event.ctrlKey) {
      if (node.isSelected) node.deselect();
      else node.tree.selectMulti(node, { focus: false });
      return;
    }
    if (event.shiftKey) {
      node.selectContiguous();
      return;
    }
    if (node.isSelected) node.deselect();
    else node.tree.selectMulti(node, { focus: false });
  };

  const toggleNodeSelection = (event: React.MouseEvent | React.ChangeEvent, node: NodeApi<TreeItem>): void => {
    event.stopPropagation();
    if (node.isSelected) node.deselect();
    else node.tree.selectMulti(node, { focus: false });
  };

  async function moveSelectedTo(targetFolderId: string | null): Promise<void> {
    const { foldersToHandle, entriesToHandle } = collectBatchTargets();
    const total = foldersToHandle.length + entriesToHandle.length;
    if (total === 0) return;
    if (targetFolderId) {
      const invalid = foldersToHandle.some((folder) => folderSubtreeIds(folders, folder.id).has(targetFolderId));
      if (invalid) {
        toast('不能移动到自身或子文件夹', 'error');
        return;
      }
    }

    try {
      for (const folder of foldersToHandle) {
        if ((folder.parentId ?? null) !== targetFolderId) {
          await onMoveFolder(folder.id, { parentId: targetFolderId, kbId });
        }
      }
      for (const entry of entriesToHandle) {
        if ((entry.folderId ?? null) !== targetFolderId) {
          await onMoveEntry(entry, targetFolderId);
        }
      }
      exitBatchMode();
      toast(`已移动 ${total} 项`, 'success');
    } catch (err) {
      toast('批量移动失败：' + (err instanceof Error ? err.message : String(err)), 'error');
    }
  }

  async function deleteSelected(): Promise<void> {
    const { foldersToHandle, entriesToHandle } = collectBatchTargets();
    const total = foldersToHandle.length + entriesToHandle.length;
    if (total === 0) return;

    try {
      await onDeleteBatch(foldersToHandle, entriesToHandle);
      exitBatchMode();
    } catch (err) {
      toast('批量删除失败：' + (err instanceof Error ? err.message : String(err)), 'error');
    }
  }

  const handleMove: MoveHandler<TreeItem> = async ({ dragIds, dragNodes, parentId, index }) => {
    const node = dragNodes[0];
    const dragId = node?.id ?? dragIds[0];
    if (!node || dragNodes.length !== 1) {
      toast('一次拖拽一个节点更稳妥', 'info');
      return;
    }
    const nextParentId = parentId ?? null;

    try {
      if (node.data.type === 'folder') {
        const folder = folders.find((candidate) => candidate.id === dragId);
        if (!folder) return;
        const nextOrder = orderFoldersForMove(folder.id, nextParentId, index);
        if ((folder.parentId ?? null) !== nextParentId) {
          await onMoveFolder(folder.id, { parentId: nextParentId, kbId });
        }
        await onReorderFolders(nextOrder);
        return;
      }

      const entry = entries.find((candidate) => candidate.id === dragId);
      if (!entry) return;
      const nextOrder = orderEntriesForMove(entry.id, nextParentId, index);
      if ((entry.folderId ?? null) !== nextParentId) {
        await onMoveEntry(entry, nextParentId);
      }
      await onReorderEntries(nextOrder);
    } catch (err) {
      toast('移动失败：' + (err instanceof Error ? err.message : String(err)), 'error');
    }
  };

  const activateNode = (node: NodeApi<TreeItem>): void => {
    const data = node.data;
    if (data.type === 'folder') {
      onSelectFolder(data.folder);
      node.toggle();
      return;
    }
    onSelectEntry(data.entry);
  };

  const TreeNode = ({ node, style, dragHandle }: NodeRendererProps<TreeItem>): ReactNode => {
    const data = node.data;
    const active = data.type === 'folder'
      ? selectedFolderId === data.folder.id && !selectedEntryId
      : selectedEntryId === data.entry.id;
    const hasChildren = Boolean(node.children?.length);
    const meta = data.type === 'entry' ? data.summary : '';
    const menuTarget: MenuTarget = data.type === 'folder' ? { kind: 'folder', folder: data.folder } : { kind: 'entry', entry: data.entry };

    return (
      <div style={style} className="ik-kt-row-shell" onContextMenu={(event) => openMenu(event, menuTarget)}>
        <div
          ref={dragHandle}
          className={`${itemClass(active, batchMode && node.isSelected, data.type, node.isDragging, node.willReceiveDrop)} ${batchMode ? 'is-batch' : ''}`}
          onClick={(event) => handleNodeClick(event, node)}
          onContextMenu={(event) => openMenu(event, menuTarget)}
        >
          {batchMode && (
            <input
              type="checkbox"
              className="ik-kt-check"
              checked={node.isSelected}
              aria-label={`选择 ${data.name}`}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => toggleNodeSelection(event, node)}
            />
          )}
          <button
            type="button"
            className={`ik-kt-caret ${hasChildren ? '' : 'is-empty'}`}
            tabIndex={-1}
            onClick={(event) => {
              event.stopPropagation();
              if (node.isInternal) node.toggle();
            }}
          >
            {node.isOpen ? <ChevronDown size={14} strokeWidth={2.2} /> : <ChevronRight size={14} strokeWidth={2.2} />}
          </button>
          <span className={`ik-kt-icon ik-kt-icon-${data.type}`} aria-hidden="true">
            {data.type === 'folder'
              ? (node.isOpen ? <FolderOpen size={16} strokeWidth={2.1} /> : <FolderIcon size={16} strokeWidth={2.1} />)
              : <FileText size={15} strokeWidth={2.1} />}
          </span>
          <span className="ik-kt-main">
            <span className="ik-kt-title">{data.name}</span>
            {meta && <span className="ik-kt-meta">{meta}</span>}
          </span>
        </div>
      </div>
    );
  };

  const runMenuAction = (action: () => void): void => {
    setMenu(null);
    action();
  };

  return (
    <div className="ik-kt-shell">
      <div className="ik-kt-toolbar">
        <div className="ik-kt-quick-actions">
          <button type="button" className="ik-kt-root-create" onClick={() => onCreateFolder(null)}>
            <FolderPlus size={14} strokeWidth={2.1} />根文件夹
          </button>
          <button type="button" onClick={() => treeRef.current?.openAll()}>
            <ListTree size={14} strokeWidth={2.1} />展开
          </button>
          <button type="button" onClick={() => treeRef.current?.closeAll()}>
            <ListCollapse size={14} strokeWidth={2.1} />收起
          </button>
          {!batchMode ? (
            <button type="button" className="ik-kt-batch-toggle" onClick={enterBatchMode}>
              <CheckSquare size={14} strokeWidth={2.1} />批量
            </button>
          ) : (
            <button type="button" onClick={() => treeRef.current?.selectAll()}>
              <CheckSquare size={14} strokeWidth={2.1} />全选
            </button>
          )}
        </div>
      </div>

      {batchMode && (
        <div className="ik-kt-batchbar" onClick={(event) => event.stopPropagation()}>
          <span><CheckSquare size={13} strokeWidth={2.1} />已选 {selectedCount}</span>
          <button
            type="button"
            disabled={selectedCount === 0}
            onClick={(event) => {
              event.stopPropagation();
              setMoveMenuOpen((open) => !open);
            }}
          >
            <MoveRight size={14} strokeWidth={2.1} />移动
          </button>
          <button type="button" className="danger" disabled={selectedCount === 0} onClick={() => setDeleteConfirmOpen(true)}>
            <Trash2 size={14} strokeWidth={2.1} />删除
          </button>
          {selectedCount > 0 ? (
            <button type="button" onClick={clearBatchSelection}>
              <X size={14} strokeWidth={2.1} />清空
            </button>
          ) : (
            <button type="button" onClick={exitBatchMode}>
              <X size={14} strokeWidth={2.1} />完成
            </button>
          )}
          {moveMenuOpen && selectedCount > 0 && (
            <div className="ik-kt-move-menu" onClick={(event) => event.stopPropagation()}>
              <button type="button" onClick={() => void moveSelectedTo(null)}>
                <Home size={14} strokeWidth={2.1} />知识库根层级
              </button>
              {targetFolders.map(({ folder, label }) => (
                <button type="button" key={folder.id} onClick={() => void moveSelectedTo(folder.id)}>
                  <FolderIcon size={14} strokeWidth={2.1} />{label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div
        ref={measureTree}
        className="ik-kt-tree"
        onContextMenu={(event) => {
          if (batchMode) return;
          openMenu(event, { kind: 'root' });
        }}
      >
        {treeData.length > 0 ? (
          <Tree
            ref={treeRef}
            data={treeData}
            width="100%"
            height={treeHeight}
            rowHeight={36}
            indent={14}
            overscanCount={8}
            openByDefault
            idAccessor="id"
            childrenAccessor={(item) => (item.type === 'folder' ? item.children : null)}
            disableDrop={({ parentNode, dragNodes }) =>
              dragNodes.length !== 1 || (!parentNode.isRoot && parentNode.data.type !== 'folder')
            }
            onActivate={activateNode}
            onSelect={(nodes) => setSelectedIds(nodes.map((node) => node.id))}
            onMove={handleMove}
            className="ik-kt-arborist"
          >
            {TreeNode}
          </Tree>
        ) : (
          <div className="ik-kt-empty">
            <span>当前知识库还没有文件夹或知识点。</span>
            <button type="button" onClick={() => onCreateFolder(null)}>
              <FolderPlus size={14} strokeWidth={2.1} />新建根文件夹
            </button>
          </div>
        )}
      </div>

      {menu && (
        <div
          className="ik-kt-menu"
          style={{ '--menu-x': `${menu.x}px`, '--menu-y': `${menu.y}px` } as CSSProperties}
          onClick={(event) => event.stopPropagation()}
        >
          {menu.kind !== 'entry' && (
            <div className="ik-kt-menu-group">
              <span className="ik-kt-menu-label">新建</span>
              <button type="button" onClick={() => runMenuAction(() => onCreateEntry(menu.kind === 'folder' ? menu.folder.id : null))}>
                <Plus size={14} strokeWidth={2.1} />新建知识点
              </button>
              <button type="button" onClick={() => runMenuAction(() => onCreateFolder(menu.kind === 'folder' ? menu.folder.id : null))}>
                <FolderPlus size={14} strokeWidth={2.1} />新建文件夹
              </button>
            </div>
          )}
          {menu.kind === 'folder' && (
            <div className="ik-kt-menu-group">
              <span className="ik-kt-menu-label">管理</span>
              <button type="button" onClick={() => runMenuAction(() => onRenameFolder(menu.folder))}>
                <Pencil size={14} strokeWidth={2.1} />重命名
              </button>
              <span className="ik-kt-menu-label is-danger">危险操作</span>
              <button type="button" className="danger" onClick={() => runMenuAction(() => onDeleteFolder(menu.folder))}>
                <Trash2 size={14} strokeWidth={2.1} />删除文件夹
              </button>
            </div>
          )}
          {menu.kind === 'entry' && (
            <div className="ik-kt-menu-group">
              <span className="ik-kt-menu-label">管理</span>
              <button type="button" onClick={() => runMenuAction(() => onEditEntry(menu.entry))}>
                <BookOpen size={14} strokeWidth={2.1} />编辑知识点
              </button>
              <span className="ik-kt-menu-label is-danger">危险操作</span>
              <button type="button" className="danger" onClick={() => runMenuAction(() => onDeleteEntry(menu.entry))}>
                <Trash2 size={14} strokeWidth={2.1} />删除知识点
              </button>
            </div>
          )}
        </div>
      )}
      <CommandDialog
        open={deleteConfirmOpen}
        tone="danger"
        title="批量删除"
        description={`确定删除选中的 ${selectedCount} 项？文件夹会连同子文件夹和知识点一起删除。`}
        helper="此操作不可撤销，建议确认选区后再继续。"
        confirmText="删除"
        cancelText="保留"
        onOpenChange={setDeleteConfirmOpen}
        onConfirm={() => deleteSelected()}
      />
    </div>
  );
}
