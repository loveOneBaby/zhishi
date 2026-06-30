import React from 'react';
import type { Entry } from './types';
import { highlightText } from './highlight';
import { resolveAssetUrl } from './api/client';

function safeImageSrc(src: string): string {
  const s = src.trim();
  if (/^\/(Users|var|private|tmp|home)\//i.test(s)) return '';
  if (/^(https?:\/\/|data:image\/|\/)/i.test(s)) return resolveAssetUrl(s);
  return '';
}

function imageNode(src: string, alt: string, key: React.Key): React.ReactNode {
  const safe = safeImageSrc(src);
  if (!safe) {
    return <span key={key} style={{ color: 'var(--mut)' }}>{alt || '图片'}</span>;
  }
  return (
    <figure key={key} style={{ margin: '10px 0 16px' }}>
      <img
        src={safe}
        alt={alt}
        loading="lazy"
        style={{
          display: 'block',
          maxWidth: '100%',
          maxHeight: 520,
          objectFit: 'contain',
          borderRadius: 14,
          border: '1px solid var(--bd)',
          background: 'var(--bg)',
        }}
      />
      {alt ? <figcaption style={{ marginTop: 6, fontSize: 12, color: 'var(--mut)', lineHeight: 1.5 }}>{alt}</figcaption> : null}
    </figure>
  );
}

// 轻量 markdown 渲染：支持图片 / 链接 / 加粗 / 代码 / 多级标题 / 列表 / 代码块
function inline(t: string, query = ''): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let k = 0;
  const re = /!\[([^\]]*)]\(([^)]+)\)|\[([^\]]+)]\((https?:\/\/[^)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    if (m.index > last) parts.push(<React.Fragment key={k++}>{highlightText(t.slice(last, m.index), query)}</React.Fragment>);
    if (m[1] != null) {
      parts.push(imageNode(m[2], m[1], k++));
    } else if (m[3] != null) {
      parts.push(
        <a key={k++} href={m[4]} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'underline', textUnderlineOffset: 3 }}>{highlightText(m[3], query)}</a>
      );
    } else if (m[5] != null) {
      parts.push(
        <strong key={k++} style={{ fontWeight: 700 }}>{highlightText(m[5], query)}</strong>
      );
    } else {
      parts.push(
        <code
          key={k++}
          style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '.9em', background: 'var(--sel)', padding: '1px 6px', borderRadius: '5px' }}
        >{highlightText(m[6], query)}</code>
      );
    }
    last = re.lastIndex;
  }
  if (last < t.length) parts.push(<React.Fragment key={k++}>{highlightText(t.slice(last), query)}</React.Fragment>);
  return parts;
}

export function renderMd(md: string, query = ''): React.ReactNode {
  const lines = (md || '').split('\n');
  const out: React.ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const ln = lines[i];
    const img = /^!\[([^\]]*)]\((.+)\)$/.exec(ln.trim());
    if (img) {
      out.push(imageNode(img[2], img[1], k++));
      i++;
      continue;
    }
    if (ln.startsWith('```')) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) { code.push(lines[i]); i++; }
      i++;
      out.push(
        <pre key={k++} style={{ background: 'var(--sel)', borderRadius: 10, padding: '14px 16px', overflowX: 'auto', fontSize: 13, lineHeight: 1.6, fontFamily: 'ui-monospace, Menlo, monospace', margin: '0 0 14px' }}>{highlightText(code.join('\n'), query)}</pre>
      );
      continue;
    }
    const heading = /^(#{2,4})\s+(.+)$/.exec(ln);
    if (heading) {
      const level = heading[1].length;
      out.push(
        <div key={k++} style={{ fontWeight: 700, fontSize: level === 2 ? 14 : level === 3 ? 13.5 : 13, margin: level === 2 ? '20px 0 8px' : '14px 0 6px' }}>{inline(heading[2], query)}</div>
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
            <li key={j} style={{ marginBottom: 5 }}>{inline(t, query)}</li>
          ))}
        </ul>
      );
      continue;
    }
    if (ln.trim() === '') { i++; continue; }
    out.push(
      <p key={k++} style={{ margin: '0 0 14px', lineHeight: 1.8 }}>{inline(ln, query)}</p>
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

// 渲染一个索引节点的内容：自身内容 + 递归的下级索引（标题加粗 + 内容）
function renderNodeContent(node: import('./types').IndexNode, query: string): React.ReactNode {
  return (
    <>
      {node.content.trim() ? renderMd(node.content, query) : null}
      {node.children.map((child) => (
        <div key={child.id} style={{ marginTop: 10, paddingLeft: 12, borderLeft: '2px solid var(--bd)' }}>
          <div style={{ fontWeight: 700, fontSize: 13, margin: '0 0 4px' }}>{highlightText(child.title, query)}</div>
          {renderNodeContent(child, query)}
        </div>
      ))}
    </>
  );
}

// 用结构化索引构建「简介 + 若干索引节点」，用于详情思维导图
export function parseSections(e: Entry, query = ''): Sections {
  const introNode = e.intro && e.intro.trim() ? renderMd(e.intro, query) : null;
  if (!e.nodes || e.nodes.length === 0) {
    return { intro: null, nodes: [{ key: 0, title: highlightText('详解', query), content: introNode ?? <span style={{ color: 'var(--mut)' }}>暂无内容</span> }] };
  }
  const nodes: MindNode[] = e.nodes.map((n, i) => ({
    key: i,
    title: highlightText(n.title, query),
    content: renderNodeContent(n, query),
  }));
  return { intro: introNode, nodes };
}
