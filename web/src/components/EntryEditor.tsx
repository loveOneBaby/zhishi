import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { Entry, EntryInput, IndexNode, KnowledgeBase, Folder } from '../types';
import { forestOfKb } from '../tree';
import type { FolderNode } from '../tree';
import { renderMd } from '../markdown';
import { toast } from '../toast';

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '9px 11px',
  border: '1px solid var(--bd)',
  borderRadius: 10,
  background: 'var(--panel)',
  color: 'var(--fg)',
  fontSize: 13,
  outline: 'none',
  fontFamily: 'inherit',
};

const ghostBtn: CSSProperties = {
  padding: '9px 13px',
  border: '1px solid var(--bd)',
  borderRadius: 12,
  background: 'var(--panel)',
  color: 'var(--fg)',
  cursor: 'pointer',
  fontSize: 13,
  fontFamily: 'inherit',
};

const primaryBtn: CSSProperties = {
  padding: '10px 18px',
  borderRadius: 12,
  border: 'none',
  background: 'var(--accent)',
  color: '#fff',
  fontWeight: 760,
  fontSize: 13,
  fontFamily: 'inherit',
  cursor: 'pointer',
};

let idSeed = 0;
function newIndexNode(title: string): IndexNode {
  idSeed += 1;
  return {
    id: `ix_${Date.now().toString(36)}_${idSeed}`,
    title,
    content: '',
    children: [],
  };
}

function folderOptions(roots: FolderNode[], depth = 0): ReactNode[] {
  return roots.flatMap((n) => {
    const prefix = depth > 0 ? '　'.repeat(depth) + '└ ' : '';
    return [
      <option key={n.folder.id} value={n.folder.id}>
        {prefix}
        {n.folder.name}
      </option>,
      ...folderOptions(n.children, depth + 1),
    ];
  });
}

function nodeToMarkdown(node: IndexNode, level: number): string {
  const heading = `${'#'.repeat(Math.min(level, 6))} ${node.title.trim() || '未命名'}`;
  const parts = [heading];
  if (node.content.trim()) parts.push(node.content.trim());
  for (const child of node.children) parts.push(nodeToMarkdown(child, level + 1));
  return parts.join('\n\n');
}

function entryToDocument(entry: Entry | null): string {
  if (!entry) return '';
  const parts: string[] = [];
  if (entry.intro.trim()) parts.push(entry.intro.trim());
  for (const node of entry.nodes) parts.push(nodeToMarkdown(node, 2));
  return parts.join('\n\n').trim();
}

