import { useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { Entry, EntryInput } from '../types';
import EntryEditor from './EntryEditor';
import ImportPreviewModal from './ImportPreviewModal';
import { exportAll, importAll, previewImport, type ImportPayload, type ImportPreview } from '../api';
import { toast } from '../toast';

interface Props {
  entries: Entry[];
  knownCats: string[];
  onCreate: (input: EntryInput) => Promise<Entry>;
  onUpdate: (id: string, input: EntryInput) => Promise<Entry>;
  onDelete: (id: string) => Promise<void>;
  onReorder: (ids: string[]) => Promise<void>;
  onRenameCat: (from: string, to: string) => Promise<void>;
  onDeleteCat: (name: string) => Promise<void>;
  onImported: (entries: Entry[]) => void;
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

function matches(e: Entry, q: string): boolean {
  if (!q) return true;
  const s = q.toLowerCase();
  return (
    e.title.toLowerCase().includes(s) ||
    (e.summary ?? '').toLowerCase().includes(s) ||
    (e.py ?? '').toLowerCase().includes(s) ||
    e.tags.some((t) => t.toLowerCase().includes(s)) ||
    e.cat.toLowerCase().includes(s)
  );
}

export default function ManageMode(props: Props): ReactNode {
  const { entries, knownCats, onCreate, onUpdate, onDelete, onReorder, onRenameCat, onDeleteCat, onImported } = props;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newCat, setNewCat] = useState('');
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [menuCat, setMenuCat] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<{ payload: ImportPayload; preview: ImportPreview } | null>(null);
  const [importing, setImporting] = useState(false);
  const dirtyRef = useRef(false);

  const filtered = useMemo(() => entries.filter((e) => matches(e, query.trim())), [entries, query]);
  const searching = query.trim().length > 0;

  const groups = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, Entry[]>();
    for (const e of filtered) {
      if (!map.has(e.cat)) {
        map.set(e.cat, []);
        order.push(e.cat);
      }
      map.get(e.cat)!.push(e);
    }
    return order.map((cat) => ({ cat, items: map.get(cat)! }));
  }, [filtered]);

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

  function startCreate(cat?: string): void {
    guard(() => {
      setNewCat(cat ?? '');
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

  function toggleCat(cat: string): void {
    setCollapsed((s) => {
      const copy = new Set(s);
      if (copy.has(cat)) copy.delete(cat);
      else copy.add(cat);
      return copy;
    });
  }

  function catOf(id: string): string | undefined {
    return entries.find((e) => e.id === id)?.cat;
  }

  function dropEntry(overEId: string): void {
    if (!dragId || dragId === overEId) {
      setDragId(null);
      setOverId(null);
      return;
    }
    if (catOf(dragId) !== catOf(overEId)) {
      toast('只能在同一知识库内拖拽排序', 'info');
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
      // 兼容：纯数组、{ entries }、kb-import-2 的 { version, assets, entries }
      const obj = parsed as { version?: string; assets?: unknown[]; entries?: unknown[] };
      const entries: unknown[] = Array.isArray(parsed)
        ? (parsed as unknown[])
        : Array.isArray(obj?.entries)
        ? obj.entries
        : [];
      if (!entries.length) { toast('文件中没有可导入的知识点', 'error'); return; }
      const payload: ImportPayload = { version: obj?.version, assets: obj?.assets, entries };
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
      onImported(next);
      toast(`已${replace ? '替换' : '合并'}导入 ${preview.valid} 条知识点`, 'success');
      setImportPreview(null);
    } catch (err) {
      toast('导入失败：' + (err instanceof Error ? err.message : String(err)), 'error');
    } finally {
      setImporting(false);
    }
  }

  function renameCat(cat: string): void {
    const next = window.prompt(`重命名知识库「${cat}」为：`, cat);
    if (!next || next.trim() === cat || !next.trim()) return;
    onRenameCat(cat, next.trim()).catch((err) =>
      toast('重命名失败：' + (err instanceof Error ? err.message : String(err)), 'error')
    );
    setMenuCat(null);
  }

  function removeCat(cat: string): void {
    const count = entries.filter((e) => e.cat === cat).length;
    if (!window.confirm(`确定删除知识库「${cat}」及其下 ${count} 条知识点？此操作不可撤销。`)) return;
    onDeleteCat(cat).catch((err) =>
      toast('删除失败：' + (err instanceof Error ? err.message : String(err)), 'error')
    );
    setMenuCat(null);
    if (selectedEntry && selectedEntry.cat === cat) closeEditor();
  }

  const editorKey = creating ? '__new__' : selectedId ?? '__none__';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 60px)' }}>
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
          placeholder="搜索知识点（标题 / 摘要 / 标签 / 知识库）…"
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
          onClick={() => {
            const name = window.prompt('新知识库名称：');
            if (name && name.trim()) startCreate(name.trim());
          }}
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
        {/* 左栏 */}
        <aside
          style={{
            width: 320,
            flex: '0 0 320px',
            ...cardStyle,
            overflow: 'auto',
            padding: '8px 8px 12px',
          }}
        >
          {entries.length === 0 ? (
            <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--mut)', fontSize: 13 }}>
              还没有知识点。
              <br />
              <button
                type="button"
                style={{ ...iconBtn, marginTop: 10, padding: '7px 12px' }}
                onClick={() => startCreate()}
              >
                ＋ 新建第一条
              </button>
            </div>
          ) : groups.length === 0 ? (
            <div style={{ padding: '20px 12px', textAlign: 'center', color: 'var(--mut)', fontSize: 13 }}>
              未匹配到「{query}」
            </div>
          ) : (
            groups.map((g) => {
              const isCol = collapsed.has(g.cat) && !searching;
              const count = g.items.length;
              return (
                <div key={g.cat} style={{ marginBottom: 4 }}>
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
                    onClick={() => toggleCat(g.cat)}
                  >
                    <span style={{ color: 'var(--mut)', fontSize: 12, width: 12 }}>{isCol ? '▸' : '▾'}</span>
                    <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--mut)' }}>{g.cat}</span>
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
                      {count}
                    </span>
                    <div style={{ flex: 1 }} />
                    <button
                      type="button"
                      style={{ ...iconBtn, padding: '2px 6px' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuCat(menuCat === g.cat ? null : g.cat);
                      }}
                      title="知识库操作"
                    >
                      ⋯
                    </button>
                  </div>
                  {menuCat === g.cat && (
                    <div
                      style={{
                        margin: '2px 22px 6px',
                        border: '1px solid var(--bd)',
                        borderRadius: 8,
                        background: 'var(--bg)',
                        boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
                        overflow: 'hidden',
                      }}
                    >
                      <button
                        type="button"
                        style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px', border: 'none', background: 'transparent', color: 'var(--fg)', cursor: 'pointer', fontSize: 13 }}
                        onClick={() => renameCat(g.cat)}
                      >
                        ✎ 重命名知识库
                      </button>
                      <button
                        type="button"
                        style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px', border: 'none', background: 'transparent', color: 'var(--danger)', cursor: 'pointer', fontSize: 13 }}
                        onClick={() => removeCat(g.cat)}
                      >
                        🗑 删除知识库
                      </button>
                    </div>
                  )}
                  {!isCol && (
                    <div style={{ margin: '2px 0 6px' }}>
                      {g.items.map((e) => {
                        const active = !creating && selectedId === e.id;
                        const over = overId === e.id;
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
                      })}
                    </div>
                  )}
                </div>
              );
            })
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
              knownCats={knownCats}
              defaultCat={newCat}
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
              knownCats={knownCats}
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
