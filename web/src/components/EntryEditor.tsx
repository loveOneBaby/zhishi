import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { Entry, EntryInput, IndexNode } from '../types';
import {
  MAX_INDEX_DEPTH,
  addChild,
  addSibling,
  descendantIds,
  moveAsLastChild,
  moveBefore,
  moveNode,
  newNode,
  parentIdOf,
  patchNode,
  removeNode,
} from '../outline';
import { parseSections, renderMd } from '../markdown';
import { toast } from '../toast';

const LEVEL_CN = ['二', '三', '四', '五', '六'];

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '9px 11px',
  border: '1px solid var(--bd)',
  borderRadius: 10,
  background: 'var(--bg)',
  color: 'var(--fg)',
  fontSize: 14,
  outline: 'none',
};

const labelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--mut)',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  marginBottom: 5,
  display: 'block',
};

const cardStyle: CSSProperties = {
  border: '1px solid var(--bd)',
  borderRadius: 14,
  background: 'var(--panel)',
  padding: '14px 16px',
};

const iconBtn: CSSProperties = {
  padding: '2px 7px',
  border: '1px solid var(--bd)',
  borderRadius: 7,
  background: 'var(--bg)',
  color: 'var(--mut)',
  cursor: 'pointer',
  fontSize: 12,
  lineHeight: '20px',
};

function snapshot(d: {
  title: string;
  cat: string;
  tags: string[];
  summary: string;
  intro: string;
  nodes: IndexNode[];
}): string {
  return JSON.stringify({
    title: d.title.trim(),
    cat: d.cat.trim(),
    tags: d.tags,
    summary: d.summary.trim(),
    intro: d.intro,
    nodes: d.nodes,
  });
}

interface Props {
  /** null = 新建 */
  initial: Entry | null;
  knownCats: string[];
  defaultCat?: string;
  onSave: (input: EntryInput) => Promise<Entry>;
  onCancel?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}

