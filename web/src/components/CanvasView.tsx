import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import cytoscape from 'cytoscape';
import type { Core } from 'cytoscape';
import type { Entry, Theme } from '../types';

interface Props {
  entries: Entry[];
  theme: Theme;
  onOpen: (id: string) => void;
  hasQuery: boolean; // 顶部是否正在检索（决定是否铺开全部相关知识）
}

type NType = 'cat' | 'entry' | 'section';

interface GNode {
  id: string;
  label: string;
  type: NType;
  sub?: string;         // 直接显示在节点上的知识内容（摘要 / 小节片段）
  entryId?: string;     // entry / section 对应的真实知识点 id
  parentId: string | null;
  children: string[];
  text: string;         // 用于「知识库内搜索」的可检索文本
}

const VISIBLE_DEPTH = 2; // 知识库 → 知识点 → 小节，默认至少 3 层

function parseHeadings(body: string): { title: string; content: string }[] {
  const lines = (body || '').split('\n');
  const secs: { title: string; lines: string[] }[] = [];
  let cur: { title: string; lines: string[] } | null = null;
  for (const ln of lines) {
    if (ln.startsWith('## ')) { cur = { title: ln.slice(3), lines: [] }; secs.push(cur); }
    else if (cur) { cur.lines.push(ln); }
  }
  return secs.map((s) => ({ title: s.title, content: s.lines.join(' ') }));
}

