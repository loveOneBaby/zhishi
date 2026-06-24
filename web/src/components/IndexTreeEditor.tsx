import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { IndexNode } from '../types';
import { patchNode, removeNode, moveNode, addChild, newNode, MAX_INDEX_DEPTH } from '../outline';
import { toast } from '../toast';

interface Props {
  intro: string;
  nodes: IndexNode[];
  onSave: (intro: string, nodes: IndexNode[]) => Promise<void> | void;
}

const LEVEL_CN = ['二', '三', '四', '五', '六'];

const iconBtn: CSSProperties = {
  width: 24, height: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  border: '1px solid var(--bd)', borderRadius: 6, background: 'var(--bg)', color: 'var(--mut)',
  cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, padding: 0,
};
const textBtn: CSSProperties = {
  padding: '3px 9px', fontSize: 11.5, fontFamily: 'inherit', cursor: 'pointer',
  border: '1px solid var(--bd)', borderRadius: 6, background: 'transparent', color: 'var(--mut)',
};

function eq(a: { intro: string; nodes: IndexNode[] }, b: { intro: string; nodes: IndexNode[] }): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export default function IndexTreeEditor({ intro: introProp, nodes: nodesProp, onSave }: Props) {
  const base = useMemo(() => ({ intro: introProp, nodes: nodesProp }), [introProp, nodesProp]);
  const [intro, setIntro] = useState(introProp);
  const [nodes, setNodes] = useState<IndexNode[]>(nodesProp);
  const [openContent, setOpenContent] = useState<Set<string>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { setIntro(base.intro); setNodes(base.nodes); }, [base]);

  const dirty = !eq({ intro, nodes }, base);

  function toggleContent(id: string) {
    setOpenContent((c) => { const n = new Set(c); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  async function save() {
    if (saving) return;
    setSaving(true);
    try { await onSave(intro, nodes); setSaved(true); }
    catch (e) { toast('保存失败：' + (e instanceof Error ? e.message : String(e)), 'error'); }
    finally { setSaving(false); }
  }

  function renderNodes(list: IndexNode[], depth: number): ReactNode {
    return list.map((n, idx) => {
      const cn = LEVEL_CN[depth] ?? '更深';
      const contentOpen = openContent.has(n.id);
      return (
        <div key={n.id} style={{ marginLeft: depth * 18, marginTop: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', border: '1px solid var(--bd)', borderRadius: 9, background: 'var(--panel)' }}>
            <span style={{ fontSize: 10.5, color: 'var(--mut)', whiteSpace: 'nowrap', width: 46, flexShrink: 0 }}>{cn}级索引</span>
            <input
              value={n.title}
              onChange={(e) => { setNodes((cur) => patchNode(cur, n.id, { title: e.target.value })); setSaved(false); }}
              placeholder="索引标题"
              spellCheck={false}
              style={{ flex: 1, minWidth: 0, padding: '5px 8px', fontSize: 13, fontFamily: 'inherit', color: 'var(--fg)', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 7, outline: 'none' }}
            />
            <button style={{ ...iconBtn, opacity: idx === 0 ? 0.35 : 1 }} disabled={idx === 0} title="上移" onClick={() => { setNodes((cur) => moveNode(cur, n.id, -1)); setSaved(false); }}>↑</button>
            <button style={{ ...iconBtn, opacity: idx === list.length - 1 ? 0.35 : 1 }} disabled={idx === list.length - 1} title="下移" onClick={() => { setNodes((cur) => moveNode(cur, n.id, 1)); setSaved(false); }}>↓</button>
            <button style={{ ...textBtn, color: contentOpen ? 'var(--fg)' : 'var(--mut)' }} title="编辑该索引的内容" onClick={() => toggleContent(n.id)}>内容</button>
            {depth < MAX_INDEX_DEPTH && (
              <button style={textBtn} title="新增下级索引" onClick={() => { setNodes((cur) => addChild(cur, n.id, newNode())); setOpenContent((c) => new Set(c).add(n.id)); setSaved(false); }}>＋下级</button>
            )}
            <button style={{ ...iconBtn, color: 'var(--danger)' }} title="删除该索引及其下级" onClick={() => { setNodes((cur) => removeNode(cur, n.id)); setSaved(false); }}>✕</button>
          </div>
          {contentOpen && (
            <textarea
              value={n.content}
              onChange={(e) => { setNodes((cur) => patchNode(cur, n.id, { content: e.target.value })); setSaved(false); }}
              placeholder="该索引下的内容（支持 - 列表、**加粗**、`代码`、```代码块```）"
              spellCheck={false}
              style={{ width: '100%', marginTop: 6, minHeight: 80, padding: '10px 12px', fontSize: 12.5, lineHeight: 1.6, fontFamily: 'ui-monospace, Menlo, monospace', color: 'var(--fg)', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 8, outline: 'none', resize: 'vertical' }}
            />
          )}
          {n.children.length > 0 && renderNodes(n.children, depth + 1)}
        </div>
      );
    });
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--mut)' }}>多级索引 · 知识点为一级，下设二/三/四级</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {saved && !dirty && <span style={{ fontSize: 11.5, color: 'var(--mut)' }}>已保存</span>}
          <button style={textBtn} onClick={() => { setNodes((cur) => [...cur, newNode()]); setSaved(false); }}>＋ 添加二级索引</button>
          <button style={textBtn} disabled={!dirty} onClick={() => { setIntro(base.intro); setNodes(base.nodes); }}>还原</button>
          <button
            onClick={save}
            disabled={saving || !dirty}
            style={{ padding: '5px 14px', fontSize: 12, fontFamily: 'inherit', cursor: dirty ? 'pointer' : 'default', background: dirty ? 'var(--fg)' : 'var(--sel)', color: dirty ? 'var(--bg)' : 'var(--mut)', border: 'none', borderRadius: 7, fontWeight: 600 }}
          >{saving ? '保存中…' : '保存索引'}</button>
        </div>
      </div>

      <textarea
        value={intro}
        onChange={(e) => { setIntro(e.target.value); setSaved(false); }}
        placeholder="引言 / 概述（第一个索引之前，可留空）"
        spellCheck={false}
        style={{ width: '100%', minHeight: 48, padding: '8px 12px', fontSize: 12.5, lineHeight: 1.6, fontFamily: 'inherit', color: 'var(--fg)', background: 'var(--bg)', border: '1px dashed var(--bd)', borderRadius: 8, outline: 'none', resize: 'vertical' }}
      />

      {nodes.length === 0 && (
        <div style={{ padding: 16, textAlign: 'center', color: 'var(--mut)', fontSize: 12.5 }}>暂无索引，点击「＋ 添加二级索引」开始构建。</div>
      )}
      {renderNodes(nodes, 0)}
    </div>
  );
}
