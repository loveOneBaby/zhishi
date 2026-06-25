import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Pencil, Sparkles, Trash2 } from 'lucide-react';
import type { Entry, EntryInput, Folder, KnowledgeBase } from '../types';
import { folderChain, folderPathName, folderSubtreeIds } from '../tree';
import DetailSidePanel from './DetailSidePanel';
import EntryEditor from './EntryEditor';
import ImportPreviewModal from './ImportPreviewModal';
import KnowledgeTree from './KnowledgeTree';
import type { SelectOption } from './SelectField';
import { exportAll } from '../api';
import { toast } from '../toast';
import { KbGallery } from './free/KbGallery';
import { FreeFab } from './free/FreeFab';
import { ROOT_IMPORT_TARGET, orderEntries, treePanelStyle } from './free/utils';
import { useAiLiveOutput } from './free/useAiLiveOutput';
import { useUndoableDeletes } from './free/useUndoableDeletes';
import { useImportLogic } from './free/useImportLogic';
import { useCommandSystem } from './free/useCommandSystem';
import { CommandDialogRenderer } from './free/CommandDialogRenderer';

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
  onStartKnowledgeBaseJob: (domain: string) => Promise<void>;
  onStartFolderInitJob: (input: { kbId: string; parentId?: string | null; domain?: string }) => Promise<void>;
  onCreateKb: (name: string) => Promise<KnowledgeBase>;
  onCreateFolder: (input: { kbId: string; parentId?: string | null; name: string }) => Promise<Folder>;
  onRenameKb: (id: string, name: string) => Promise<void>;
  onDeleteKb: (id: string) => Promise<void>;
  onRenameFolder: (id: string, name: string) => Promise<void>;
  onDeleteFolder: (id: string) => Promise<void>;
  onMoveFolder: (id: string, opts: { parentId?: string | null; kbId?: string }) => Promise<void>;
  onReorderFolders: (ids: string[]) => Promise<void>;
}