// 每个分类即一个「知识库」（无上层根）：知识库 → 知识点 → 小节
function buildModel(entries: Entry[]): { map: Map<string, GNode>; kbs: string[] } {
  const map = new Map<string, GNode>();
  const kbs: string[] = [];
  for (const e of entries) {
    const kbId = 'kb::' + e.cat;
    if (!map.has(kbId)) {
      map.set(kbId, { id: kbId, label: e.cat, type: 'cat', parentId: null, children: [], text: e.cat.toLowerCase() });
      kbs.push(kbId);
    }
    const entryNodeId = 'ent::' + e.id;
    map.set(entryNodeId, {
      id: entryNodeId, label: e.title, type: 'entry', sub: e.summary, entryId: e.id, parentId: kbId, children: [],
      text: [e.title, e.py, e.tags.join(' '), e.summary, e.body].join(' ').toLowerCase(),
    });
    map.get(kbId)!.children.push(entryNodeId);
    parseHeadings(e.body).forEach((h, i) => {
      const sid = entryNodeId + '#' + i;
      const snippet = h.content.replace(/[#*`>-]/g, '').trim();
      map.set(sid, {
        id: sid, label: h.title, type: 'section', sub: snippet.slice(0, 40) + (snippet.length > 40 ? '…' : ''),
        entryId: e.id, parentId: entryNodeId, children: [],
        text: (h.title + ' ' + h.content).toLowerCase(),
      });
      map.get(entryNodeId)!.children.push(sid);
    });
  }
  return { map, kbs };
}

// 当前知识库下应显示的节点集合
function collectVisible(map: Map<string, GNode>, rootId: string, query: string, expandAll: boolean): Set<string> {
  const included = new Set<string>();
  const root = map.get(rootId);
  if (!root) return included;
  const q = query.trim().toLowerCase();

  if (!q) {
    const limit = expandAll ? Infinity : VISIBLE_DEPTH;
    const stack: { id: string; d: number }[] = [{ id: rootId, d: 0 }];
    while (stack.length) {
      const { id, d } = stack.pop()!;
      included.add(id);
      if (d < limit) for (const c of map.get(id)!.children) stack.push({ id: c, d: d + 1 });
    }
    return included;
  }

  // 知识库内搜索：命中文本的节点，连同到知识库的路径一起显示
  const sub: string[] = [];
  const st = [rootId];
  while (st.length) { const id = st.pop()!; sub.push(id); for (const c of map.get(id)!.children) st.push(c); }
  for (const id of sub) {
    if (id === rootId) continue;
    if (map.get(id)!.text.includes(q)) {
      let cur: string | null = id;
      while (cur) { included.add(cur); if (cur === rootId) break; cur = map.get(cur)!.parentId; }
    }
  }
  included.add(rootId);
  return included;
}

export default function CanvasView({ entries, theme: t, onOpen, hasQuery }: Props) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  const { map: model, kbs } = useMemo(() => buildModel(entries), [entries]);

  const [kbId, setKbId] = useState('');
  const [scoped, setScoped] = useState('');
  const [immersive, setImmersive] = useState(false);

  // 知识库失效（如检索后该分类无结果）则回到第一个
  useEffect(() => {
    if (!kbId || !model.has(kbId)) { setKbId(kbs[0] ?? ''); setScoped(''); }
  }, [model, kbs, kbId]);

  const currentKb = model.get(kbId) || (kbs[0] ? model.get(kbs[0])! : undefined);

  function selectKb(id: string) { setKbId(id); setScoped(''); }
  function cycleKb(dir: number) {
    if (!kbs.length) return;
    const idx = Math.max(0, kbs.indexOf(currentKb?.id ?? kbs[0]));
    selectKb(kbs[(idx + dir + kbs.length) % kbs.length]);
  }
  const cycleRef = useRef(cycleKb);
  cycleRef.current = cycleKb;

  // 构建 / 重建画布
  useEffect(() => {
    if (!elRef.current || !currentKb) return;
    const visible = collectVisible(model, currentKb.id, scoped, hasQuery);

    const els: cytoscape.ElementDefinition[] = [];
    for (const id of visible) {
      const n = model.get(id)!;
      const display = n.sub ? `${n.label}\n${n.sub}` : n.label;
      els.push({ data: { id, label: display, type: n.type } });
      if (n.parentId && visible.has(n.parentId)) {
        els.push({ data: { id: 'e_' + id, source: n.parentId, target: id } });
      }
    }

    const style: any[] = [
      { selector: 'node', style: { label: 'data(label)', color: t.fg, 'text-valign': 'center', 'text-halign': 'center', 'font-family': t.font, 'text-wrap': 'wrap' } },
      { selector: 'node[type="cat"]', style: { 'background-color': t.fg, color: t.bg, 'font-size': 15, 'font-weight': 700, width: 84, height: 84, 'text-max-width': 68, 'border-color': t.accent, 'border-width': 3, shape: 'round-rectangle' } },
      { selector: 'node[type="entry"]', style: { 'background-color': t.panel, 'border-color': t.bd, 'border-width': 1, 'font-size': 12, 'text-max-width': 176, width: 200, height: 70, 'padding': 8, shape: 'round-rectangle' } },
      { selector: 'node[type="section"]', style: { 'background-color': t.sel, 'border-color': t.bd, 'border-width': 1, color: t.fg, 'font-size': 10.5, 'text-max-width': 156, width: 178, height: 56, 'padding': 6, shape: 'round-rectangle' } },
      { selector: 'edge', style: { 'line-color': t.bd, width: 1.5, 'curve-style': 'bezier', 'target-arrow-shape': 'none' } },
      { selector: 'node:active', style: { 'overlay-opacity': 0 } },
    ];

    const cy = cytoscape({
      container: elRef.current,
      elements: els,
      minZoom: 0.2,
      maxZoom: 2.5,
      wheelSensitivity: 0.25,
      style,
    });
    const layout: any = { name: 'breadthfirst', directed: true, roots: cy.getElementById(currentKb.id), padding: 30, spacingFactor: 1.1, animate: false };
    cy.layout(layout).run();
    cy.fit(undefined, 40);

    cy.on('tap', 'node', (evt) => {
      const n = model.get(evt.target.id());
      if (!n) return;
      if (n.entryId) onOpenRef.current(n.entryId); // 知识点 / 小节 → 打开详情
    });

    cyRef.current = cy;
    return () => { cy.destroy(); cyRef.current = null; };
  }, [model, currentKb?.id, scoped, t, hasQuery]);

  // 进出沉浸模式时容器尺寸变化，画布需重新适配
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const id = setTimeout(() => { cy.resize(); cy.fit(undefined, 40); }, 60);
    return () => clearTimeout(id);
  }, [immersive]);

  // 沉浸模式快捷键：Esc 退出 / 左⌘ 呼出搜索 / 右⌘ 选择知识库
  // 用「按下到松开之间无其它按键」判定为单击 Command，避免误触组合键
  const metaRef = useRef<{ code: string | null; other: boolean }>({ code: null, other: false });
  useEffect(() => {
    if (!immersive) return;
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); setImmersive(false); return; }
      if (e.key === 'Meta') metaRef.current = { code: e.code, other: false };
      else metaRef.current.other = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.key !== 'Meta') return;
      const st = metaRef.current;
      if (st.code && !st.other) {
        if (st.code === 'MetaLeft') searchRef.current?.focus();
        else if (st.code === 'MetaRight') cycleRef.current(1);
      }
      metaRef.current = { code: null, other: false };
    };
    document.addEventListener('keydown', down, true);
    document.addEventListener('keyup', up, true);
    return () => {
      document.removeEventListener('keydown', down, true);
      document.removeEventListener('keyup', up, true);
    };
  }, [immersive]);

  const chip = (active: boolean): CSSProperties => ({
    padding: '6px 13px', borderRadius: 8, border: '1px solid var(--bd)', cursor: 'pointer',
    fontSize: 12.5, fontFamily: 'inherit', whiteSpace: 'nowrap', transition: 'all .12s',
    background: active ? 'var(--fg)' : 'transparent', color: active ? 'var(--bg)' : 'var(--mut)',
    fontWeight: active ? 600 : 400,
  });
  const immBtn: CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', fontSize: 13,
    fontFamily: 'inherit', cursor: 'pointer', background: 'var(--panel)', color: 'var(--mut)',
    border: '1px solid var(--bd)', borderRadius: 9, whiteSpace: 'nowrap',
  };

  if (!currentKb) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--mut)', fontSize: 13, border: '1px solid var(--bd)', borderRadius: 16 }}>暂无可展示的知识库</div>;
  }

  const toolbar = (
    <div style={{ marginBottom: 10, flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        {/* 知识库选择 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--mut)', marginRight: 2 }}>知识库</span>
          {kbs.map((id) => (
            <button key={id} style={chip(id === currentKb.id)} onClick={() => selectKb(id)}>{model.get(id)!.label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ position: 'relative', minWidth: 190 }}>
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--mut)', fontSize: 13 }}>⌕</span>
            <input
              ref={searchRef}
              value={scoped}
              onChange={(e) => setScoped(e.target.value)}
              placeholder={`在「${currentKb.label}」内搜索…`}
              spellCheck={false}
              style={{ width: '100%', padding: '8px 12px 8px 30px', fontSize: 13, fontFamily: 'inherit', color: 'var(--fg)', background: 'var(--panel)', border: '1px solid var(--bd)', borderRadius: 9, outline: 'none' }}
            />
          </div>
          <button style={immBtn} onClick={() => setImmersive((v) => !v)} title={immersive ? '退出沉浸模式 (Esc)' : '沉浸模式'}>
            {immersive ? '⤡ 退出' : '⤢ 沉浸'}
          </button>
        </div>
      </div>
      {immersive && (
        <div style={{ marginTop: 8, display: 'flex', gap: 16, fontSize: 12, color: 'var(--mut)' }}>
          <span>左 ⌘ 呼出搜索</span>
          <span>右 ⌘ 切换知识库</span>
          <span>Esc 退出</span>
        </div>
      )}
    </div>
  );

  const canvas = (
    <div
      ref={elRef}
      style={{ width: '100%', flex: immersive ? 1 : undefined, minHeight: 0, height: immersive ? undefined : '72vh', background: 'var(--panel)', backgroundImage: 'radial-gradient(var(--bd) 1px, transparent 1px)', backgroundSize: '24px 24px', border: '1px solid var(--bd)', borderRadius: 16, overflow: 'hidden' }}
    />
  );

  // 同一结构只切换外层样式，保持画布 DOM 元素不变（避免 cytoscape 容器失效）
  const wrapStyle: CSSProperties = immersive
    ? { position: 'fixed', inset: 0, zIndex: 45, background: 'var(--bg)', display: 'flex', flexDirection: 'column', padding: '16px 20px' }
    : {};

  return (
    <div style={wrapStyle}>
      {toolbar}
      {canvas}
    </div>
  );
}
