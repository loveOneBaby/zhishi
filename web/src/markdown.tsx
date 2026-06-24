import React from 'react';
import type { Entry } from './types';

// 轻量 markdown 渲染：支持链接 / 加粗 / 代码 / 多级标题 / 列表 / 代码块
function inline(t: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let k = 0;
  const re = /\[([^\]]+)]\((https?:\/\/[^)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    if (m.index > last) parts.push(t.slice(last, m.index));
    if (m[1] != null) {
      parts.push(
        <a key={k++} href={m[2]} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'underline', textUnderlineOffset: 3 }}>{m[1]}</a>
      );
    } else if (m[3] != null) {
      parts.push(
        <strong key={k++} style={{ fontWeight: 700 }}>{m[3]}</strong>
      );
    } else {
      parts.push(
        <code
          key={k++}
          style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '.9em', background: 'var(--sel)', padding: '1px 6px', borderRadius: '5px' }}
        >{m[4]}</code>
      );
    }
    last = re.lastIndex;
  }
  if (last < t.length) parts.push(t.slice(last));
  return parts;
}

export function renderMd(md: string): React.ReactNode {
  const lines = (md || '').split('\n');
  const out: React.ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const ln = lines[i];
    if (ln.startsWith('```')) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) { code.push(lines[i]); i++; }
      i++;
      out.push(
        <pre key={k++} style={{ background: 'var(--sel)', borderRadius: 10, padding: '14px 16px', overflowX: 'auto', fontSize: 13, lineHeight: 1.6, fontFamily: 'ui-monospace, Menlo, monospace', margin: '0 0 14px' }}>{code.join('\n')}</pre>
      );
      continue;
    }
    const heading = /^(#{2,4})\s+(.+)$/.exec(ln);
    if (heading) {
      const level = heading[1].length;
      out.push(
        <div key={k++} style={{ fontWeight: 700, fontSize: level === 2 ? 14 : level === 3 ? 13.5 : 13, margin: level === 2 ? '20px 0 8px' : '14px 0 6px' }}>{inline(heading[2])}</div>
      );
      i++;
      continue;
    }
    if (ln.startsWith('- ')) {
      const items: string[] = [];
      while (i < lines.length && lines[i].startsWith('- ')) { items.push(lines[i].slice(2)); i++; }
      out.push(
        <ul key={k++} style={{ margin: '4px 0 14px', paddingLeft: 20, lineHeight: 1.75 }}>
          {items.map((t, j) => (
            <li key={j} style={{ marginBottom: 5 }}>{inline(t)}</li>
          ))}
        </ul>
      );
      continue;
    }
    if (ln.trim() === '') { i++; continue; }
    out.push(
      <p key={k++} style={{ margin: '0 0 14px', lineHeight: 1.8 }}>{inline(ln)}</p>
    );
    i++;
  }
  return <div>{out}</div>;
}

export interface MindNode {
  key: number;
  title: React.ReactNode;
  content: React.ReactNode;
}

export interface Sections {
  intro: React.ReactNode | null;
  nodes: MindNode[];
}

// 把 body 按 ## 小标题拆分成「简介 + 若干知识点节点」，用于详情思维导图
export function parseSections(e: Entry): Sections {
  const lines = (e.body || '').split('\n');
  const intro: string[] = [];
  const secs: { title: string; lines: string[] }[] = [];
  let cur: { title: string; lines: string[] } | null = null;
  lines.forEach((ln) => {
    if (ln.startsWith('## ')) {
      cur = { title: ln.slice(3), lines: [] };
      secs.push(cur);
    } else {
      (cur ? cur.lines : intro).push(ln);
    }
  });
  const introMd = intro.join('\n').trim();
  let nodes: MindNode[];
  if (secs.length) {
    nodes = secs.map((sc, i) => ({ key: i, title: inline(sc.title), content: renderMd(sc.lines.join('\n')) }));
  } else {
    nodes = [{ key: 0, title: '详解', content: renderMd(introMd) }];
  }
  return {
    intro: secs.length && introMd ? renderMd(introMd) : null,
    nodes,
  };
}