function parseDocumentToIndex(body: string): { intro: string; nodes: IndexNode[] } {
  const lines = (body || '').split('\n');
  const intro: string[] = [];
  const roots: IndexNode[] = [];
  const stack: { node: IndexNode; level: number; lines: string[] }[] = [];

  const flush = (frame: { node: IndexNode; lines: string[] }): void => {
    frame.node.content = frame.lines.join('\n').replace(/^\s*\n/, '').replace(/\s+$/, '');
  };

  for (const line of lines) {
    const heading = /^(#{2,6})\s+(.+)$/.exec(line);
    if (!heading) {
      if (stack.length) stack[stack.length - 1].lines.push(line);
      else intro.push(line);
      continue;
    }

    const level = heading[1].length;
    const node = newIndexNode(heading[2].trim());
    while (stack.length && stack[stack.length - 1].level >= level) flush(stack.pop()!);
    if (stack.length) stack[stack.length - 1].node.children.push(node);
    else roots.push(node);
    stack.push({ node, level, lines: [] });
  }

  while (stack.length) flush(stack.pop()!);
  return { intro: intro.join('\n').trim(), nodes: roots };
}

function flattenNodes(nodes: IndexNode[]): IndexNode[] {
  const out: IndexNode[] = [];
  const walk = (list: IndexNode[]): void => {
    for (const node of list) {
      out.push(node);
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

function cleanLine(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-*]\s+/, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .trim();
}

function deriveSummary(title: string, doc: string, tree: { intro: string; nodes: IndexNode[] }): string {
  const firstText = doc
    .split('\n')
    .map(cleanLine)
    .find((line) => line && line !== title.trim());
  return (firstText || tree.nodes[0]?.title || title.trim() || '自建知识点').slice(0, 160);
}

function snapshot(d: {
  title: string;
  kbId: string;
  folderId: string | null;
  tags: string[];
  doc: string;
}): string {
  return JSON.stringify({
    title: d.title.trim(),
    kbId: d.kbId,
    folderId: d.folderId,
    tags: d.tags,
    doc: d.doc.trim(),
  });
}

interface Props {
  initial: Entry | null;
  kbs: KnowledgeBase[];
  folders: Folder[];
  defaultKbId?: string;
  defaultFolderId?: string | null;
  onSave: (input: EntryInput) => Promise<Entry>;
  onCancel?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}

export default function EntryEditor(props: Props): ReactNode {
  const { initial, kbs, folders, defaultKbId, defaultFolderId, onSave, onCancel, onDirtyChange } = props;
  const isEdit = !!initial;

  const [title, setTitle] = useState(initial?.title ?? '');
  const [kbId, setKbId] = useState(initial?.kbId ?? defaultKbId ?? kbs[0]?.id ?? '');
  const [folderId, setFolderId] = useState<string | null>(initial?.folderId ?? defaultFolderId ?? null);
  const [tags, setTags] = useState(initial?.tags.join(', ') ?? '');
  const [doc, setDoc] = useState(entryToDocument(initial));
  const [showPreview, setShowPreview] = useState(false);
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
      kbId: initial?.kbId ?? defaultKbId ?? kbs[0]?.id ?? '',
      folderId: initial?.folderId ?? defaultFolderId ?? null,
      tags: initial?.tags ?? [],
      doc: entryToDocument(initial),
    });
  }

  const tree = useMemo(() => parseDocumentToIndex(doc), [doc]);
  const nodes = useMemo(() => flattenNodes(tree.nodes), [tree.nodes]);
  const dirty = snapshot({ title, kbId, folderId, tags: tagList, doc }) !== baseRef.current;
  const selectedKbName = kbs.find((k) => k.id === kbId)?.name ?? '知识库';
  const selectedFolderName = folderId ? folders.find((f) => f.id === folderId)?.name ?? '文件夹' : '根目录';
  const headingCount = nodes.length;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  function handleSave(): void {
    if (saving) return;
    if (!title.trim()) {
      toast('标题不能为空', 'error');
      return;
    }
    if (!kbId) {
      toast('请选择知识库', 'error');
      return;
    }

    const nextTree = parseDocumentToIndex(doc);
    setSaving(true);
    onSave({
      title: title.trim(),
      kbId,
      folderId,
      tags: tagList,
      summary: deriveSummary(title, doc, nextTree),
      py: title.trim(),
      intro: nextTree.intro,
      nodes: nextTree.nodes,
    })
      .then((saved) => {
        const nextDoc = entryToDocument(saved);
        setTitle(saved.title);
        setKbId(saved.kbId);
        setFolderId(saved.folderId);
        setTags(saved.tags.join(', '));
        setDoc(nextDoc);
        baseRef.current = snapshot({
          title: saved.title,
          kbId: saved.kbId,
          folderId: saved.folderId,
          tags: saved.tags,
          doc: nextDoc,
        });
        setSavedAt(Date.now());
        toast(isEdit ? '知识点已更新' : '知识点已创建', 'success');
      })
      .catch((e) => {
        toast('保存失败：' + (e instanceof Error ? e.message : String(e)), 'error');
      })
      .finally(() => setSaving(false));
  }

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
  }, [title, kbId, folderId, tags, doc, saving]);

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto' }}>
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 3,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 0 14px',
          marginBottom: 10,
          background: 'linear-gradient(to bottom, var(--bg) 82%, color-mix(in srgb, var(--bg) 0%, transparent))',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: 'var(--mut)', letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 820 }}>
            {isEdit ? 'Edit Document' : 'New Document'}
          </div>
          <div style={{ marginTop: 3, fontSize: 13, color: 'var(--mut)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {selectedKbName} · {headingCount ? `${headingCount} 个标题会生成知识树` : '用 ## 标题生成知识树'}
            {dirty ? ' · 未保存' : savedAt ? ' · 已保存' : ''}
          </div>
        </div>

        <button type="button" style={ghostBtn} onClick={() => setShowPreview((v) => !v)}>
          {showPreview ? '继续编辑' : '预览'}
        </button>
        {onCancel && (
          <button type="button" style={ghostBtn} onClick={onCancel}>
            {isEdit ? '返回' : '取消'}
          </button>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !dirty}
          style={{
            ...primaryBtn,
            background: dirty ? 'var(--accent)' : 'var(--bd)',
            color: dirty ? '#fff' : 'var(--mut)',
            cursor: dirty && !saving ? 'pointer' : 'not-allowed',
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? '保存中…' : '保存 ⌘S'}
        </button>
      </div>

      <div
        style={{
          border: '1px solid var(--bd)',
          borderRadius: 18,
          background: 'var(--panel)',
          boxShadow: '0 22px 60px rgba(0,0,0,.06)',
          overflow: 'hidden',
        }}
      >
        <details
          style={{
            borderBottom: '1px solid var(--bd)',
            background: 'color-mix(in srgb, var(--bg) 55%, transparent)',
          }}
        >
          <summary
            style={{
              padding: '12px 18px',
              cursor: 'pointer',
              color: 'var(--mut)',
              fontSize: 12.5,
              userSelect: 'none',
            }}
          >
            属性 · {selectedKbName} / {selectedFolderName}{tagList.length ? ` · ${tagList.length} 个标签` : ''}
          </summary>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(150px, 190px) minmax(150px, 190px) minmax(180px, 1fr)',
              gap: 10,
              padding: '0 18px 14px',
            }}
          >
            <select
              value={kbId}
              onChange={(e) => {
                setKbId(e.target.value);
                setFolderId(null);
              }}
              style={inputStyle}
              title="知识库"
            >
              {kbs.map((k) => (
                <option key={k.id} value={k.id}>{k.name}</option>
              ))}
            </select>

            <select value={folderId ?? ''} onChange={(e) => setFolderId(e.target.value || null)} style={inputStyle} title="文件夹">
              <option value="">根目录</option>
              {folderOptions(forestOfKb(folders, kbId))}
            </select>

            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="标签，用逗号分隔" style={inputStyle} />
          </div>
        </details>

        <div style={{ padding: '46px 64px 64px' }}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="无标题知识点"
            autoFocus={!isEdit}
            style={{
              width: '100%',
              border: 'none',
              outline: 'none',
              background: 'transparent',
              color: 'var(--fg)',
              fontSize: 38,
              lineHeight: 1.15,
              fontWeight: 860,
              letterSpacing: '-.04em',
              fontFamily: 'inherit',
              marginBottom: 24,
            }}
          />

          {showPreview ? (
            <div
              className="ik-md"
              style={{
                minHeight: 560,
                color: 'var(--fg)',
                fontSize: 16,
                lineHeight: 1.85,
              }}
            >
              {doc.trim() ? renderMd(doc) : <span style={{ color: 'var(--mut)' }}>还没有正文内容。</span>}
            </div>
          ) : (
            <textarea
              value={doc}
              onChange={(e) => setDoc(e.target.value)}
              placeholder={`直接像写文档一样输入内容。\n\n普通段落会作为开篇说明。\n\n## 核心定义\n这里写面试回答。\n\n### 常见追问\n这里写追问和回答。\n\n#### 易错点\n这里写坑点。`}
              spellCheck={false}
              style={{
                width: '100%',
                minHeight: 620,
                border: 'none',
                outline: 'none',
                resize: 'vertical',
                background: 'transparent',
                color: 'var(--fg)',
                fontSize: 16,
                lineHeight: 1.9,
                fontFamily: 'inherit',
              }}
            />
          )}

          <div
            style={{
              marginTop: 18,
              paddingTop: 14,
              borderTop: '1px solid var(--bd)',
              display: 'flex',
              gap: 12,
              flexWrap: 'wrap',
              color: 'var(--mut)',
              fontSize: 12,
              lineHeight: 1.7,
            }}
          >
            <span>普通段落 = 开篇说明</span>
            <span>## = 一级考点</span>
            <span>### = 子考点</span>
            <span>#### = 追问 / 易错点</span>
            <span>保存后自动同步到画布和检索</span>
          </div>
        </div>
      </div>
    </div>
  );
}
