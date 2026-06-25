import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { ArrowRight, BookOpen, Download, FileText, FolderPlus, Pencil, Plus, Sparkles, Trash2, Upload, X } from 'lucide-react';
import type { Entry, EntryInput, Folder, KnowledgeBase } from '../types';
import { folderChain, folderPathName, folderSubtreeIds } from '../tree';
import DetailSidePanel from './DetailSidePanel';
import EntryEditor from './EntryEditor';
import ImportPreviewModal from './ImportPreviewModal';
import KnowledgeTree from './KnowledgeTree';
import CommandDialog from './CommandDialog';
import type { SelectOption } from './SelectField';
import { exportAll, generateEntryWithAIStream, importAll, previewImport, rewriteEntryWithAIStream, type ImportPayload, type ImportPreview } from '../api';
import { toast } from '../toast';

interface Props {
  entries: Entry[];
  kbs: KnowledgeBase[];
  folders: Folder[];
  freeKb: string | null;
  freeFolder: string | null;
  setFreeKb: (id: string | null) => void;
  setFreeFolder: (id: string | null) => void;
  onNew: () => void;
  onCreate: (input: EntryInput) => Promise<Entry>;
  onUpdate: (id: string, input: EntryInput) => Promise<Entry>;
  onDelete: (id: string) => Promise<void>;
  onReorderEntries: (ids: string[]) => Promise<void>;
  onImported: (entries: Entry[], kbs: KnowledgeBase[], folders: Folder[]) => void;
  onGeneratedEntry: (entry: Entry) => void;
  onCreateKb: (name: string) => Promise<KnowledgeBase>;
  onCreateFolder: (input: { kbId: string; parentId?: string | null; name: string }) => Promise<Folder>;
  onRenameKb: (id: string, name: string) => Promise<void>;
  onDeleteKb: (id: string) => Promise<void>;
  onRenameFolder: (id: string, name: string) => Promise<void>;
  onDeleteFolder: (id: string) => Promise<void>;
  onMoveFolder: (id: string, opts: { parentId?: string | null; kbId?: string }) => Promise<void>;
  onReorderFolders: (ids: string[]) => Promise<void>;
}

const ghostBtn: CSSProperties = {
  padding: '10px 15px',
  fontSize: 13,
  fontFamily: 'inherit',
  cursor: 'pointer',
  background: 'var(--panel)',
  color: 'var(--fg)',
  border: '1px solid var(--bd)',
  borderRadius: 8,
  fontWeight: 620,
};

const treePanelStyle: CSSProperties = {
  position: 'relative',
  height: '100%',
  minHeight: 0,
  overflow: 'hidden',
  border: '1px solid var(--bd)',
  borderRadius: 12,
  background: 'var(--panel)',
  boxShadow: '0 10px 28px rgba(0,0,0,.04)',
  display: 'flex',
  flexDirection: 'column',
};

const ROOT_IMPORT_TARGET = '__ik_root_folder__';

function orderEntries(list: Entry[]): Entry[] {
  return [...list].sort((a, b) =>
    (a.sort ?? 0) - (b.sort ?? 0)
    || (a.createdAt ?? 0) - (b.createdAt ?? 0)
    || a.title.localeCompare(b.title, 'zh-Hans-CN'),
  );
}