export default function FreeMode(props: Props): ReactNode {
  const { entries, kbs, folders, freeKb, freeFolder, setFreeKb, setFreeFolder, onNew,
    onCreate, onUpdate, onDelete, onImported, onGeneratedEntry, onStartKnowledgeBaseJob, onStartFolderInitJob,
    onCreateKb, onCreateFolder, onRenameKb, onDeleteKb, onRenameFolder, onDeleteFolder, onMoveFolder, onReorderFolders, onReorderEntries } = props;

  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(() => localStorage.getItem('ik_free_entry') || null);
  const [panelMode, setPanelMode] = useState<'detail' | 'create' | 'edit'>('detail');
  const [fabOpen, setFabOpen] = useState(false);
  const dirtyRef = useRef(false);
  const pendingGuardRef = useRef<(() => void) | null>(null);

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

  const aiLive = useAiLiveOutput();
  const deletes = useUndoableDeletes({
    entries, folders, freeFolder, selectedEntryId, currentKb,
    onImported, onDeleteKb, onDeleteFolder, onDelete,
    setFreeKb, setFreeFolder, setSelectedEntryId, setPanelMode, dirtyRef,
  });
  const importLogic = useImportLogic({
    freeKb, kbs, freeFolder, canImportJson, onImported, setFreeFolder, setPanelMode,
  });
  const { command, setCommand, confirmCommand } = useCommandSystem({
    aiLive, deletes, onCreateKb, onStartKnowledgeBaseJob, onStartFolderInitJob,
    onCreateFolder, onRenameKb, onRenameFolder, onGeneratedEntry,
    setSelectedEntryId, setFreeFolder, setPanelMode, dirtyRef, pendingGuardRef,
  });

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
  function startGenerateKnowledgeBase(): void {
    aiLive.resetAiLive();
    setCommand({ kind: 'generate-kb' });
  }
  function startInitFolders(parentId?: string | null): void {
    if (!currentKb) {
      toast('请先进入一个知识库，再初始化目录', 'info');
      return;
    }
    const targetParentId = parentId !== undefined ? parentId : (selectedEntry?.folderId ?? freeFolder ?? null);
    const targetLabel = targetParentId ? folderPathName(folders, targetParentId) : `${currentKb.name} / 根层级`;
    setCommand({
      kind: 'init-folders',
      kbId: currentKb.id,
      parentId: targetParentId,
      kbName: currentKb.name,
      targetLabel: targetLabel || '当前位置',
    });
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
    aiLive.resetAiLive();
    setCommand({ kind: 'generate-entry', kbId: freeKb, folderId });
  }

  function startRewriteEntry(): void {
    if (!selectedEntry) {
      toast('请先选择一个知识点', 'info');
      return;
    }
    aiLive.resetAiLive();
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

  const commandDialog = (
    <CommandDialogRenderer
      command={command}
      folders={folders}
      entries={entries}
      entriesOfKb={entriesOfKb}
      currentKb={currentKb}
      aiLiveLogs={aiLive.aiLiveLogs}
      aiLivePlan={aiLive.aiLivePlan}
      aiLiveOutput={aiLive.aiLiveOutput}
      onSetCommand={setCommand}
      onResetAiLive={aiLive.resetAiLive}
      pendingGuardRef={pendingGuardRef}
      onConfirm={confirmCommand}
    />
  );

  // ── 知识库列表页 ──
  if (!freeKb) {
    return (
      <KbGallery
        kbs={kbs}
        entries={entries}
        folders={folders}
        entriesOfKb={entriesOfKb}
        startGenerateKnowledgeBase={startGenerateKnowledgeBase}
        newKb={newKb}
        openKb={openKb}
        renameKbAction={renameKbAction}
        deleteKbAction={deleteKbAction}
        importPreview={importLogic.importPreview}
        importing={importLogic.importing}
        onCloseImportPreview={() => { if (!importLogic.importing) importLogic.setImportPreview(null); }}
        handleConfirmImport={importLogic.handleConfirmImport}
        commandDialog={commandDialog}
      />
    );
  }

  const editorKey = `${panelMode}:${selectedEntry?.id ?? 'new'}:${freeKb}:${freeFolder ?? 'root'}`;

  return (
    <div style={{ height: '100%', minHeight: 0, position: 'relative' }}>
      {/* 右下角悬浮操作：默认只露一个按钮，点开才展开动作 */}
      <FreeFab
        fabOpen={fabOpen}
        setFabOpen={setFabOpen}
        selectedEntry={selectedEntry}
        freeKb={freeKb}
        freeFolder={freeFolder}
        canImportJson={canImportJson}
        startEditEntry={startEditEntry}
        startCreateEntryInFolder={startCreateEntryInFolder}
        startGenerateEntry={startGenerateEntry}
        startInitFolders={startInitFolders}
        startRewriteEntry={startRewriteEntry}
        deleteEntryAction={deleteEntryAction}
        startCreateEntry={startCreateEntry}
        newFolder={newFolder}
        handleImport={importLogic.handleImport}
        handleExport={handleExport}
      />

      <div className="ik-free-layout">
        <aside className="ik-surface ik-tree-panel" style={treePanelStyle}>
          <div className="ik-tree-panel-head">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
              <button
                type="button"
                className={`ik-location-chip ik-location-chip-button ${freeFolder === null && !selectedEntryId ? 'is-active' : ''}`}
                onClick={selectRoot}
                title={`${operationPathLabel} · 点击回到知识库根层级`}
              >
                {operationPathLabel}
              </button>
              <div className="ik-tree-panel-counter">
                {folders.filter((folder) => folder.kbId === freeKb).length} / {kbEntries.length}
              </div>
            </div>
          </div>

          <div className="ik-tree-panel-body">
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
              onImportToFolder={importLogic.importToFolder}
              onEditEntry={editEntryAction}
              onDeleteEntry={deleteEntryAction}
              onDeleteBatch={deletes.deleteSelectionWithUndo}
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
      {importLogic.importPreview && (
        <ImportPreviewModal
          payload={importLogic.importPreview.payload}
          preview={importLogic.importPreview.preview}
          busy={importLogic.importing}
          previewing={importLogic.previewingImport}
          targetFolders={importFolderOptions}
          targetFolderId={importLogic.importPreview.payload.targetFolderId}
          allowReplace={false}
          onTargetFolderChange={(folderId) => {
            if (importLogic.importPreview) importLogic.refreshImportPreview({ ...importLogic.importPreview.payload, targetFolderId: folderId === ROOT_IMPORT_TARGET ? null : folderId });
          }}
          onClose={() => { if (!importLogic.importing && !importLogic.previewingImport) importLogic.setImportPreview(null); }}
          onConfirm={importLogic.handleConfirmImport}
        />
      )}
      {commandDialog}
      {/* 右键文件夹导入用的隐藏文件选择器 */}
      <input
        ref={importLogic.importInputRef}
        type="file"
        accept="application/json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const folderId = importLogic.pendingImportFolderRef.current;
          importLogic.pendingImportFolderRef.current = undefined;
          importLogic.handleImport(e, folderId);
        }}
      />
    </div>
  );
}
