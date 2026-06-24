import { useMemo, useState } from 'react';
import type { CSSProperties, DragEvent } from 'react';
import type { Entry, IndexNode } from '../types';
import type { EntryInput } from '../api';
import { filterEntries } from '../search';
import { chip } from '../ui';
import EntryEditorModal from './EntryEditorModal';
import IndexTreeEditor from './IndexTreeEditor';

interface Props {
  entries: Entry[];
  onCreate: (input: EntryInput) => Promise<void>;
  onUpdate: (id: string, input: EntryInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onReorder: (ids: string[]) => Promise<void>;
}

function fmtDate(ms?: number): string {
  if (!ms) return '—';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const cellBtn: CSSProperties = {
  padding: '5px 11px', fontSize: 12, fontFamily: 'inherit', cursor: 'pointer',
  background: 'transparent', border: '1px solid var(--bd)', borderRadius: 7, color: 'var(--fg)',
};

export default function ManageMode({ entries, onCreate, onUpdate, onDelete, onReorder }: Props) {
  const [query, setQuery] = useState('');
  const [activeCat, setActiveCat] = useState('全部');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(() => new Set());
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const cats = useMemo(() => {
    const seen: string[] = [];
    for (const e of entries) if (!seen.includes(e.cat)) seen.push(e.cat);
    return seen;
  }, [entries]);

  const searching = query.trim().length > 0;
  const matchedIds = useMemo(
    () => (searching ? new Set(filterEntries(entries, query).map((e) => e.id)) : null),
    [entries, query, searching]
  );

  // 按知识库分组（保持服务端的 sort 顺序）
  const groups = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const e of entries) {
      if (activeCat !== '全部' && e.cat !== activeCat) continue;
      if (matchedIds && !matchedIds.has(e.id)) continue;
      if (!map.has(e.cat)) map.set(e.cat, []);
      map.get(e.cat)!.push(e);
    }
    return cats.filter((c) => map.has(c)).map((c) => ({ cat: c, items: map.get(c)! }));
  }, [entries, cats, activeCat, matchedIds]);

  const shownCount = groups.reduce((n, g) => n + g.items.length, 0);

  function openCreate() { setEditing(null); setEditorOpen(true); }
  function openEdit(e: Entry) { setEditing(e); setEditorOpen(true); }
  function toggleExpand(id: string) {
    setExpanded((cur) => { const n = new Set(cur); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleCat(cat: string) {
    setCollapsedCats((cur) => { const n = new Set(cur); n.has(cat) ? n.delete(cat) : n.add(cat); return n; });
  }

  async function handleSubmit(input: EntryInput) {
    if (editing) await onUpdate(editing.id, input);
    else await onCreate(input);
    setEditorOpen(false);
    setEditing(null);
  }

  // 保存某知识点的多级索引（仅改 intro / nodes，其余字段保持）
  async function handleSaveIndex(e: Entry, intro: string, nodes: IndexNode[]) {
    await onUpdate(e.id, { title: e.title, cat: e.cat, tags: e.tags, summary: e.summary, intro, nodes });
  }

  async function handleDelete(id: string) {
    setBusyId(id);
    try { await onDelete(id); setConfirmId(null); }
    catch (e) { alert('删除失败：' + (e instanceof Error ? e.message : String(e))); }
    finally { setBusyId(null); }
  }

  // 组内拖拽排序
  function handleDrop(cat: string, toId: string) {
    if (!dragId || dragId === toId) return;
    const groupIds = entries.filter((e) => e.cat === cat).map((e) => e.id);
    const from = groupIds.indexOf(dragId);
    const to = groupIds.indexOf(toId);
    setDragId(null);
    setOverId(null);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...groupIds];
    next.splice(from, 1);
    next.splice(to, 0, dragId);
    void onReorder(next);
  }

  const dragEnabled = !searching; // 搜索态禁用拖拽（避免在过滤结果上误排序）

  return (
    <div style={{ padding: '28px 0 60px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>知识点管理</div>
          <div style={{ fontSize: 12.5, color: 'var(--mut)', marginTop: 3 }}>共 {entries.length} 条 · {cats.length} 个知识库 · 当前显示 {shownCount} 条</div>
        </div>
        <button onClick={openCreate} style={{ padding: '10px 18px', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer', background: 'var(--fg)', color: 'var(--bg)', border: 'none', borderRadius: 9, fontWeight: 600 }}>＋ 新建知识点</button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 200 }}>
          <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--mut)', fontSize: 15 }}>⌕</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索标题、拼音、标签、内容…" spellCheck={false}
            style={{ width: '100%', padding: '10px 14px 10px 40px', fontSize: 14, fontFamily: 'inherit', color: 'var(--fg)', background: 'var(--panel)', border: '1px solid var(--bd)', borderRadius: 10, outline: 'none' }} />
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {['全部', ...cats].map((c) => (
            <button key={c} style={chip(activeCat === c)} onClick={() => setActiveCat(c)}>{c}</button>
          ))}
        </div>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--mut)', marginBottom: 14 }}>
        {searching ? '搜索态下暂停拖拽排序，清空搜索后可拖动 ⠿ 调整顺序。' : '拖动每行左侧 ⠿ 可在同一知识库内调整顺序 · 点击 ▸ 展开查看二级标题与正文预览。'}
      </div>

      {groups.length === 0 && (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--mut)', fontSize: 13, border: '1px solid var(--bd)', borderRadius: 12 }}>没有匹配的知识点</div>
      )}

      {groups.map((g) => {
        const catCollapsed = collapsedCats.has(g.cat);
        return (
          <div key={g.cat} style={{ marginBottom: 16, border: '1px solid var(--bd)', borderRadius: 12, overflow: 'hidden' }}>
            <div onClick={() => toggleCat(g.cat)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: 'var(--sel)', cursor: 'pointer' }}>
              <span style={{ fontSize: 11, color: 'var(--mut)', width: 12 }}>{catCollapsed ? '▸' : '▾'}</span>
              <span style={{ fontSize: 14, fontWeight: 700 }}>{g.cat}</span>
              <span style={{ fontSize: 12, color: 'var(--mut)' }}>{g.items.length} 条</span>
            </div>

            {!catCollapsed && g.items.map((e) => {
              const isOpen = expanded.has(e.id);
              const idxCount = e.nodes.length;
              const canDrag = dragEnabled;
              return (
                <div
                  key={e.id}
                  onDragOver={(ev: DragEvent) => { if (dragId) { ev.preventDefault(); if (overId !== e.id) setOverId(e.id); } }}
                  onDrop={(ev: DragEvent) => { ev.preventDefault(); handleDrop(g.cat, e.id); }}
                  style={{ borderTop: '1px solid var(--bd)', background: overId === e.id && dragId ? 'var(--sel)' : 'transparent', opacity: dragId === e.id ? 0.45 : 1 }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px' }}>
                    <span
                      draggable={canDrag}
                      onDragStart={() => canDrag && setDragId(e.id)}
                      onDragEnd={() => { setDragId(null); setOverId(null); }}
                      title={canDrag ? '拖动排序' : '清空搜索后可拖动'}
                      style={{ cursor: canDrag ? 'grab' : 'not-allowed', color: 'var(--mut)', fontSize: 15, userSelect: 'none', width: 16, textAlign: 'center', opacity: canDrag ? 1 : 0.4 }}
                    >⠿</span>
                    <button onClick={() => toggleExpand(e.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--mut)', fontSize: 11, width: 14, padding: 0 }}>{isOpen ? '▾' : '▸'}</button>
                    <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => toggleExpand(e.id)}>
                      <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {e.title}
                        {idxCount > 0 && <span style={{ fontSize: 11, color: 'var(--mut)', fontWeight: 400, marginLeft: 8 }}>· {idxCount} 个二级索引</span>}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--mut)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>{e.summary}</div>
                    </div>
                    <span style={{ fontSize: 11.5, color: 'var(--mut)', flexShrink: 0, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.tags.join('、')}</span>
                    <span style={{ fontSize: 11.5, color: 'var(--mut)', flexShrink: 0, width: 116 }}>{fmtDate(e.updatedAt)}</span>
                    <span style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      {confirmId === e.id ? (
                        <>
                          <button onClick={() => handleDelete(e.id)} disabled={busyId === e.id} style={{ ...cellBtn, color: '#fff', background: '#e5484d', border: 'none' }}>{busyId === e.id ? '…' : '确认删除'}</button>
                          <button onClick={() => setConfirmId(null)} style={cellBtn}>取消</button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => openEdit(e)} style={cellBtn}>编辑</button>
                          <button onClick={() => setConfirmId(e.id)} style={{ ...cellBtn, color: '#e5484d' }}>删除</button>
                        </>
                      )}
                    </span>
                  </div>

                  {isOpen && (
                    <div style={{ padding: '10px 18px 18px 56px', borderTop: '1px dashed var(--bd)' }}>
                      <IndexTreeEditor
                        intro={e.intro}
                        nodes={e.nodes}
                        onSave={(intro, nodes) => handleSaveIndex(e, intro, nodes)}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}

      {editorOpen && (
        <EntryEditorModal
          initial={editing}
          knownCats={cats}
          onClose={() => { setEditorOpen(false); setEditing(null); }}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  );
}
