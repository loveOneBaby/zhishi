import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { NewEntryInput } from '../api';

interface Props {
  onClose: () => void;
  onSave: (input: NewEntryInput) => Promise<void> | void;
}

const CATS = ['前端', 'Java', '基础', '算法', '自定义'];

export default function NewEntryModal({ onClose, onSave }: Props) {
  const [title, setTitle] = useState('');
  const [cat, setCat] = useState('前端');
  const [tags, setTags] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);

  const inputStyle: CSSProperties = {
    width: '100%', padding: '12px 14px', fontSize: 15, fontFamily: 'inherit',
    color: 'var(--fg)', background: 'var(--bg)', border: '1px solid var(--bd)',
    borderRadius: 10, outline: 'none',
  };

  async function save() {
    if (!title.trim() || saving) return;
    setSaving(true);
    const tagList = tags.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    try {
      await onSave({ title: title.trim(), cat, tags: tagList, body });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.32)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '60px 20px', overflowY: 'auto', zIndex: 50, animation: 'ik-fade .15s' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 560, background: 'var(--panel)', border: '1px solid var(--bd)', borderRadius: 16, padding: 28, animation: 'ik-pop .18s ease' }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>新建知识点</div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="标题" spellCheck={false} style={{ ...inputStyle, marginBottom: 12 }} />
        <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
          <select value={cat} onChange={(e) => setCat(e.target.value)} style={{ ...inputStyle, flex: 1, fontSize: 14 }}>
            {CATS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="标签，逗号分隔" spellCheck={false} style={{ ...inputStyle, flex: 1.4, fontSize: 14 }} />
        </div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="内容（支持 ## 小标题、- 列表、**加粗**、`代码`）"
          spellCheck={false}
          style={{ ...inputStyle, minHeight: 160, fontSize: 14, lineHeight: 1.6, resize: 'vertical' }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
          <button onClick={onClose} style={{ padding: '9px 16px', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer', background: 'transparent', color: 'var(--mut)', border: '1px solid var(--bd)', borderRadius: 9 }}>取消</button>
          <button onClick={save} disabled={saving} style={{ padding: '9px 18px', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer', background: 'var(--fg)', color: 'var(--bg)', border: 'none', borderRadius: 9, fontWeight: 500, opacity: saving ? 0.6 : 1 }}>{saving ? '保存中…' : '保存'}</button>
        </div>
      </div>
    </div>
  );
}
