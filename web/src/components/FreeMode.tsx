import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { Entry, EntryInput, Folder, KnowledgeBase } from '../types';
import { folderSubtreeIds, forestOfKb, type FolderNode } from '../tree';
import DetailSidePanel from './DetailSidePanel';
import EntryEditor from './EntryEditor';
import ImportPreviewModal from './ImportPreviewModal';
import { exportAll, importAll, previewImport, type ImportPayload, type ImportPreview } from '../api';
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
  onImported: (entries: Entry[], kbs: KnowledgeBase[], folders: Folder[]) => void;
  onCreateKb: (name: string) => Promise<KnowledgeBase>;
  onCreateFolder: (input: { kbId: string; parentId?: string | null; name: string }) => Promise<Folder>;
  onRenameKb: (id: string, name: string) => Promise<void>;
  onDeleteKb: (id: string) => Promise<void>;
  onRenameFolder: (id: string, name: string) => Promise<void>;
  onDeleteFolder: (id: string) => Promise<void>;
}

const cardStyle: CSSProperties = {
  padding: 18,
  background: 'var(--panel)',
  border: '1px solid var(--bd)',
  borderRadius: 10,
  cursor: 'pointer',
  position: 'relative',
  minHeight: 148,
  boxShadow: '0 16px 34px rgba(0,0,0,.045)',
};

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
  gap: 16,
};

const actBtn: CSSProperties = {
  padding: '10px 18px',
  fontSize: 13,
  fontFamily: 'inherit',
  cursor: 'pointer',
  background: 'var(--fg)',
  color: 'var(--bg)',
  border: 'none',
  borderRadius: 8,
  fontWeight: 680,
  boxShadow: '0 12px 28px rgba(0,0,0,.16)',
};

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
  position: 'sticky',
  top: 92,
  height: 'calc(100vh - 112px)',
  minHeight: 620,
  overflow: 'hidden',
  border: '1px solid var(--bd)',
  borderRadius: 12,
  background: 'var(--panel)',
  boxShadow: '0 22px 56px rgba(0,0,0,.065)',
  display: 'flex',
  flexDirection: 'column',
};

const treeRowBase: CSSProperties = {
  position: 'relative',
  display: 'grid',
  gridTemplateColumns: '18px minmax(0, 1fr) auto',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  minHeight: 42,
  padding: '9px 66px 9px 11px',
  border: '1px solid transparent',
  borderRadius: 9,
  cursor: 'pointer',
  color: 'var(--fg)',
};

function hoverOn(e: React.MouseEvent<HTMLDivElement>): void { e.currentTarget.style.borderColor = 'var(--mut)'; }
function hoverOff(e: React.MouseEvent<HTMLDivElement>): void { e.currentTarget.style.borderColor = 'var(--bd)'; }

function orderEntries(list: Entry[]): Entry[] {
  return [...list].sort((a, b) =>
    (a.sort ?? 0) - (b.sort ?? 0)
    || (a.createdAt ?? 0) - (b.createdAt ?? 0)
    || a.title.localeCompare(b.title, 'zh-Hans-CN'),
  );
}

function activateOnKeyboard(e: React.KeyboardEvent<HTMLDivElement>, action: () => void): void {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  action();
}

// 卡片 / 树节点右侧的轻量操作按钮
function RowActions({ onRename, onDelete }: { onRename: () => void; onDelete: () => void }): ReactNode {
  return (
    <div className="ik-row-actions">
      <button type="button" title="重命名" className="ik-row-action-btn" onClick={(e) => { e.stopPropagation(); onRename(); }}>✎</button>
      <button type="button" title="删除" className="ik-row-action-btn ik-row-action-danger" onClick={(e) => { e.stopPropagation(); onDelete(); }}>✕</button>
    </div>
  );
}

