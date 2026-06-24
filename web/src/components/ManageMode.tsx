import { useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { Entry, EntryInput, KnowledgeBase, Folder } from '../types';
import { folderPathName, folderSubtreeIds } from '../tree';
import { matchesQuery, toSearchText } from '../pinyin-search';
import EntryEditor from './EntryEditor';
import ImportPreviewModal from './ImportPreviewModal';
import { exportAll, importAll, previewImport, type ImportPayload, type ImportPreview } from '../api';
import { toast } from '../toast';

interface Props {
  entries: Entry[];
  kbs: KnowledgeBase[];
  folders: Folder[];
  onCreate: (input: EntryInput) => Promise<Entry>;
  onUpdate: (id: string, input: EntryInput) => Promise<Entry>;
  onDelete: (id: string) => Promise<void>;
  onReorder: (ids: string[]) => Promise<void>;
  onImported: (entries: Entry[], kbs: KnowledgeBase[], folders: Folder[]) => void;
  onCreateKb: (name: string) => Promise<KnowledgeBase>;
  onRenameKb: (id: string, name: string) => Promise<void>;
  onDeleteKb: (id: string) => Promise<void>;
  onCreateFolder: (input: { kbId: string; parentId?: string | null; name: string }) => Promise<Folder>;
  onRenameFolder: (id: string, name: string) => Promise<void>;
  onMoveFolder: (id: string, opts: { parentId?: string | null; kbId?: string }) => Promise<void>;
  onDeleteFolder: (id: string) => Promise<void>;
  topOffset?: number;
}

const cardStyle: CSSProperties = {
  border: '1px solid var(--bd)',
  borderRadius: 14,
  background: 'var(--panel)',
};

const iconBtn: CSSProperties = {
  padding: '3px 8px',
  border: '1px solid var(--bd)',
  borderRadius: 8,
  background: 'var(--bg)',
  color: 'var(--mut)',
  cursor: 'pointer',
  fontSize: 12,
};

const menuItemStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '7px 10px',
  border: 'none',
  background: 'transparent',
  color: 'var(--fg)',
  cursor: 'pointer',
  fontSize: 13,
};

const menuBoxStyle: CSSProperties = {
  margin: '2px 22px 6px',
  border: '1px solid var(--bd)',
  borderRadius: 8,
  background: 'var(--bg)',
  boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
  overflow: 'hidden',
};

function entryIndexText(e: Entry): string {
  const parts: string[] = [e.intro];
  const walk = (nodes: Entry['nodes']): void => {
    for (const node of nodes) {
      parts.push(node.title, node.content);
      walk(node.children);
    }
  };
  walk(e.nodes);
  return parts.filter(Boolean).join(' ');
}

function matches(e: Entry, q: string, folders: Folder[]): boolean {
  if (!q) return true;
  return matchesQuery(
    toSearchText(
      e.title,
      e.summary,
      e.py,
      e.tags.join(' '),
      e.cat,
      folderPathName(folders, e.folderId),
      entryIndexText(e)
    ),
    q
  );
}

