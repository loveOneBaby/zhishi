import type { Entry } from '../types';
import { chip } from '../ui';

interface Props {
  entries: Entry[];
  activeCat: string;
  setCat: (c: string) => void;
  onOpen: (id: string) => void;
  onNew: () => void;
}

const ORDER = ['前端', 'Java', '基础', '算法', '自定义'];

export default function FreeMode({ entries, activeCat, setCat, onOpen, onNew }: Props) {
  // 分类顺序：预设在前，其余按出现顺序补充
  const seen: Record<string, boolean> = {};
  entries.forEach((e) => { if (!ORDER.includes(e.cat)) seen[e.cat] = true; });
  const catList = ORDER.concat(Object.keys(seen));
  const cats = ['全部'].concat(catList.filter((c) => entries.some((e) => e.cat === c)));
  const groups = catList
    .filter((c) => entries.some((e) => e.cat === c) && (activeCat === '全部' || activeCat === c))
    .map((c) => ({ cat: c, items: entries.filter((e) => e.cat === c) }));

  return (
    <div style={{ padding: '28px 0 60px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {cats.map((c) => (
            <button key={c} style={chip(activeCat === c)} onClick={() => setCat(c)}>{c}</button>
          ))}
        </div>
        <button onClick={onNew} style={{ padding: '9px 16px', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer', background: 'var(--fg)', color: 'var(--bg)', border: 'none', borderRadius: 9, fontWeight: 500 }}>＋ 新建知识点</button>
      </div>

      {groups.map((g) => (
        <div key={g.cat} style={{ marginBottom: 30 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--mut)', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 12 }}>{g.cat} · {g.items.length}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
            {g.items.map((item) => (
              <div
                key={item.id}
                onClick={() => onOpen(item.id)}
                style={{ padding: 16, background: 'var(--panel)', border: '1px solid var(--bd)', borderRadius: 12, cursor: 'pointer' }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--mut)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--bd)'; }}
              >
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{item.title}</div>
                <div style={{ fontSize: 13, color: 'var(--mut)', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{item.summary}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