export default function FreeMode(props: Props): ReactNode {
  const { entries, kbs, folders, freeKb, freeFolder, setFreeKb, setFreeFolder, onNew,
    onCreate, onUpdate, onDelete, onImported,
    onCreateKb, onCreateFolder, onRenameKb, onDeleteKb, onRenameFolder, onDeleteFolder } = props;

  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [panelMode, setPanelMode] = useState<'detail' | 'create' | 'edit'>('detail');
  const [importPreview, setImportPreview] = useState<{ payload: ImportPayload; preview: ImportPreview } | null>(null);
  const [importing, setImporting] = useState(false);
  const dirtyRef = useRef(false);

  const entriesOfKb = useMemo(() => (kbId: string) => orderEntries(entries.filter((e) => e.kbId === kbId)), [entries]);
  const currentKb = kbs.find((k) => k.id === freeKb) ?? null;
  const kbEntries = useMemo(() => (freeKb ? entriesOfKb(freeKb) : []), [entriesOfKb, freeKb]);
  const selectedEntry = useMemo(
    () => kbEntries.find((entry) => entry.id === selectedEntryId) ?? null,
    [kbEntries, selectedEntryId],
  );
  const folderForest = useMemo(() => (freeKb ? forestOfKb(folders, freeKb) : []), [folders, freeKb]);
  const entriesByFolder = useMemo(() => {
    const map = new Map<string | null, Entry[]>();
    for (const entry of kbEntries) {
      const key = entry.folderId ?? null;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(entry);
    }
    return map;
  }, [kbEntries]);
  useEffect(() => {
    if (!freeKb) {
      if (selectedEntryId) setSelectedEntryId(null);
      if (panelMode !== 'detail') setPanelMode('detail');
      return;
    }
    if (selectedEntryId && kbEntries.some((entry) => entry.id === selectedEntryId)) return;
    setSelectedEntryId(kbEntries[0]?.id ?? null);
  }, [freeKb, kbEntries, panelMode, selectedEntryId]);

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
      if (!window.confirm('当前知识点有未保存的修改，放弃修改？')) return;
      dirtyRef.current = false;
    }
    next();
  }

  // ── 新建操作 ──
  function newKb(): void {
    const name = window.prompt('新建知识库名称：');
    if (!name?.trim()) return;
    onCreateKb(name.trim()).catch((err) => toast('新建失败：' + (err instanceof Error ? err.message : String(err)), 'error'));
  }
  function newFolder(kbId: string, parentId: string | null): void {
    const name = window.prompt('新建文件夹名称：');
    if (!name?.trim()) return;
    onCreateFolder({ kbId, parentId, name: name.trim() }).catch((err) => toast('新建失败：' + (err instanceof Error ? err.message : String(err)), 'error'));
  }
  function renameKbAction(kb: KnowledgeBase): void {
    const next = window.prompt(`重命名知识库「${kb.name}」为：`, kb.name);
    if (!next?.trim() || next.trim() === kb.name) return;
    onRenameKb(kb.id, next.trim()).catch((err) => toast('重命名失败：' + (err instanceof Error ? err.message : String(err)), 'error'));
  }
  function deleteKbAction(kb: KnowledgeBase): void {
    const n = entriesOfKb(kb.id).length;
    if (!window.confirm(`确定删除知识库「${kb.name}」及其下 ${n} 条知识点与全部文件夹？此操作不可撤销。`)) return;
    onDeleteKb(kb.id).catch((err) => toast('删除失败：' + (err instanceof Error ? err.message : String(err)), 'error'));
  }
  function renameFolderAction(folder: Folder): void {
    const next = window.prompt(`重命名文件夹「${folder.name}」为：`, folder.name);
    if (!next?.trim() || next.trim() === folder.name) return;
    onRenameFolder(folder.id, next.trim()).catch((err) => toast('重命名失败：' + (err instanceof Error ? err.message : String(err)), 'error'));
  }
  function deleteFolderAction(folder: Folder): void {
    if (!window.confirm(`确定删除文件夹「${folder.name}」及其下全部子文件夹与知识点？此操作不可撤销。`)) return;
    onDeleteFolder(folder.id).catch((err) => toast('删除失败：' + (err instanceof Error ? err.message : String(err)), 'error'));
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

  function handleImport(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(reader.result));
      } catch (err) {
        toast('文件解析失败：' + (err instanceof Error ? err.message : String(err)), 'error');
        return;
      }
      const obj = parsed as { version?: string; meta?: unknown; tree?: unknown[] };
      if (!Array.isArray(obj?.tree) || obj.tree.length === 0) {
        toast('文件中没有 tree 数组，当前只支持 knowledge-tree-v1', 'error');
        return;
      }
      const currentKb = freeKb ? kbs.find((kb) => kb.id === freeKb) : null;
      const payload: ImportPayload = {
        version: obj.version,
        meta: obj.meta,
        tree: obj.tree,
        targetKbId: currentKb?.id,
        targetKbName: currentKb?.name,
      };
      previewImport(payload)
        .then((preview) => setImportPreview({ payload, preview }))
        .catch((err) => toast('解析失败：' + (err instanceof Error ? err.message : String(err)), 'error'));
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  async function handleConfirmImport(replace: boolean): Promise<void> {
    if (!importPreview) return;
    const { payload, preview } = importPreview;
    setImporting(true);
    try {
      const next = await importAll(payload, replace);
      onImported(next.entries, next.kbs, next.folders);
      toast(`已${replace ? '替换' : '合并'}导入 ${preview.valid} 条知识点`, 'success');
      setImportPreview(null);
      setPanelMode('detail');
    } catch (err) {
      toast('导入失败：' + (err instanceof Error ? err.message : String(err)), 'error');
    } finally {
      setImporting(false);
    }
  }

  function startCreateEntry(): void {
    if (!freeKb) {
      onNew();
      return;
    }
    guardPanel(() => {
      setPanelMode('create');
      dirtyRef.current = false;
    });
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
    if (!window.confirm(`确定删除知识点「${selectedEntry.title}」？此操作不可撤销。`)) return;
    onDelete(selectedEntry.id)
      .then(() => {
        setPanelMode('detail');
        dirtyRef.current = false;
      })
      .catch((err) => toast('删除失败：' + (err instanceof Error ? err.message : String(err)), 'error'));
  }

  function openKb(kb: KnowledgeBase): void {
    setFreeKb(kb.id);
    setFreeFolder(null);
    setCollapsedFolders(new Set());
    setSelectedEntryId(entriesOfKb(kb.id)[0]?.id ?? null);
    setPanelMode('detail');
    dirtyRef.current = false;
  }

  function backToKbList(): void {
    guardPanel(() => {
      setFreeKb(null);
      setFreeFolder(null);
      setSelectedEntryId(null);
      setCollapsedFolders(new Set());
      setPanelMode('detail');
      dirtyRef.current = false;
    });
  }

  function toggleFolder(folderId: string): void {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }

  function folderEntryCount(folderId: string): number {
    const ids = folderSubtreeIds(folders, folderId);
    return kbEntries.filter((entry) => entry.folderId && ids.has(entry.folderId)).length;
  }

  function renderEntryRow(entry: Entry, depth: number): ReactNode {
    const active = entry.id === selectedEntryId;
    const action = (): void => {
      guardPanel(() => {
        setSelectedEntryId(entry.id);
        setFreeFolder(entry.folderId ?? null);
        setPanelMode('detail');
        dirtyRef.current = false;
      });
    };

    return (
      <div
        className="ik-tree-row"
        key={entry.id}
        role="button"
        tabIndex={0}
        onClick={action}
        onKeyDown={(e) => activateOnKeyboard(e, action)}
        style={{
          ...treeRowBase,
          gridTemplateColumns: '18px minmax(0, 1fr) auto',
          marginTop: 4,
          marginLeft: depth * 18,
          width: `calc(100% - ${depth * 18}px)`,
          background: active ? 'var(--sel)' : 'transparent',
          borderColor: active ? 'var(--bd)' : 'transparent',
          paddingRight: 10,
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: 99, background: active ? 'var(--fg)' : 'var(--mut)', justifySelf: 'center', opacity: active ? 0.9 : 0.45 }} />
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 13.5, fontWeight: active ? 760 : 620, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {entry.title}
          </span>
          {entry.summary && (
            <span style={{ display: 'block', marginTop: 2, fontSize: 11.5, color: 'var(--mut)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {entry.summary}
            </span>
          )}
        </span>
        <span style={{ fontSize: 10.5, color: 'var(--mut)' }}>知识点</span>
      </div>
    );
  }

  function renderFolderNode(node: FolderNode, depth = 0): ReactNode {
    const { folder, children } = node;
    const directEntries = entriesByFolder.get(folder.id) ?? [];
    const collapsed = collapsedFolders.has(folder.id);
    const totalEntries = folderEntryCount(folder.id);
    const subFolderCount = Math.max(folderSubtreeIds(folders, folder.id).size - 1, 0);
    const metaText = `${subFolderCount} 文件夹 · ${totalEntries} 知识点`;
    const hasChildren = children.length > 0 || directEntries.length > 0;
    const selected = freeFolder === folder.id;
    const action = (): void => {
      guardPanel(() => {
        setFreeFolder(folder.id);
        if (hasChildren) toggleFolder(folder.id);
      });
    };

    return (
      <div key={folder.id}>
        <div
          className="ik-tree-row"
          role="button"
          tabIndex={0}
          title={metaText}
          onClick={action}
          onKeyDown={(e) => activateOnKeyboard(e, action)}
          style={{
            ...treeRowBase,
            marginTop: 4,
            marginLeft: depth * 18,
            width: `calc(100% - ${depth * 18}px)`,
            background: selected ? 'var(--sel)' : 'transparent',
            borderColor: selected ? 'var(--bd)' : 'transparent',
          }}
        >
          <span style={{ color: 'var(--mut)', fontSize: 12, transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)', transition: 'transform .14s ease', textAlign: 'center' }}>
            {hasChildren ? '›' : '·'}
          </span>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 13.5, fontWeight: 720, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              📁 {folder.name}
            </span>
            <span className="ik-tree-meta">
              {metaText}
            </span>
          </span>
          <RowActions onRename={() => renameFolderAction(folder)} onDelete={() => deleteFolderAction(folder)} />
        </div>

        {!collapsed && hasChildren && (
          <div>
            {children.map((child) => renderFolderNode(child, depth + 1))}
            {directEntries.map((entry) => renderEntryRow(entry, depth + 1))}
          </div>
        )}
      </div>
    );
  }

  // ── 知识库列表页 ──
  if (!freeKb) {
    return (
      <div style={{ padding: '14px 0 64px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{ fontSize: 24, fontWeight: 820, letterSpacing: '0' }}>知识库</span>
            <span style={{ fontSize: 12.5, color: 'var(--mut)' }}>{kbs.length} 个知识库</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={ghostBtn} onClick={handleExport}>导出</button>
            <label style={{ ...ghostBtn, display: 'inline-flex', alignItems: 'center' }}>
              导入
              <input type="file" accept="application/json" onChange={handleImport} style={{ display: 'none' }} />
            </label>
            <button style={ghostBtn} onClick={newKb}>＋ 新建知识库</button>
            <button style={actBtn} onClick={onNew}>＋ 新建知识点</button>
          </div>
        </div>

        {kbs.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--mut)', fontSize: 13 }}>
            还没有知识库，点击「＋ 新建知识库」开始。
          </div>
        ) : (
          <div style={gridStyle}>
            {kbs.map((kb) => {
              const n = entriesOfKb(kb.id).length;
              const fn = folders.filter((f) => f.kbId === kb.id).length;
              return (
                <div
                  className="ik-kb-card"
                  key={kb.id}
                  style={cardStyle}
                  onMouseEnter={hoverOn}
                  onMouseLeave={hoverOff}
                  onClick={() => openKb(kb)}
                >
                  <RowActions onRename={() => renameKbAction(kb)} onDelete={() => deleteKbAction(kb)} />
                  <div style={{ fontSize: 23, marginBottom: 16 }}>📚</div>
                  <div style={{ fontSize: 18, fontWeight: 780, marginBottom: 8, letterSpacing: '0' }}>{kb.name}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--mut)' }}>
                    {fn} 个文件夹 · {n} 条知识点
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {importPreview && (
          <ImportPreviewModal
            payload={importPreview.payload}
            preview={importPreview.preview}
            busy={importing}
            onClose={() => { if (!importing) setImportPreview(null); }}
            onConfirm={handleConfirmImport}
          />
        )}
      </div>
    );
  }

  const rootEntries = entriesByFolder.get(null) ?? [];
  const editorKey = `${panelMode}:${selectedEntry?.id ?? 'new'}:${freeKb}:${freeFolder ?? 'root'}`;

  return (
    <div style={{ padding: '0 0 64px' }}>
      <div className="ik-floating-toolbar">
        <button style={{ ...ghostBtn, minWidth: 42, padding: '10px 12px' }} title="返回全部知识库" onClick={backToKbList}>‹</button>
        <button style={ghostBtn} onClick={() => guardPanel(() => setFreeFolder(null))}>根目录</button>
        <button style={ghostBtn} onClick={handleExport}>导出</button>
        <label style={{ ...ghostBtn, display: 'inline-flex', alignItems: 'center' }}>
          导入
          <input type="file" accept="application/json" onChange={handleImport} style={{ display: 'none' }} />
        </label>
        <button style={ghostBtn} onClick={() => newFolder(freeKb, freeFolder)}>＋ 新建文件夹</button>
        <button style={actBtn} onClick={startCreateEntry}>＋ 新建知识点</button>
      </div>

      <div className="ik-free-layout">
        <aside style={treePanelStyle}>
          <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid var(--bd)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 12, color: 'var(--mut)', letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 760 }}>文件夹 / 知识点</div>
                <div style={{ marginTop: 5, fontSize: 14.5, fontWeight: 760 }}>{currentKb?.name ?? '知识库'}</div>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--mut)', border: '1px solid var(--bd)', borderRadius: 999, padding: '4px 8px', whiteSpace: 'nowrap' }}>
                {folders.filter((folder) => folder.kbId === freeKb).length} / {kbEntries.length}
              </div>
            </div>
          </div>

          <div style={{ padding: 10, overflow: 'auto', flex: 1 }}>
            <div
              className="ik-tree-row"
              role="button"
              tabIndex={0}
              title={`${folderForest.length} 文件夹 · ${rootEntries.length} 知识点`}
              onClick={() => setFreeFolder(null)}
              onKeyDown={(e) => activateOnKeyboard(e, () => setFreeFolder(null))}
              style={{
                ...treeRowBase,
                gridTemplateColumns: '18px minmax(0, 1fr)',
                background: freeFolder ? 'transparent' : 'var(--sel)',
                borderColor: freeFolder ? 'transparent' : 'var(--bd)',
              }}
            >
              <span style={{ color: 'var(--mut)', textAlign: 'center' }}>⌂</span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13.5, fontWeight: 760, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>根目录</span>
                <span className="ik-tree-meta">
                  {folderForest.length} 文件夹 · {rootEntries.length} 知识点
                </span>
              </span>
            </div>

            {folderForest.length > 0 && (
              <div style={{ marginTop: 8 }}>
                {folderForest.map((node) => renderFolderNode(node))}
              </div>
            )}

            {rootEntries.length > 0 && (
              <div style={{ marginTop: 8 }}>
                {rootEntries.map((entry) => renderEntryRow(entry, 0))}
              </div>
            )}

            {folderForest.length === 0 && rootEntries.length === 0 && (
              <div style={{ margin: '18px 8px', padding: 18, textAlign: 'center', color: 'var(--mut)', fontSize: 13, border: '1px dashed var(--bd)', borderRadius: 14 }}>
                当前知识库还没有文件夹或知识点。
              </div>
            )}
          </div>
        </aside>

        <div style={{ minWidth: 0 }}>
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
              <div className="ik-detail-actions">
                <button
                  className="ik-detail-action-btn"
                  onClick={startEditEntry}
                  disabled={!selectedEntry}
                >
                  编辑
                </button>
                <button
                  className="ik-detail-action-btn ik-detail-action-danger"
                  onClick={deleteSelectedEntry}
                  disabled={!selectedEntry}
                >
                  删除
                </button>
              </div>
              <DetailSidePanel entry={selectedEntry} query="" />
            </div>
          )}
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
    </div>
  );
}