export default function EntryEditor(props: Props): ReactNode {
  const { initial, knownCats, defaultCat, onSave, onCancel, onDirtyChange } = props;
  const isEdit = !!initial;

  const [title, setTitle] = useState(initial?.title ?? '');
  const [cat, setCat] = useState(initial?.cat ?? defaultCat ?? '');
  const [tags, setTags] = useState(initial?.tags.join(', ') ?? '');
  const [summary, setSummary] = useState(initial?.summary ?? '');
  const [intro, setIntro] = useState(initial?.intro ?? '');
  const [nodes, setNodes] = useState<IndexNode[]>(initial?.nodes ?? []);

  const [openContent, setOpenContent] = useState<Set<string>>(new Set());
  const [previewIds, setPreviewIds] = useState<Set<string>>(new Set());
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(0);

  const tagList = tags
    .split(/[,，]/)
    .map((t) => t.trim())
    .filter(Boolean);

  const baseRef = useRef('');
  if (!baseRef.current) {
    baseRef.current = snapshot({
      title: initial?.title ?? '',
      cat: initial?.cat ?? defaultCat ?? '',
      tags: initial?.tags ?? [],
      summary: initial?.summary ?? '',
      intro: initial?.intro ?? '',
      nodes: initial?.nodes ?? [],
    });
  }

  const dirty = snapshot({ title, cat, tags: tagList, summary, intro, nodes }) !== baseRef.current;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const toggleSet = (set: Set<string>, id: string, next: boolean): Set<string> => {
    const copy = new Set(set);
    if (next) copy.add(id);
    else copy.delete(id);
    return copy;
  };

  function handleSave(): void {
    if (saving) return;
    if (!title.trim()) {
      toast('标题不能为空', 'error');
      return;
    }
    if (!cat.trim()) {
      toast('请选择或输入知识库', 'error');
      return;
    }
    setSaving(true);
    onSave({
      title: title.trim(),
      cat: cat.trim(),
      tags: tagList,
      summary: summary.trim(),
      py: title.trim(),
      intro,
      nodes,
    })
      .then((saved) => {
        setTitle(saved.title);
        setCat(saved.cat);
        setTags(saved.tags.join(', '));
        setSummary(saved.summary ?? '');
        setIntro(saved.intro ?? '');
        setNodes(saved.nodes ?? []);
        baseRef.current = snapshot({
          title: saved.title,
          cat: saved.cat,
          tags: saved.tags,
          summary: saved.summary ?? '',
          intro: saved.intro ?? '',
          nodes: saved.nodes ?? [],
        });
        setSavedAt(Date.now());
        toast(isEdit ? '知识点已更新' : '知识点已创建', 'success');
      })
      .catch((e) => {
        toast('保存失败：' + (e instanceof Error ? e.message : String(e)), 'error');
      })
      .finally(() => setSaving(false));
  }

  // ⌘S 保存（编辑器挂载时）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, cat, tags, summary, intro, nodes, saving]);

  function addTopNode(): void {
    setNodes((ns) => [...ns, newNode()]);
  }

  function canDrop(targetId: string): boolean {
    if (!dragId || dragId === targetId) return false;
    if (descendantIds(nodes, dragId).has(targetId)) return false;
    return true;
  }

  function handleDrop(targetId: string): void {
    if (!dragId || !canDrop(targetId)) {
      setDragId(null);
      setDropTarget(null);
      return;
    }
    const sameParent = parentIdOf(nodes, dragId) === parentIdOf(nodes, targetId);
    if (sameParent) {
      setNodes((ns) => moveBefore(ns, dragId, targetId));
    } else {
      setNodes((ns) => moveAsLastChild(ns, dragId, targetId));
    }
    setDragId(null);
    setDropTarget(null);
  }

  const draftPreview: Entry = {
    id: initial?.id ?? '__draft__',
    cat: cat.trim() || '自定义',
    title: title.trim() || '（未命名知识点）',
    py: title.trim() || '',
    tags: tagList,
    summary: summary.trim() || intro.split('\n').map((l) => l.trim()).find(Boolean) || '',
    intro,
    nodes,
    sort: initial?.sort ?? 0,
    createdAt: initial?.createdAt ?? 0,
    updatedAt: initial?.updatedAt ?? 0,
  };

  function renderNodes(list: IndexNode[], depth: number): ReactNode {
    return list.map((n, i) => {
      const open = openContent.has(n.id);
      const previewMode = previewIds.has(n.id);
      const canNest = depth < MAX_INDEX_DEPTH;
      const isDropTarget = dropTarget === n.id;
      const sameParent = dragId ? parentIdOf(nodes, dragId) === parentIdOf(nodes, n.id) : false;
      return (
        <div key={n.id} style={{ marginLeft: depth === 0 ? 0 : 14 }}>
          <div
            style={{
              borderLeft: depth === 0 ? 'none' : `1px dashed var(--bd)`,
              paddingLeft: depth === 0 ? 0 : 12,
              marginTop: 6,
            }}
          >
            <div
              draggable
              onDragStart={() => setDragId(n.id)}
              onDragEnd={() => {
                setDragId(null);
                setDropTarget(null);
              }}
              onDragOver={(e) => {
                if (canDrop(n.id)) {
                  e.preventDefault();
                  setDropTarget(n.id);
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleDrop(n.id);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 6px',
                borderRadius: 9,
                background: dragId === n.id ? 'var(--sel)' : isDropTarget ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'transparent',
                borderTop: isDropTarget && sameParent ? '2px solid var(--accent)' : '2px solid transparent',
                boxShadow: isDropTarget && !sameParent ? 'inset 0 0 0 2px var(--accent)' : 'none',
                transition: 'background 0.12s',
              }}
            >
              <span
                title="拖拽排序：拖到同级上=前移，拖到其他层级上=变为它的下级"
                style={{ cursor: 'grab', color: 'var(--mut)', userSelect: 'none', fontSize: 14, padding: '0 2px' }}
              >
                ⠿
              </span>
              <input
                value={n.title}
                onChange={(e) => setNodes((ns) => patchNode(ns, n.id, { title: e.target.value }))}
                placeholder={`（${LEVEL_CN[depth] || '级'}标题）`}
                style={{
                  ...inputStyle,
                  fontWeight: depth === 0 ? 700 : 600,
                  padding: '7px 10px',
                  fontSize: depth === 0 ? 14 : 13,
                }}
              />
              <button
                type="button"
                title="上移"
                style={iconBtn}
                onClick={() => setNodes((ns) => moveNode(ns, n.id, -1))}
                disabled={i === 0}
              >
                ↑
              </button>
              <button
                type="button"
                title="下移"
                style={iconBtn}
                onClick={() => setNodes((ns) => moveNode(ns, n.id, +1))}
                disabled={i === list.length - 1}
              >
                ↓
              </button>
              <button
                type="button"
                title={open ? '收起内容' : '展开内容'}
                style={{ ...iconBtn, color: open ? 'var(--accent)' : 'var(--mut)' }}
                onClick={() => setOpenContent((s) => toggleSet(s, n.id, !open))}
              >
                {open ? '▾' : '▸'} 内容
              </button>
              <button
                type="button"
                title="新增同级"
                style={iconBtn}
                onClick={() => setNodes((ns) => addSibling(ns, n.id, newNode()))}
              >
                ＋同级
              </button>
              {canNest && (
                <button
                  type="button"
                  title={`新增${LEVEL_CN[depth + 1] || '下'}级`}
                  style={iconBtn}
                  onClick={() => {
                    setNodes((ns) => addChild(ns, n.id, newNode()));
                    setOpenContent((s) => toggleSet(s, n.id, true));
                  }}
                >
                  ＋下级
                </button>
              )}
              <button
                type="button"
                title="删除"
                style={{ ...iconBtn, color: 'var(--danger)' }}
                onClick={() => setNodes((ns) => removeNode(ns, n.id))}
              >
                ✕
              </button>
            </div>

            {open && (
              <div style={{ marginTop: 6, marginBottom: 6 }}>
                <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                  <button
                    type="button"
                    style={{ ...iconBtn, color: !previewMode ? 'var(--accent)' : 'var(--mut)' }}
                    onClick={() => setPreviewIds((s) => toggleSet(s, n.id, false))}
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    style={{ ...iconBtn, color: previewMode ? 'var(--accent)' : 'var(--mut)' }}
                    onClick={() => setPreviewIds((s) => toggleSet(s, n.id, true))}
                  >
                    预览
                  </button>
                  <span style={{ fontSize: 11, color: 'var(--mut)', alignSelf: 'center' }}>支持 Markdown</span>
                </div>
                {previewMode ? (
                  <div
                    className="ik-md"
                    style={{
                      border: '1px solid var(--bd)',
                      borderRadius: 10,
                      padding: '10px 12px',
                      background: 'var(--bg)',
                      minHeight: 60,
                      fontSize: 13,
                    }}
                  >
                    {n.content?.trim() ? renderMd(n.content) : <span style={{ color: 'var(--mut)' }}>（无内容）</span>}
                  </div>
                ) : (
                  <textarea
                    value={n.content}
                    onChange={(e) => setNodes((ns) => patchNode(ns, n.id, { content: e.target.value }))}
                    placeholder="此处的正文内容，支持 **加粗**、`code`、列表、代码块等 Markdown 语法…"
                    style={{
                      width: '100%',
                      minHeight: 120,
                      padding: '10px 12px',
                      border: '1px solid var(--bd)',
                      borderRadius: 10,
                      background: 'var(--bg)',
                      color: 'var(--fg)',
                      fontSize: 13,
                      lineHeight: 1.7,
                      resize: 'vertical',
                      outline: 'none',
                      fontFamily: 'inherit',
                    }}
                  />
                )}
              </div>
            )}

            {n.children.length > 0 && renderNodes(n.children, depth + 1)}
          </div>
        </div>
      );
    });
  }

  return (
    <div>
      {/* 头部 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 12,
          position: 'sticky',
          top: 0,
          zIndex: 2,
          background: 'var(--bg)',
          padding: '6px 0',
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 800 }}>
          {isEdit ? '编辑知识点' : '新建知识点'}
        </div>
        <span
          style={{
            fontSize: 12,
            color: 'var(--mut)',
            background: 'var(--panel)',
            border: '1px solid var(--bd)',
            padding: '2px 8px',
            borderRadius: 20,
          }}
        >
          {savedAt ? '已保存' : dirty ? '未保存' : isEdit ? '无改动' : '草稿'}
        </span>
        <div style={{ flex: 1 }} />
        <button type="button" style={iconBtn} onClick={onCancel}>
          关闭
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !dirty}
          style={{
            padding: '7px 18px',
            borderRadius: 10,
            border: 'none',
            background: dirty ? 'var(--accent)' : 'var(--bd)',
            color: dirty ? '#fff' : 'var(--mut)',
            fontWeight: 700,
            fontSize: 13,
            cursor: dirty && !saving ? 'pointer' : 'not-allowed',
          }}
        >
          {saving ? '保存中…' : '保存（⌘S）'}
        </button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
        {/* 左：编辑区 */}
        <div style={{ flex: '1 1 460px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={cardStyle}>
            <datalist id="kb-list-manage">
              {knownCats.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>标题</label>
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="知识点标题" style={inputStyle} autoFocus={!isEdit} />
              </div>
              <div>
                <label style={labelStyle}>知识库</label>
                <input
                  value={cat}
                  onChange={(e) => setCat(e.target.value)}
                  list="kb-list-manage"
                  placeholder="如：前端"
                  style={inputStyle}
                />
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <label style={labelStyle}>标签（逗号分隔）</label>
              <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="js, 闭包, 基础" style={inputStyle} />
            </div>
            <div style={{ marginTop: 12 }}>
              <label style={labelStyle}>摘要</label>
              <input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="一句话概要（用于列表/检索）" style={inputStyle} />
            </div>
          </div>

          <div style={cardStyle}>
            <label style={{ ...labelStyle, marginBottom: 0 }}>
              引言 <span style={{ textTransform: 'none', fontWeight: 500, color: 'var(--mut)' }}>· 正文前的导言（可选）</span>
            </label>
            <textarea
              value={intro}
              onChange={(e) => setIntro(e.target.value)}
              placeholder="知识点开篇的引言，简述背景或核心结论…"
              style={{
                width: '100%',
                marginTop: 8,
                minHeight: 64,
                padding: '10px 12px',
                border: '1px solid var(--bd)',
                borderRadius: 10,
                background: 'var(--bg)',
                color: 'var(--fg)',
                fontSize: 13,
                lineHeight: 1.7,
                resize: 'vertical',
                outline: 'none',
                fontFamily: 'inherit',
              }}
            />
          </div>

          <div style={{ ...cardStyle, padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <label style={{ ...labelStyle, margin: 0 }}>多级索引</label>
              <span style={{ fontSize: 11, color: 'var(--mut)' }}>
                拖动 ⠿ 在同级间排序，拖到其他层级上可改变归属
              </span>
              <div style={{ flex: 1 }} />
              <button type="button" style={iconBtn} onClick={addTopNode}>
                ＋ 添加二级索引
              </button>
            </div>
            {nodes.length === 0 ? (
              <div
                style={{
                  padding: '22px 12px',
                  textAlign: 'center',
                  border: '1px dashed var(--bd)',
                  borderRadius: 10,
                  color: 'var(--mut)',
                  fontSize: 13,
                }}
              >
                暂无索引，点击「＋ 添加二级索引」开始构建知识结构
              </div>
            ) : (
              <div>{renderNodes(nodes, 0)}</div>
            )}
          </div>
        </div>

        {/* 右：实时预览 */}
        <div style={{ flex: '1 1 300px', minWidth: 280, position: 'sticky', top: 64 }}>
          <div style={{ ...cardStyle, padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--mut)', letterSpacing: '0.06em' }}>
                实时预览
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--mut)',
                  border: '1px solid var(--bd)',
                  borderRadius: 20,
                  padding: '1px 8px',
                }}
              >
                {draftPreview.cat}
              </span>
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>{draftPreview.title}</div>
            {draftPreview.summary ? (
              <div style={{ fontSize: 13, color: 'var(--mut)', marginBottom: 10 }}>{draftPreview.summary}</div>
            ) : null}
            {draftPreview.tags.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                {draftPreview.tags.map((t) => (
                  <span
                    key={t}
                    style={{
                      fontSize: 11,
                      padding: '1px 8px',
                      borderRadius: 20,
                      background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
                      color: 'var(--accent)',
                    }}
                  >
                    #{t}
                  </span>
                ))}
              </div>
            )}
            <div className="ik-md" style={{ fontSize: 13, lineHeight: 1.8 }}>
              {renderPreview(draftPreview)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function renderPreview(entry: Entry): ReactNode {
  const sections = parseSections(entry);
  const hasIntro = !!sections.intro;
  const hasNodes = sections.nodes.length > 0;
  if (!hasIntro && !hasNodes) {
    return <span style={{ color: 'var(--mut)' }}>（引言与索引均为空，先在左侧填写内容）</span>;
  }
  return (
    <>
      {hasIntro ? <div style={{ color: 'var(--mut)', marginBottom: 8 }}>{sections.intro}</div> : null}
      {sections.nodes.map((n) => (
        <div key={n.key} style={{ marginBottom: 8, paddingLeft: 10, borderLeft: '2px solid var(--bd)' }}>
          <div style={{ fontWeight: 700, margin: '4px 0 2px' }}>{n.title}</div>
          <div style={{ fontSize: 13 }}>{n.content}</div>
        </div>
      ))}
    </>
  );
}