function newImportBatchId(): string {
  return `im_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// 卡片 / 树节点右侧的轻量操作按钮
function RowActions({ onRename, onDelete }: { onRename: () => void; onDelete: () => void }): ReactNode {
  return (
    <div className="ik-row-actions">
      <button type="button" title="重命名" className="ik-row-action-btn" onClick={(e) => { e.stopPropagation(); onRename(); }}>
        <Pencil size={13} strokeWidth={2.1} />
      </button>
      <button type="button" title="删除" className="ik-row-action-btn ik-row-action-danger" onClick={(e) => { e.stopPropagation(); onDelete(); }}>
        <Trash2 size={13} strokeWidth={2.1} />
      </button>
    </div>
  );
}

type CommandState =
  | { kind: 'create-kb' }
  | { kind: 'create-folder'; kbId: string; parentId: string | null }
  | { kind: 'generate-entry'; kbId: string; folderId: string | null }
  | { kind: 'rewrite-entry'; entry: Entry }
  | { kind: 'rename-kb'; kb: KnowledgeBase }
  | { kind: 'rename-folder'; folder: Folder }
  | { kind: 'delete-kb'; kb: KnowledgeBase }
  | { kind: 'delete-folder'; folder: Folder }
  | { kind: 'clear-folder'; folder: Folder }
  | { kind: 'delete-entry'; entry: Entry }
  | { kind: 'discard-edit' };

interface RestoreSnapshot {
  kbs?: KnowledgeBase[];
  folders?: Folder[];
  entries: Entry[];
}

export default function FreeMode(props: Props): ReactNode {
  const { entries, kbs, folders, freeKb, freeFolder, setFreeKb, setFreeFolder, onNew,
    onCreate, onUpdate, onDelete, onImported, onGeneratedEntry,
    onCreateKb, onCreateFolder, onRenameKb, onDeleteKb, onRenameFolder, onDeleteFolder, onMoveFolder, onReorderFolders, onReorderEntries } = props;

  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(() => localStorage.getItem('ik_free_entry') || null);
  const [panelMode, setPanelMode] = useState<'detail' | 'create' | 'edit'>('detail');
  const [importPreview, setImportPreview] = useState<{ payload: ImportPayload; preview: ImportPreview } | null>(null);
  const [importing, setImporting] = useState(false);
  const [previewingImport, setPreviewingImport] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  const [command, setCommand] = useState<CommandState | null>(null);
  const [aiLiveLogs, setAiLiveLogs] = useState<string[]>([]);
  const [aiLivePlan, setAiLivePlan] = useState('');
  const [aiLiveOutput, setAiLiveOutput] = useState('');
  const dirtyRef = useRef(false);
  const pendingGuardRef = useRef<(() => void) | null>(null);
  const aiRawOutputRef = useRef('');

  function updateAiVisibleOutput(nextRaw: string): void {
    aiRawOutputRef.current = nextRaw.slice(-18000);
    const marker = aiRawOutputRef.current.indexOf('---JSON---');
    if (marker >= 0) {
      setAiLivePlan(aiRawOutputRef.current.slice(0, marker).trim());
      setAiLiveOutput(aiRawOutputRef.current.slice(marker + '---JSON---'.length).trimStart());
      return;
    }
    const jsonStart = aiRawOutputRef.current.indexOf('{');
    if (jsonStart > 0) {
      setAiLivePlan(aiRawOutputRef.current.slice(0, jsonStart).trim());
      setAiLiveOutput(aiRawOutputRef.current.slice(jsonStart).trimStart());
      return;
    }
    setAiLivePlan(aiRawOutputRef.current.trimStart());
    setAiLiveOutput('');
  }

  const entriesOfKb = useMemo(() => (kbId: string) => orderEntries(entries.filter((e) => e.kbId === kbId)), [entries]);
  const currentKb = kbs.find((k) => k.id === freeKb) ?? null;
  const kbEntries = useMemo(() => (freeKb ? entriesOfKb(freeKb) : []), [entriesOfKb, freeKb]);
  const selectedEntry = useMemo(
    () => kbEntries.find((entry) => entry.id === selectedEntryId) ?? null,
    [kbEntries, selectedEntryId],
  );
  const currentFolderId = selectedEntry?.folderId ?? freeFolder;
  const currentFolderChain = useMemo(() => folderChain(folders, currentFolderId), [currentFolderId, folders]);
  const operationPath = [
    currentKb?.name ?? '知识库',
    ...(currentFolderChain.length ? currentFolderChain.map((folder) => folder.name) : ['根层级']),
  ];
  const viewingPath = selectedEntry ? [...operationPath, selectedEntry.title] : operationPath;
  const operationPathLabel = operationPath.join(' / ');
  const viewingPathLabel = viewingPath.join(' / ');
  const importFolderOptions = useMemo<SelectOption[]>(() => {
    if (!freeKb) return [];
    const currentRoot = currentKb?.name ? `${currentKb.name} / 根层级` : '知识库根层级';
    const folderOptions = folders
      .filter((folder) => folder.kbId === freeKb)
      .map((folder) => ({ value: folder.id, label: folderPathName(folders, folder.id) || folder.name }))
      .sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans-CN'));
    return [{ value: ROOT_IMPORT_TARGET, label: currentRoot }, ...folderOptions];
  }, [currentKb?.name, folders, freeKb]);
  const canImportJson = Boolean(freeKb);
  useEffect(() => {
    if (!freeKb) {
      if (selectedEntryId) setSelectedEntryId(null);
      if (panelMode !== 'detail') setPanelMode('detail');
      return;
    }
    if (selectedEntryId && kbEntries.some((entry) => entry.id === selectedEntryId)) return;
    if (selectedEntryId && kbEntries.length === 0) return;
    setSelectedEntryId(kbEntries[0]?.id ?? null);
  }, [freeKb, kbEntries, panelMode, selectedEntryId]);

  useEffect(() => {
    if (selectedEntryId) localStorage.setItem('ik_free_entry', selectedEntryId);
    else localStorage.removeItem('ik_free_entry');
  }, [selectedEntryId]);

  useEffect(() => {
    if (!freeKb || !freeFolder) return;
    const stillExists = folders.some((folder) => folder.id === freeFolder && folder.kbId === freeKb);
    if (!stillExists) setFreeFolder(null);
  }, [folders, freeFolder, freeKb, setFreeFolder]);

  useEffect(() => {
    if (panelMode === 'edit' && !selectedEntry) setPanelMode('detail');
  }, [panelMode, selectedEntry]);

  const onDirtyChange = (dirty: boolean): void => {
    dirtyRef.current = dirty;
  };

  function guardPanel(next: () => void): void {
    if (dirtyRef.current) {
      pendingGuardRef.current = next;
      setCommand({ kind: 'discard-edit' });
      return;
    }
    next();
  }

  // ── 新建操作 ──
  function newKb(): void {
    setCommand({ kind: 'create-kb' });
  }
  function newFolder(kbId: string, parentId: string | null): void {
    setCommand({ kind: 'create-folder', kbId, parentId });
  }
  function renameKbAction(kb: KnowledgeBase): void {
    setCommand({ kind: 'rename-kb', kb });
  }
  function deleteKbAction(kb: KnowledgeBase): void {
    setCommand({ kind: 'delete-kb', kb });
  }
  function renameFolderAction(folder: Folder): void {
    setCommand({ kind: 'rename-folder', folder });
  }
  function deleteFolderAction(folder: Folder): void {
    setCommand({ kind: 'delete-folder', folder });
  }
  function clearFolderAction(folder: Folder): void {
    setCommand({ kind: 'clear-folder', folder });
  }

  async function handleExport(): Promise<void> {
    try {
      const all = await exportAll();
      const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `knowledge-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast('已导出全量知识点', 'success');
    } catch (err) {
      toast('导出失败：' + (err instanceof Error ? err.message : String(err)), 'error');
    }
  }

  function handleImport(e: React.ChangeEvent<HTMLInputElement>, overrideFolderId?: string | null): void {
    const file = e.target.files?.[0];
    if (!file) return;
    const currentKb = freeKb ? kbs.find((kb) => kb.id === freeKb) : null;
    if (!currentKb) {
      toast('请先进入一个知识库，再导入数据', 'info');
      e.target.value = '';
      return;
    }
    if (!canImportJson) {
      toast('请先进入一个知识库，再导入 JSON', 'info');
      e.target.value = '';
      return;
    }
    // 右键文件夹导入会传入目标文件夹;否则默认导入到当前所在位置
    const targetFolderId = overrideFolderId !== undefined ? overrideFolderId : (freeFolder ?? null);
    const reader = new FileReader();
    reader.onload = () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(reader.result));
      } catch (err) {
        toast('文件解析失败：' + (err instanceof Error ? err.message : String(err)), 'error');
        return;
      }
      const obj = parsed as {
        version?: string;
        meta?: unknown;
        package?: unknown;
        schema?: unknown;
        containers?: unknown[];
        extensions?: unknown;
        kbs?: unknown[];
        folders?: unknown[];
        tree?: unknown[];
        entries?: unknown[];
        assets?: unknown[];
      };
      const hasTree = Array.isArray(obj?.tree) && obj.tree.length > 0;
      const hasEntries = Array.isArray(obj?.entries) && obj.entries.length > 0;
      if (!hasTree && !hasEntries) {
        toast('文件需要 kb-package-2 的 entries 数组', 'error');
        return;
      }
      const payload: ImportPayload = {
        version: obj.version,
        meta: obj.meta,
        package: obj.package,
        schema: obj.schema,
        containers: obj.containers,
        extensions: obj.extensions,
        kbs: obj.kbs,
        folders: obj.folders,
        tree: obj.tree,
        entries: obj.entries,
        assets: obj.assets,
        targetKbId: currentKb?.id,
        targetKbName: currentKb?.name,
        targetFolderId,
        importBatchId: newImportBatchId(),
      };
      refreshImportPreview(payload);
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  // 右键文件夹「导入」:用隐藏 input 选文件,导入目标锁定为该文件夹
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const pendingImportFolderRef = useRef<string | null | undefined>(undefined);
  function importToFolder(folder: Folder): void {
    if (!freeKb) {
      toast('请先进入一个知识库，再导入 JSON', 'info');
      return;
    }
    pendingImportFolderRef.current = folder.id;
    importInputRef.current?.click();
  }

  function refreshImportPreview(payload: ImportPayload): void {
    setPreviewingImport(true);
    previewImport(payload)
      .then((preview) => setImportPreview({ payload, preview }))
      .catch((err) => toast('解析失败：' + (err instanceof Error ? err.message : String(err)), 'error'))
      .finally(() => setPreviewingImport(false));
  }

  async function handleConfirmImport(replace: boolean): Promise<void> {
    if (!importPreview) return;
    const { payload, preview } = importPreview;
    const previewFolders = preview.folders ?? [];
    if (!Object.prototype.hasOwnProperty.call(payload, 'targetFolderId')) {
      toast('请选择导入位置', 'error');
      return;
    }
    setImporting(true);
    try {
      const next = await importAll(payload, replace);
      onImported(next.entries, next.kbs, next.folders);
      toast(`已导入 ${preview.valid} 条知识点，生成 ${previewFolders.length} 个文件夹`, 'success');
      setImportPreview(null);
      const importedFolderIds = new Set(previewFolders.map((folder) => folder.id).filter((id): id is string => Boolean(id)));
      const firstImportedFolder = next.folders.find((folder) => importedFolderIds.has(folder.id) && folder.parentId === payload.targetFolderId)
        ?? next.folders.find((folder) => importedFolderIds.has(folder.id));
      setFreeFolder(firstImportedFolder?.id ?? payload.targetFolderId ?? null);
      setPanelMode('detail');
    } catch (err) {
      toast('导入失败：' + (err instanceof Error ? err.message : String(err)), 'error');
    } finally {
      setImporting(false);
    }
  }

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

  function startCreateEntry(): void {
    if (!freeKb) {
      onNew();
      return;
    }
    startCreateEntryInFolder(freeFolder);
  }

  function startCreateEntryInFolder(folderId: string | null): void {
    if (!freeKb) {
      onNew();
      return;
    }
    guardPanel(() => {
      setFreeFolder(folderId);
      setPanelMode('create');
      dirtyRef.current = false;
    });
  }

  function startGenerateEntry(): void {
    if (!freeKb) {
      toast('请先进入一个知识库，再生成知识点', 'info');
      return;
    }
    const folderId = selectedEntry?.folderId ?? freeFolder ?? null;
    setAiLiveLogs([]);
    setAiLivePlan('');
    setAiLiveOutput('');
    aiRawOutputRef.current = '';
    setCommand({ kind: 'generate-entry', kbId: freeKb, folderId });
  }

  function startRewriteEntry(): void {
    if (!selectedEntry) {
      toast('请先选择一个知识点', 'info');
      return;
    }
    setAiLiveLogs([]);
    setAiLivePlan('');
    setAiLiveOutput('');
    aiRawOutputRef.current = '';
    setCommand({ kind: 'rewrite-entry', entry: selectedEntry });
  }

  function startEditEntry(): void {
    if (!selectedEntry) {
      toast('请先选择一个知识点', 'info');
      return;
    }
    guardPanel(() => {
      setPanelMode('edit');
      dirtyRef.current = false;
    });
  }

  function backToDetail(): void {
    guardPanel(() => {
      setPanelMode('detail');
      dirtyRef.current = false;
    });
  }

  function deleteSelectedEntry(): void {
    if (!selectedEntry) return;
    deleteEntryAction(selectedEntry);
  }

  function deleteEntryAction(entry: Entry): void {
    setCommand({ kind: 'delete-entry', entry });
  }

  function selectRoot(): void {
    guardPanel(() => {
      setFreeFolder(null);
      setSelectedEntryId(null);
      setPanelMode('detail');
      dirtyRef.current = false;
    });
  }

  function selectFolder(folder: Folder): void {
    guardPanel(() => {
      setFreeFolder(folder.id);
      setSelectedEntryId(null);
      setPanelMode('detail');
      dirtyRef.current = false;
    });
  }

  function selectEntry(entry: Entry): void {
    guardPanel(() => {
      setSelectedEntryId(entry.id);
      setFreeFolder(entry.folderId ?? null);
      setPanelMode('detail');
      dirtyRef.current = false;
    });
  }

  function editEntryAction(entry: Entry): void {
    guardPanel(() => {
      setSelectedEntryId(entry.id);
      setFreeFolder(entry.folderId ?? null);
      setPanelMode('edit');
      dirtyRef.current = false;
    });
  }

  async function moveEntryAction(entry: Entry, folderId: string | null): Promise<void> {
    const moved = await onUpdate(entry.id, {
      title: entry.title,
      kbId: entry.kbId,
      folderId,
      tags: entry.tags,
      summary: entry.summary,
      py: entry.py,
      intro: entry.intro,
      nodes: entry.nodes,
      doc: entry.doc,
    });
    if (selectedEntryId === entry.id) {
      setSelectedEntryId(moved.id);
      setFreeFolder(moved.folderId ?? null);
    }
  }

  function openKb(kb: KnowledgeBase): void {
    setFreeKb(kb.id);
    setFreeFolder(null);
    setSelectedEntryId(entriesOfKb(kb.id)[0]?.id ?? null);
    setPanelMode('detail');
    dirtyRef.current = false;
  }

  function backToKbList(): void {
    guardPanel(() => {
      setFreeKb(null);
      setFreeFolder(null);
      setSelectedEntryId(null);
      setPanelMode('detail');
      dirtyRef.current = false;
    });
  }

  function folderEntryCount(folderId: string): number {
    const ids = folderSubtreeIds(folders, folderId);
    return kbEntries.filter((entry) => entry.folderId && ids.has(entry.folderId)).length;
  }

  function commandErrorPrefix(next: CommandState): string {
    switch (next.kind) {
      case 'create-kb':
      case 'create-folder':
        return '新建失败';
      case 'generate-entry':
        return '生成失败';
      case 'rewrite-entry':
        return '改写失败';
      case 'rename-kb':
      case 'rename-folder':
        return '重命名失败';
      case 'delete-kb':
      case 'delete-folder':
      case 'delete-entry':
        return '删除失败';
      case 'clear-folder':
        return '清空失败';
      case 'discard-edit':
        return '操作失败';
    }
  }

  async function confirmCommand(value: string): Promise<void> {
    if (!command) return;
    try {
      switch (command.kind) {
        case 'create-kb': {
          await onCreateKb(value);
          toast('已新建知识库', 'success');
          return;
        }
        case 'create-folder': {
          await onCreateFolder({ kbId: command.kbId, parentId: command.parentId, name: value });
          toast('已新建文件夹', 'success');
          return;
        }
        case 'generate-entry': {
          setAiLiveLogs(['提交主题到后端']);
          setAiLivePlan('');
          setAiLiveOutput('');
          aiRawOutputRef.current = '';
          const entry = await generateEntryWithAIStream({ topic: value, kbId: command.kbId, folderId: command.folderId }, {
            onStage: (message) => setAiLiveLogs((current) => [...current, message]),
            onContext: (items) => setAiLiveLogs((current) => [
              ...current,
              items.length ? `找到 ${items.length} 条相似知识点作为参考` : '没有找到相似知识点，直接生成',
            ]),
            onDelta: (content) => updateAiVisibleOutput(`${aiRawOutputRef.current}${content}`),
            onOutput: (content) => updateAiVisibleOutput(content),
            onParsed: (payload) => setAiLiveLogs((current) => [
              ...current,
              `解析完成：${payload.title || '未命名'} · ${payload.tags.length} 个标签 · ${payload.sections} 个小节`,
            ]),
            onSaved: (saved) => setAiLiveLogs((current) => [...current, `已写入：${saved.title}`]),
          });
          setPanelMode('detail');
          dirtyRef.current = false;
          onGeneratedEntry(entry);
          setSelectedEntryId(entry.id);
          setFreeFolder(entry.folderId ?? null);
          toast('AI 已生成知识点', 'success');
          return;
        }
        case 'rewrite-entry': {
          setAiLiveLogs(['提交当前 doc 到后端']);
          setAiLivePlan('');
          setAiLiveOutput('');
          aiRawOutputRef.current = '';
          const entry = await rewriteEntryWithAIStream(command.entry.id, {
            onStage: (message) => setAiLiveLogs((current) => [...current, message]),
            onDelta: (content) => updateAiVisibleOutput(`${aiRawOutputRef.current}${content}`),
            onOutput: (content) => updateAiVisibleOutput(content),
            onParsed: (payload) => setAiLiveLogs((current) => [
              ...current,
              `解析完成：${payload.title || '未命名'} · ${payload.tags.length} 个标签 · ${payload.sections} 个小节`,
            ]),
            onSaved: (saved) => setAiLiveLogs((current) => [...current, `已改写：${saved.title}`]),
          });
          setPanelMode('detail');
          dirtyRef.current = false;
          onGeneratedEntry(entry);
          setSelectedEntryId(entry.id);
          setFreeFolder(entry.folderId ?? null);
          toast('AI 已改写知识点', 'success');
          return;
        }
        case 'rename-kb': {
          if (value === command.kb.name) return;
          await onRenameKb(command.kb.id, value);
          toast('已重命名知识库', 'success');
          return;
        }
        case 'rename-folder': {
          if (value === command.folder.name) return;
          await onRenameFolder(command.folder.id, value);
          toast('已重命名文件夹', 'success');
          return;
        }
        case 'delete-kb': {
          await deleteKbWithUndo(command.kb);
          return;
        }
        case 'delete-folder': {
          await deleteFolderWithUndo(command.folder);
          return;
        }
        case 'clear-folder': {
          await clearFolderWithUndo(command.folder);
          return;
        }
        case 'delete-entry': {
          await deleteEntryWithUndo(command.entry);
          setPanelMode('detail');
          dirtyRef.current = false;
          return;
        }
        case 'discard-edit': {
          const next = pendingGuardRef.current;
          pendingGuardRef.current = null;
          dirtyRef.current = false;
          next?.();
          return;
        }
      }
    } catch (err) {
      toast(`${commandErrorPrefix(command)}：${err instanceof Error ? err.message : String(err)}`, 'error');
      throw err;
    }
  }

  function renderCommandDialog(): ReactNode {
    if (!command) return null;
    if (command.kind === 'create-kb') {
      return (
        <CommandDialog
          open
          title="新建知识库"
          description="创建一个新的知识库入口，用于承载独立主题的文件夹和知识点。"
          inputLabel="知识库名称"
          placeholder="例如：AI Agent"
          confirmText="创建"
          onOpenChange={(open) => { if (!open) setCommand(null); }}
          onConfirm={confirmCommand}
        />
      );
    }
    if (command.kind === 'create-folder') {
      const parentLabel = command.parentId ? folderPathName(folders, command.parentId) : '知识库根层级';
      return (
        <CommandDialog
          open
          title="新建文件夹"
          description={`将创建在 ${parentLabel || '当前文件夹'} 下。`}
          inputLabel="文件夹名称"
          placeholder="例如：工作模式"
          confirmText="创建"
          helper="右键树节点也可以在指定文件夹下快速创建。"
          onOpenChange={(open) => { if (!open) setCommand(null); }}
          onConfirm={confirmCommand}
        />
      );
    }
    if (command.kind === 'generate-entry') {
      const targetLabel = command.folderId ? folderPathName(folders, command.folderId) : `${currentKb?.name ?? '当前知识库'} / 根层级`;
      return (
        <CommandDialog
          open
          title="AI 生成知识点"
          description={`将生成到 ${targetLabel || '当前位置'}。`}
          inputLabel="主题或面试题"
          placeholder="例如：ReAct 工作模式、RAG 多路召回、MCP 协议"
          helper="会自动生成知识内容、面试考点、常见追问和易错点。"
          confirmText="生成"
          icon={<Sparkles size={18} strokeWidth={2.15} />}
          liveLogs={aiLiveLogs}
          livePlan={aiLivePlan}
          livePlanLabel="公开生成思路"
          liveOutput={aiLiveOutput}
          liveOutputLabel="结构化 JSON"
          onOpenChange={(open) => {
            if (!open) {
              setCommand(null);
              setAiLiveLogs([]);
              setAiLivePlan('');
              setAiLiveOutput('');
              aiRawOutputRef.current = '';
            }
          }}
          onConfirm={confirmCommand}
        />
      );
    }
    if (command.kind === 'rewrite-entry') {
      return (
        <CommandDialog
          open
          title="AI 改写知识点"
          description={`将基于「${command.entry.title}」当前 doc 内容原地改写。`}
          helper="会保留当前知识库和文件夹，重写正文结构、面试考点、追问和易错点。"
          confirmText="开始改写"
          icon={<Sparkles size={18} strokeWidth={2.15} />}
          liveLogs={aiLiveLogs}
          livePlan={aiLivePlan}
          livePlanLabel="公开改写思路"
          liveOutput={aiLiveOutput}
          liveOutputLabel="结构化 JSON"
          onOpenChange={(open) => {
            if (!open) {
              setCommand(null);
              setAiLiveLogs([]);
              setAiLivePlan('');
              setAiLiveOutput('');
              aiRawOutputRef.current = '';
            }
          }}
          onConfirm={confirmCommand}
        />
      );
    }
    if (command.kind === 'rename-kb') {
      return (
        <CommandDialog
          open
          title="重命名知识库"
          description="名称会同步到这个知识库下的知识点分类。"
          inputLabel="知识库名称"
          initialValue={command.kb.name}
          confirmText="保存"
          onOpenChange={(open) => { if (!open) setCommand(null); }}
          onConfirm={confirmCommand}
        />
      );
    }
    if (command.kind === 'rename-folder') {
      return (
        <CommandDialog
          open
          title="重命名文件夹"
          description={folderPathName(folders, command.folder.id) || command.folder.name}
          inputLabel="文件夹名称"
          initialValue={command.folder.name}
          confirmText="保存"
          onOpenChange={(open) => { if (!open) setCommand(null); }}
          onConfirm={confirmCommand}
        />
      );
    }
    if (command.kind === 'delete-kb') {
      const entryCount = entriesOfKb(command.kb.id).length;
      const folderCount = folders.filter((folder) => folder.kbId === command.kb.id).length;
      return (
        <CommandDialog
          open
          tone="danger"
          title="删除知识库"
          description={`确定删除「${command.kb.name}」？其中包含 ${folderCount} 个文件夹、${entryCount} 条知识点。`}
          helper="此操作不可撤销，删除后需要重新导入或手动创建。"
          confirmText="删除"
          cancelText="保留"
          onOpenChange={(open) => { if (!open) setCommand(null); }}
          onConfirm={confirmCommand}
        />
      );
    }
    if (command.kind === 'delete-folder') {
      const ids = folderSubtreeIds(folders, command.folder.id);
      const childCount = Math.max(0, ids.size - 1);
      const entryCount = entries.filter((entry) => entry.folderId && ids.has(entry.folderId)).length;
      return (
        <CommandDialog
          open
          tone="danger"
          title="删除文件夹"
          description={`确定删除「${command.folder.name}」？会同时删除 ${childCount} 个子文件夹、${entryCount} 条知识点。`}
          helper="删除文件夹会连同下面的内容一起移除。"
          confirmText="删除"
          cancelText="保留"
          onOpenChange={(open) => { if (!open) setCommand(null); }}
          onConfirm={confirmCommand}
        />
      );
    }
    if (command.kind === 'clear-folder') {
      const ids = folderSubtreeIds(folders, command.folder.id);
      const childCount = Math.max(0, ids.size - 1);
      const entryCount = entries.filter((entry) => entry.folderId && ids.has(entry.folderId)).length;
      return (
        <CommandDialog
          open
          tone="danger"
          title="清空文件夹"
          description={`确定清空「${command.folder.name}」？会删除里面的 ${childCount} 个子文件夹、${entryCount} 条知识点，但保留这个文件夹本身。`}
          helper="只删除文件夹里的内容，文件夹会保留为空。"
          confirmText="清空"
          cancelText="保留"
          onOpenChange={(open) => { if (!open) setCommand(null); }}
          onConfirm={confirmCommand}
        />
      );
    }
    if (command.kind === 'delete-entry') {
      return (
        <CommandDialog
          open
          tone="danger"
          title="删除知识点"
          description={`确定删除「${command.entry.title}」？`}
          helper="删除后不会影响同一文件夹下的其他知识点。"
          confirmText="删除"
          cancelText="保留"
          onOpenChange={(open) => { if (!open) setCommand(null); }}
          onConfirm={confirmCommand}
        />
      );
    }
    return (
      <CommandDialog
        open
        tone="danger"
        title="放弃未保存修改"
        description="当前知识点还有未保存的编辑内容。"
        helper="放弃后会切换到你刚才选择的位置，未保存内容不会保留。"
        confirmText="放弃修改"
        cancelText="继续编辑"
        onOpenChange={(open) => {
          if (!open) {
            pendingGuardRef.current = null;
            setCommand(null);
          }
        }}
        onConfirm={confirmCommand}
      />
    );
  }

  // ── 知识库列表页 ──
  if (!freeKb) {
    return (
      <div style={{ padding: '20px 0 64px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 28, flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--mut)', fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase' }}>Knowledge Bases</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 7 }}>
              <span style={{ fontSize: 30, fontWeight: 840, letterSpacing: '-.02em' }}>知识库</span>
              <span style={{ fontSize: 13, color: 'var(--mut)' }}>{kbs.length} 个知识库 · {entries.length} 条知识点</span>
            </div>
          </div>
          <button className="ik-btn ik-btn-default ik-btn-size-md" onClick={newKb}>
            <span className="ik-btn-leading-icon"><Plus size={15} strokeWidth={2.4} /></span>新建知识库
          </button>
        </div>

        <div className="ik-kb-grid">
          {kbs.map((kb) => {
            const n = entriesOfKb(kb.id).length;
            const fn = folders.filter((f) => f.kbId === kb.id).length;
            return (
              <div
                className="ik-kb-card"
                key={kb.id}
                onClick={() => openKb(kb)}
              >
                <RowActions onRename={() => renameKbAction(kb)} onDelete={() => deleteKbAction(kb)} />
                <div className="ik-kb-tile"><BookOpen size={24} strokeWidth={2.05} /></div>
                <div className="ik-kb-name">{kb.name}</div>
                <div className="ik-kb-stats">
                  <span className="ik-kb-stat"><b>{fn}</b> 文件夹</span>
                  <span className="ik-kb-stat"><b>{n}</b> 知识点</span>
                </div>
                <span className="ik-kb-enter">进入<ArrowRight size={14} strokeWidth={2.3} /></span>
              </div>
            );
          })}
          <div className="ik-kb-create" onClick={newKb} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); newKb(); } }}>
            <span className="ik-kb-create-ico"><Plus size={20} strokeWidth={2.2} /></span>
            新建知识库
          </div>
        </div>
        {importPreview && (
          <ImportPreviewModal
            payload={importPreview.payload}
            preview={importPreview.preview}
            busy={importing}
            onClose={() => { if (!importing) setImportPreview(null); }}
            onConfirm={handleConfirmImport}
          />
        )}
        {renderCommandDialog()}
      </div>
    );
  }

  const editorKey = `${panelMode}:${selectedEntry?.id ?? 'new'}:${freeKb}:${freeFolder ?? 'root'}`;

  return (
    <div style={{ height: '100%', minHeight: 0, position: 'relative' }}>
      {/* 右下角悬浮操作：默认只露一个按钮，点开才展开动作 */}
      {fabOpen && <div onClick={() => setFabOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 30 }} />}
      <div className="ik-fab-wrap">
        {fabOpen && (
          <div className="ik-fab-menu">
            {selectedEntry ? (
              <>
                <button className="ik-fab-item ik-fab-item-primary" onClick={() => { setFabOpen(false); startEditEntry(); }}>
                  <span className="ik-fab-ico"><Pencil size={16} strokeWidth={2.15} /></span>编辑当前知识点
                </button>
                <button className="ik-fab-item" onClick={() => { setFabOpen(false); startCreateEntryInFolder(selectedEntry.folderId ?? null); }}>
                  <span className="ik-fab-ico"><FileText size={16} strokeWidth={2.1} /></span>新建同级知识点
                </button>
                <div className="ik-fab-sep" />
                <button className="ik-fab-item ik-fab-item-primary" onClick={() => { setFabOpen(false); startGenerateEntry(); }}>
                  <span className="ik-fab-ico"><Sparkles size={16} strokeWidth={2.15} /></span>AI 生成知识点
                </button>
                <button className="ik-fab-item ik-fab-item-primary" onClick={() => { setFabOpen(false); startRewriteEntry(); }}>
                  <span className="ik-fab-ico"><Sparkles size={16} strokeWidth={2.15} /></span>AI 改写当前知识点
                </button>
                <div className="ik-fab-sep" />
                <button className="ik-fab-item ik-fab-item-danger" onClick={() => { setFabOpen(false); deleteEntryAction(selectedEntry); }}>
                  <span className="ik-fab-ico"><Trash2 size={16} strokeWidth={2.1} /></span>删除当前知识点
                </button>
              </>
            ) : (
              <>
                <button className="ik-fab-item ik-fab-item-primary" onClick={() => { setFabOpen(false); startCreateEntry(); }}>
                  <span className="ik-fab-ico"><Plus size={16} strokeWidth={2.2} /></span>新建知识点
                </button>
                <button className="ik-fab-item ik-fab-item-primary" onClick={() => { setFabOpen(false); startGenerateEntry(); }}>
                  <span className="ik-fab-ico"><Sparkles size={16} strokeWidth={2.15} /></span>AI 生成知识点
                </button>
                <button className="ik-fab-item" onClick={() => { setFabOpen(false); newFolder(freeKb, freeFolder); }}>
                  <span className="ik-fab-ico"><FolderPlus size={16} strokeWidth={2.1} /></span>{freeFolder ? '新建子文件夹' : '新建文件夹'}
                </button>
              </>
            )}
            <div className="ik-fab-sep" />
            <label
              className={`ik-fab-item ${canImportJson ? '' : 'ik-fab-item-disabled'}`}
              onClick={(e) => {
                if (canImportJson) return;
                e.preventDefault();
                toast('请先进入一个知识库，再导入 JSON', 'info');
              }}
            >
              <span className="ik-fab-ico"><Upload size={16} strokeWidth={2.1} /></span>导入到当前位置
              <input disabled={!canImportJson} type="file" accept="application/json" onChange={(e) => { setFabOpen(false); handleImport(e); }} style={{ display: 'none' }} />
            </label>
            <button className="ik-fab-item" onClick={() => { setFabOpen(false); handleExport(); }}>
              <span className="ik-fab-ico"><Download size={16} strokeWidth={2.1} /></span>导出全部
            </button>
          </div>
        )}
        <button className="ik-fab" title="操作" onClick={() => setFabOpen((v) => !v)}>
          {fabOpen ? <X size={22} strokeWidth={2.25} /> : <Plus size={23} strokeWidth={2.25} />}
        </button>
      </div>

      <div className="ik-free-layout">
        <aside className="ik-surface" style={treePanelStyle}>
          <div style={{ padding: '12px 16px 10px', borderBottom: '1px solid var(--bd)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
              <button
                type="button"
                className={`ik-location-chip ik-location-chip-button ${freeFolder === null && !selectedEntryId ? 'is-active' : ''}`}
                onClick={selectRoot}
                title={`${operationPathLabel} · 点击回到知识库根层级`}
              >
                {operationPathLabel}
              </button>
              <div style={{ fontSize: 11.5, color: 'var(--mut)', border: '1px solid var(--bd)', borderRadius: 999, padding: '4px 8px', whiteSpace: 'nowrap' }}>
                {folders.filter((folder) => folder.kbId === freeKb).length} / {kbEntries.length}
              </div>
            </div>
          </div>

          <div style={{ padding: 10, overflow: 'hidden', flex: 1, minHeight: 0 }}>
            <KnowledgeTree
              kbId={freeKb}
              folders={folders.filter((folder) => folder.kbId === freeKb)}
              entries={kbEntries}
              selectedFolderId={freeFolder}
              selectedEntryId={selectedEntryId}
              folderEntryCount={folderEntryCount}
              onSelectFolder={selectFolder}
              onSelectEntry={selectEntry}
              onCreateFolder={(parentId) => newFolder(freeKb, parentId)}
              onCreateEntry={startCreateEntryInFolder}
              onRenameFolder={renameFolderAction}
              onDeleteFolder={deleteFolderAction}
              onClearFolder={clearFolderAction}
              onImportToFolder={importToFolder}
              onEditEntry={editEntryAction}
              onDeleteEntry={deleteEntryAction}
              onDeleteBatch={deleteSelectionWithUndo}
              onMoveFolder={onMoveFolder}
              onReorderFolders={onReorderFolders}
              onMoveEntry={moveEntryAction}
              onReorderEntries={onReorderEntries}
            />
          </div>
        </aside>

        <div style={{ minWidth: 0, minHeight: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div className="ik-detail-region">
            {panelMode === 'create' ? (
              <EntryEditor
                key={editorKey}
                initial={null}
                kbs={kbs}
                folders={folders}
                defaultKbId={freeKb}
                defaultFolderId={freeFolder}
                onDirtyChange={onDirtyChange}
                onCancel={backToDetail}
                onSave={(input) =>
                  onCreate(input).then((entry) => {
                    setPanelMode('detail');
                    dirtyRef.current = false;
                    setSelectedEntryId(entry.id);
                    setFreeFolder(entry.folderId ?? null);
                    return entry;
                  })
                }
              />
            ) : panelMode === 'edit' && selectedEntry ? (
              <EntryEditor
                key={editorKey}
                initial={selectedEntry}
                kbs={kbs}
                folders={folders}
                onDirtyChange={onDirtyChange}
                onCancel={backToDetail}
                onSave={(input) =>
                  onUpdate(selectedEntry.id, input).then((entry) => {
                    setPanelMode('detail');
                    dirtyRef.current = false;
                    setSelectedEntryId(entry.id);
                    setFreeFolder(entry.folderId ?? null);
                    return entry;
                  })
                }
              />
            ) : (
              <div className="ik-detail-shell">
                <DetailSidePanel
                  entry={selectedEntry}
                  query=""
                  contextLabel={viewingPathLabel}
                  actions={selectedEntry ? (
                    <>
                      <button type="button" className="ik-segbtn" onClick={startRewriteEntry}>
                        <Sparkles size={14} strokeWidth={2.15} />改写
                      </button>
                      <button type="button" className="ik-segbtn" onClick={startEditEntry}>
                        <Pencil size={14} strokeWidth={2.15} />编辑
                      </button>
                      <button type="button" className="ik-segbtn ik-segbtn-danger" onClick={deleteSelectedEntry}>
                        <Trash2 size={14} strokeWidth={2.15} />删除
                      </button>
                    </>
                  ) : null}
                />
              </div>
            )}
          </div>
        </div>
      </div>
      {importPreview && (
        <ImportPreviewModal
          payload={importPreview.payload}
          preview={importPreview.preview}
          busy={importing}
          previewing={previewingImport}
          targetFolders={importFolderOptions}
          targetFolderId={importPreview.payload.targetFolderId}
          allowReplace={false}
          onTargetFolderChange={(folderId) => refreshImportPreview({ ...importPreview.payload, targetFolderId: folderId === ROOT_IMPORT_TARGET ? null : folderId })}
          onClose={() => { if (!importing && !previewingImport) setImportPreview(null); }}
          onConfirm={handleConfirmImport}
        />
      )}
      {renderCommandDialog()}
      {/* 右键文件夹导入用的隐藏文件选择器 */}
      <input
        ref={importInputRef}
        type="file"
        accept="application/json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const folderId = pendingImportFolderRef.current;
          pendingImportFolderRef.current = undefined;
          handleImport(e, folderId);
        }}
      />
    </div>
  );
}