export default function ManageMode(props: Props): ReactNode {
  const {
    entries,
    kbs,
    folders,
    onCreate,
    onUpdate,
    onDelete,
    onReorder,
    onImported,
    onCreateKb,
    onRenameKb,
    onDeleteKb,
    onCreateFolder,
    onRenameFolder,
    onMoveFolder,
    onDeleteFolder,
    topOffset = 60,
  } = props;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // 新建知识点时的默认归属（知识库 / 文件夹）
  const [createKbId, setCreateKbId] = useState<string>('');
  const [createFolderId, setCreateFolderId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  // ⋯ 菜单当前打开的节点 key（kb:<id> / fld:<id>）
  const [menuId, setMenuId] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<{ payload: ImportPayload; preview: ImportPreview } | null>(null);
  const [importing, setImporting] = useState(false);
  const dirtyRef = useRef(false);

  const searching = query.trim().length > 0;
  const filtered = useMemo(
    () => (searching ? entries.filter((e) => matches(e, query.trim(), folders)) : entries),
    [entries, query, searching, folders]
  );

  const selectedEntry = useMemo(
    () => (selectedId ? entries.find((e) => e.id === selectedId) ?? null : null),
    [entries, selectedId]
  );

  const onDirtyChange = (d: boolean): void => {
    dirtyRef.current = d;
  };

  function guard(then: () => void): void {
    if (dirtyRef.current) {
      if (!window.confirm('当前知识点有未保存的修改，放弃修改？')) return;
      dirtyRef.current = false;
    }
    then();
  }

  function selectEntry(id: string): void {
    guard(() => {
      setSelectedId(id);
      setCreating(false);
    });
  }

  function startCreate(kbId?: string, folderId?: string | null): void {
    guard(() => {
      if (!kbs.length) {
        toast('请先新建知识库', 'info');
        return;
      }
      const kb = kbId ?? selectedEntry?.kbId ?? kbs[0]?.id ?? '';
      setCreateKbId(kb);
      setCreateFolderId(folderId ?? selectedEntry?.folderId ?? null);
      setCreating(true);
      setSelectedId(null);
    });
  }

  function closeEditor(): void {
    guard(() => {
      setCreating(false);
      setSelectedId(null);
    });
  }

  function toggle(key: string): void {
    setCollapsed((s) => {
      const copy = new Set(s);
      if (copy.has(key)) copy.delete(key);
      else copy.add(key);
      return copy;
    });
  }

  function childFolders(kbId: string, parentId: string | null): Folder[] {
    return folders
      .filter((f) => f.kbId === kbId && f.parentId === parentId)
      .sort((a, b) => a.sort - b.sort);
  }

  function dropEntry(overEId: string): void {
    if (!dragId || dragId === overEId) {
      setDragId(null);
      setOverId(null);
      return;
    }
    const dragE = entries.find((e) => e.id === dragId);
    const overE = entries.find((e) => e.id === overEId);
    if (!dragE || !overE) {
      setDragId(null);
      setOverId(null);
      return;
    }
    if (dragE.kbId !== overE.kbId || dragE.folderId !== overE.folderId) {
      toast('只能在同一文件夹内拖拽排序', 'info');
      setDragId(null);
      setOverId(null);
      return;
    }
    const ids = entries.map((e) => e.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(overEId);
    if (from < 0 || to < 0) {
      setDragId(null);
      setOverId(null);
      return;
    }
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    onReorder(ids).finally(() => {
      setDragId(null);
      setOverId(null);
    });
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
    } catch (e) {
      toast('导出失败：' + (e instanceof Error ? e.message : String(e)), 'error');
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
      const obj = parsed as { version?: string; meta?: unknown; tree?: unknown[]; entries?: unknown[]; assets?: unknown[] };
      const hasTree = Array.isArray(obj?.tree) && obj.tree.length > 0;
      const hasEntries = Array.isArray(obj?.entries) && obj.entries.length > 0;
      if (!hasTree && !hasEntries) {
        toast('文件需要 entries 数组（BlockNote 块）或 tree 数组', 'error');
        return;
      }
      const payload: ImportPayload = { version: obj.version, meta: obj.meta, tree: obj.tree, entries: obj.entries, assets: obj.assets };
      previewImport(payload)
        .then((preview) => setImportPreview({ payload, preview }))
        .catch((err) => toast('解析失败：' + (err instanceof Error ? err.message : String(err)), 'error'));
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  // 确认导入：replace=false 合并（按 id 更新已有、新增其余）；true 先清空再整体导入
  async function handleConfirmImport(replace: boolean): Promise<void> {
    if (!importPreview) return;
    const { payload, preview } = importPreview;
    setImporting(true);
    try {
      const next = await importAll(payload, replace);
      onImported(next.entries, next.kbs, next.folders);
      toast(`已${replace ? '替换' : '合并'}导入 ${preview.valid} 条知识点`, 'success');
      setImportPreview(null);
    } catch (err) {
      toast('导入失败：' + (err instanceof Error ? err.message : String(err)), 'error');
    } finally {
      setImporting(false);
    }
  }

  // —— 知识库 / 文件夹 CRUD（均用 window.prompt 简化交互） ——

  function addFolder(kbId: string, parentId: string | null): void {
    const name = window.prompt(parentId ? '新子文件夹名称：' : '新建文件夹（知识库根）名称：');
    if (!name || !name.trim()) return;
    onCreateFolder({ kbId, parentId, name: name.trim() }).catch((err) =>
      toast('新建文件夹失败：' + (err instanceof Error ? err.message : String(err)), 'error')
    );
    setMenuId(null);
  }

  function renameKb(kb: KnowledgeBase): void {
    const next = window.prompt(`重命名知识库「${kb.name}」为：`, kb.name);
    if (!next || next.trim() === kb.name || !next.trim()) return;
    onRenameKb(kb.id, next.trim()).catch((err) =>
      toast('重命名失败：' + (err instanceof Error ? err.message : String(err)), 'error')
    );
    setMenuId(null);
  }

  function removeKb(kb: KnowledgeBase): void {
    const count = entries.filter((e) => e.kbId === kb.id).length;
    if (!window.confirm(`确定删除知识库「${kb.name}」及其下 ${count} 条知识点与全部文件夹？此操作不可撤销。`)) return;
    onDeleteKb(kb.id).catch((err) =>
      toast('删除失败：' + (err instanceof Error ? err.message : String(err)), 'error')
    );
    if (selectedEntry && selectedEntry.kbId === kb.id) closeEditor();
    setMenuId(null);
  }

  function renameFolder(folder: Folder): void {
    const next = window.prompt(`重命名文件夹「${folder.name}」为：`, folder.name);
    if (!next || next.trim() === folder.name || !next.trim()) return;
    onRenameFolder(folder.id, next.trim()).catch((err) =>
      toast('重命名失败：' + (err instanceof Error ? err.message : String(err)), 'error')
    );
    setMenuId(null);
  }

  function moveFolderToRoot(folder: Folder): void {
    onMoveFolder(folder.id, { parentId: null }).catch((err) =>
      toast('移动失败：' + (err instanceof Error ? err.message : String(err)), 'error')
    );
    setMenuId(null);
  }

  function removeFolder(folder: Folder): void {
    const subtree = folderSubtreeIds(folders, folder.id);
    const count = entries.filter((e) => e.folderId && subtree.has(e.folderId)).length;
    if (!window.confirm(`确定删除文件夹「${folder.name}」及其子文件夹、${count} 条知识点？此操作不可撤销。`)) return;
    onDeleteFolder(folder.id).catch((err) =>
      toast('删除失败：' + (err instanceof Error ? err.message : String(err)), 'error')
    );
    if (selectedEntry && selectedEntry.folderId && subtree.has(selectedEntry.folderId)) closeEditor();
    setMenuId(null);
  }

  async function newKbThenCreate(): Promise<void> {
    const name = window.prompt('新知识库名称：');
    if (!name || !name.trim()) return;
    try {
      const kb = await onCreateKb(name.trim());
      startCreate(kb.id, null);
    } catch (err) {
      toast('新建知识库失败：' + (err instanceof Error ? err.message : String(err)), 'error');
    }
  }

  const editorKey = creating ? '__new__' : selectedId ?? '__none__';

  // —— 递归渲染 ——

  function renderEntryRow(e: Entry, depth: number): ReactNode {
    const active = !creating && selectedId === e.id;
    const over = overId === e.id;
    const indent = 14 + depth * 14;
    return (
      <div
        key={e.id}
        draggable
        onDragStart={() => setDragId(e.id)}
        onDragEnd={() => {
          setDragId(null);
          setOverId(null);
        }}
        onDragOver={(ev) => {
          if (dragId && dragId !== e.id) {
            ev.preventDefault();
            setOverId(e.id);
          }
        }}
        onDrop={(ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          dropEntry(e.id);
        }}
        onClick={() => selectEntry(e.id)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '7px 10px',
          margin: '2px 4px',
          marginLeft: indent,
          borderRadius: 9,
          cursor: 'pointer',
          border: '1px solid transparent',
          background: active
            ? 'var(--sel)'
            : over
            ? 'color-mix(in srgb, var(--accent) 12%, transparent)'
            : 'transparent',
          opacity: dragId === e.id ? 0.5 : 1,
          borderTop: over ? '2px solid var(--accent)' : '2px solid transparent',
        }}
      >
        <span style={{ color: 'var(--mut)', cursor: 'grab', fontSize: 12 }}>⠿</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: active ? 700 : 600,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              color: 'var(--fg)',
            }}
          >
            {e.title}
          </div>
          {e.summary ? (
            <div
              style={{
                fontSize: 11,
                color: 'var(--mut)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                marginTop: 1,
              }}
            >
              {e.summary}
            </div>
          ) : null}
        </div>
        <span
          role="button"
          style={{ color: 'var(--mut)', fontSize: 12, padding: '2px 4px', cursor: 'pointer' }}
          title="删除"
          onClick={(ev) => {
            ev.stopPropagation();
            if (window.confirm(`删除知识点「${e.title}」？`)) {
              onDelete(e.id).then(() => {
                if (selectedId === e.id) setSelectedId(null);
                toast('已删除', 'success');
              });
            }
          }}
        >
          ✕
        </span>
      </div>
    );
  }

  function renderFolder(folder: Folder, depth: number): ReactNode {
    const key = `fld:${folder.id}`;
    const isCol = collapsed.has(key);
    const items = entries.filter((e) => e.folderId === folder.id);
    const subs = childFolders(folder.kbId, folder.id);
    const indent = 10 + depth * 14;
    return (
      <div key={folder.id} style={{ marginBottom: 2 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 6px',
            marginLeft: indent,
            borderRadius: 8,
            cursor: 'pointer',
            userSelect: 'none',
          }}
          onClick={() => toggle(key)}
        >
          <span style={{ color: 'var(--mut)', fontSize: 12, width: 12 }}>{isCol ? '▸' : '▾'}</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg)' }}>📁 {folder.name}</span>
          <span
            style={{
              fontSize: 11,
              color: 'var(--mut)',
              background: 'var(--bg)',
              border: '1px solid var(--bd)',
              borderRadius: 20,
              padding: '0 7px',
            }}
          >
            {items.length}
          </span>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            style={{ ...iconBtn, padding: '2px 6px' }}
            onClick={(e) => {
              e.stopPropagation();
              setMenuId(menuId === key ? null : key);
            }}
            title="文件夹操作"
          >
            ⋯
          </button>
        </div>
        {menuId === key && (
          <div style={{ ...menuBoxStyle, marginLeft: indent + 12 }}>
            <button type="button" style={menuItemStyle} onClick={() => addFolder(folder.kbId, folder.id)}>
              ＋ 新建子文件夹
            </button>
            <button type="button" style={menuItemStyle} onClick={() => renameFolder(folder)}>
              ✎ 重命名
            </button>
            <button type="button" style={menuItemStyle} onClick={() => moveFolderToRoot(folder)}>
              ↥ 移至知识库根
            </button>
            <button
              type="button"
              style={{ ...menuItemStyle, color: 'var(--danger)' }}
              onClick={() => removeFolder(folder)}
            >
              🗑 删除文件夹
            </button>
          </div>
        )}
        {!isCol && (
          <div style={{ margin: '2px 0 6px' }}>
            {items.length === 0 && subs.length === 0 ? (
              <div
                style={{
                  marginLeft: indent + 18,
                  padding: '4px 8px',
                  fontSize: 11,
                  color: 'var(--mut)',
                  cursor: 'pointer',
                }}
                onClick={() => startCreate(folder.kbId, folder.id)}
              >
                空文件夹，点击新建知识点
              </div>
            ) : (
              <>
                {items.map((e) => renderEntryRow(e, depth + 1))}
                {subs.map((sf) => renderFolder(sf, depth + 1))}
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  function renderKb(kb: KnowledgeBase): ReactNode {
    const key = `kb:${kb.id}`;
    const isCol = collapsed.has(key);
    const rootItems = entries.filter((e) => e.kbId === kb.id && e.folderId === null);
    const rootFolders = childFolders(kb.id, null);
    const total = entries.filter((e) => e.kbId === kb.id).length;
    return (
      <div key={kb.id} style={{ marginBottom: 4 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 6px',
            borderRadius: 8,
            cursor: 'pointer',
            userSelect: 'none',
          }}
          onClick={() => toggle(key)}
        >
          <span style={{ color: 'var(--mut)', fontSize: 12, width: 12 }}>{isCol ? '▸' : '▾'}</span>
          <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--mut)' }}>📚 {kb.name}</span>
          <span
            style={{
              fontSize: 11,
              color: 'var(--mut)',
              background: 'var(--bg)',
              border: '1px solid var(--bd)',
              borderRadius: 20,
              padding: '0 7px',
            }}
          >
            {total}
          </span>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            style={{ ...iconBtn, padding: '2px 6px' }}
            onClick={(e) => {
              e.stopPropagation();
              setMenuId(menuId === key ? null : key);
            }}
            title="知识库操作"
          >
            ⋯
          </button>
        </div>
        {menuId === key && (
          <div style={menuBoxStyle}>
            <button type="button" style={menuItemStyle} onClick={() => addFolder(kb.id, null)}>
              ＋ 新建文件夹
            </button>
            <button type="button" style={menuItemStyle} onClick={() => startCreate(kb.id, null)}>
              ＋ 新建知识点
            </button>
            <button type="button" style={menuItemStyle} onClick={() => renameKb(kb)}>
              ✎ 重命名知识库
            </button>
            <button
              type="button"
              style={{ ...menuItemStyle, color: 'var(--danger)' }}
              onClick={() => removeKb(kb)}
            >
              🗑 删除知识库
            </button>
          </div>
        )}
        {!isCol && (
          <div style={{ margin: '2px 0 6px' }}>
            {total === 0 ? (
              <div
                style={{
                  marginLeft: 18,
                  padding: '4px 8px',
                  fontSize: 11,
                  color: 'var(--mut)',
                  cursor: 'pointer',
                }}
                onClick={() => startCreate(kb.id, null)}
              >
                空知识库，点击新建知识点
              </div>
            ) : (
              <>
                {rootItems.map((e) => renderEntryRow(e, 1))}
                {rootFolders.map((f) => renderFolder(f, 1))}
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  // 搜索态：扁平列表，每条带知识库 / 文件夹路径
  function renderSearchList(): ReactNode {
    const order: string[] = [];
    const map = new Map<string, Entry[]>();
    for (const e of filtered) {
      if (!map.has(e.kbId)) {
        map.set(e.kbId, []);
        order.push(e.kbId);
      }
      map.get(e.kbId)!.push(e);
    }
    return order.map((kbId) => {
      const kb = kbs.find((k) => k.id === kbId);
      const items = map.get(kbId)!;
      return (
        <div key={kbId} style={{ marginBottom: 4 }}>
          <div style={{ padding: '6px 6px', fontSize: 12, fontWeight: 800, color: 'var(--mut)' }}>
            📚 {kb?.name ?? '未分类'}
          </div>
          <div style={{ margin: '2px 0 6px' }}>{items.map((e) => renderEntryRow(e, 1))}</div>
        </div>
      );
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: `calc(100vh - ${topOffset}px)` }}>
      {/* 顶部工具栏 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 0',
          flex: '0 0 auto',
        }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索知识点（标题 / 摘要 / 标签 / 知识库 / 文件夹）…"
          style={{
            flex: 1,
            minWidth: 0,
            padding: '9px 13px',
            border: '1px solid var(--bd)',
            borderRadius: 10,
            background: 'var(--panel)',
            color: 'var(--fg)',
            fontSize: 14,
            outline: 'none',
          }}
        />
        <button type="button" style={{ ...iconBtn, padding: '8px 12px' }} onClick={() => startCreate()}>
          ＋ 新建知识点
        </button>
        <button
          type="button"
          style={iconBtn}
          onClick={() => newKbThenCreate()}
          title="新建一个知识库（并在此库下新建第一条知识点）"
        >
          ＋ 新知识库
        </button>
        <button type="button" style={iconBtn} onClick={handleExport}>
          导出
        </button>
        <label style={{ ...iconBtn, cursor: 'pointer' }}>
          导入
          <input type="file" accept="application/json" onChange={handleImport} style={{ display: 'none' }} />
        </label>
      </div>

      {/* 主从布局 */}
      <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>
        {/* 左栏：知识库 → 文件夹 → 知识点 树 */}
        <aside
          style={{
            width: 320,
            flex: '0 0 320px',
            ...cardStyle,
            overflow: 'auto',
            padding: '8px 8px 12px',
          }}
        >
          {kbs.length === 0 ? (
            <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--mut)', fontSize: 13 }}>
              还没有知识库。
              <br />
              <button
                type="button"
                style={{ ...iconBtn, marginTop: 10, padding: '7px 12px' }}
                onClick={() => newKbThenCreate()}
              >
                ＋ 新建知识库
              </button>
            </div>
          ) : searching ? (
            filtered.length === 0 ? (
              <div style={{ padding: '20px 12px', textAlign: 'center', color: 'var(--mut)', fontSize: 13 }}>
                未匹配到「{query}」
              </div>
            ) : (
              renderSearchList()
            )
          ) : (
            kbs.map((kb) => renderKb(kb))
          )}
        </aside>

        {/* 右栏：统一编辑器 */}
        <main
          style={{
            flex: '1 1 auto',
            minWidth: 0,
            ...cardStyle,
            overflow: 'auto',
            padding: '12px 16px 24px',
          }}
        >
          {creating ? (
            <EntryEditor
              key={editorKey}
              initial={null}
              kbs={kbs}
              folders={folders}
              defaultKbId={createKbId || kbs[0]?.id || ''}
              defaultFolderId={createFolderId}
              onDirtyChange={onDirtyChange}
              onCancel={closeEditor}
              onSave={(input) =>
                onCreate(input).then((entry) => {
                  setCreating(false);
                  setSelectedId(entry.id);
                  return entry;
                })
              }
            />
          ) : selectedEntry ? (
            <EntryEditor
              key={editorKey}
              initial={selectedEntry}
              kbs={kbs}
              folders={folders}
              onDirtyChange={onDirtyChange}
              onCancel={closeEditor}
              onSave={(input) => onUpdate(selectedEntry.id, input)}
            />
          ) : (
            <div
              style={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--mut)',
                gap: 10,
              }}
            >
              <div style={{ fontSize: 40 }}>📚</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--fg)' }}>选择左侧知识点进行编辑</div>
              <div style={{ fontSize: 13 }}>或点击「＋ 新建知识点」开始构建</div>
              <button
                type="button"
                style={{ ...iconBtn, marginTop: 6, padding: '8px 14px', background: 'var(--accent)', color: '#fff', border: 'none' }}
                onClick={() => startCreate()}
              >
                ＋ 新建知识点
              </button>
            </div>
          )}
        </main>
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
