import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { Entry } from '../types';
import type { EntryInput } from '../api';
import { renderMd } from '../markdown';

interface Props {
  initial?: Entry | null;        // 传入则为「编辑」，否则为「新建」
  knownCats: string[];           // 已有知识库，供下拉补全
  onClose: () => void;
  onSubmit: (input: EntryInput) => Promise<void> | void;
}

const inputStyle: CSSProperties = {
  width: '100%', padding: '11px 13px', fontSize: 14, fontFamily: 'inherit',
  color: 'var(--fg)', background: 'var(--bg)', border: '1px solid var(--bd)',
  borderRadius: 10, outline: 'none',
};
const labelStyle: CSSProperties = { fontSize: 12, color: 'var(--mut)', marginBottom: 6, display: 'block' };

export default function EntryEditorModal({ initial, knownCats, onClose, onSubmit }: Props) {
  const editing = Boolean(initial);
  const [title, setTitle] = useState(initial?.title ?? '');
  const [cat, setCat] = useState(initial?.cat ?? (knownCats[0] || '前端'));
  const [tags, setTags] = useState((initial?.tags ?? []).join(', '));
  const [summary, setSummary] = useState(initial?.summary ?? '');
  const [intro, setIntro] = useState(initial?.intro ?? '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    if (saving) return;
    if (!title.trim()) { setErr('标题不能为空'); return; }
    if (!cat.trim()) { setErr('请填写所属知识库'); return; }
    setErr('');
    setSaving(true);
    const tagList = tags.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    try {
      // 仅维护基础信息与引言；多级索引在管理列表展开后编辑，编辑时保留已有 nodes
      await onSubmit({ title: title.trim(), cat: cat.trim(), tags: tagList, summary: summary.trim(), intro, nodes: initial?.nodes });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.34)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '48px 20px', overflowY: 'auto', zIndex: 60, animation: 'ik-fade .15s' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 920, background: 'var(--panel)', border: '1px solid var(--bd)', borderRadius: 16, padding: 24, animation: 'ik-pop .18s ease' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>{editing ? '编辑知识点' : '新建知识点'}</div>
          <button onClick={onClose} style={{ background: 'var(--sel)', border: 'none', width: 30, height: 30, borderRadius: 8, cursor: 'pointer', color: 'var(--mut)', fontSize: 15 }}>✕</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 20 }}>
          {/* 左：表单 */}
          <div>
            <label style={labelStyle}>标题</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如：闭包" spellCheck={false} style={{ ...inputStyle, marginBottom: 14 }} />

            <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <label style={labelStyle}>知识库</label>
                <input list="kb-list" value={cat} onChange={(e) => setCat(e.target.value)} placeholder="所属知识库" spellCheck={false} style={inputStyle} />
                <datalist id="kb-list">
                  {knownCats.map((c) => <option key={c} value={c} />)}
                </datalist>
              </div>
              <div style={{ flex: 1.3, minWidth: 0 }}>
                <label style={labelStyle}>标签（逗号分隔）</label>
                <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="JS, 作用域" spellCheck={false} style={inputStyle} />
              </div>
            </div>

            <label style={labelStyle}>摘要（可留空，自动取引言首行）</label>
            <input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="一句话概述" spellCheck={false} style={{ ...inputStyle, marginBottom: 14 }} />

            <label style={labelStyle}>引言 / 概述（支持 - 列表、**加粗**、`代码`）</label>
            <textarea value={intro} onChange={(e) => setIntro(e.target.value)} placeholder={'对该知识点的总览，多级索引在保存后于列表中展开编辑。'} spellCheck={false} style={{ ...inputStyle, minHeight: 200, lineHeight: 1.6, resize: 'vertical', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 13 }} />
            {editing && <div style={{ fontSize: 11.5, color: 'var(--mut)', marginTop: 8 }}>多级索引（二/三/四级）请在管理列表中展开本知识点进行编辑与排序。</div>}
          </div>

          {/* 右：实时预览 */}
          <div style={{ minWidth: 0 }}>
            <label style={labelStyle}>实时预览</label>
            <div style={{ border: '1px solid var(--bd)', borderRadius: 10, padding: '16px 18px', background: 'var(--bg)', minHeight: 320, maxHeight: 460, overflow: 'auto' }}>
              <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>{title || '（标题）'}</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, fontSize: 11, color: 'var(--mut)' }}>
                <span style={{ border: '1px solid var(--bd)', borderRadius: 6, padding: '2px 8px' }}>{cat || '知识库'}</span>
                {tags.split(/[,，]/).map((s) => s.trim()).filter(Boolean).map((tg, i) => <span key={i}>#{tg}</span>)}
              </div>
              {summary && <div style={{ fontSize: 13, color: 'var(--mut)', marginBottom: 12, lineHeight: 1.6 }}>{summary}</div>}
              <div style={{ fontSize: 13.5 }}>{renderMd(intro)}</div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 18 }}>
          <span style={{ fontSize: 12, color: '#e5484d' }}>{err}</span>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={onClose} style={{ padding: '9px 16px', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer', background: 'transparent', color: 'var(--mut)', border: '1px solid var(--bd)', borderRadius: 9 }}>取消</button>
            <button onClick={submit} disabled={saving} style={{ padding: '9px 20px', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer', background: 'var(--fg)', color: 'var(--bg)', border: 'none', borderRadius: 9, fontWeight: 500, opacity: saving ? 0.6 : 1 }}>{saving ? '保存中…' : '保存'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
