import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeft, Check, Eye, PencilLine } from 'lucide-react';
import type { Entry, EntryInput, IndexNode, KnowledgeBase, Folder, Block } from '../types';
import { toast } from '../toast';
import BlockEditor from './BlockEditor';
import Button from './Button';

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
  for (const node of entry.nodes) parts.push(nodeToMarkdown(node, 1));
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
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
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
  const { initial, kbs, defaultKbId, defaultFolderId, onSave, onCancel, onDirtyChange } = props;
  const isEdit = !!initial;

  const [title, setTitle] = useState(initial?.title ?? '');
  const [kbId, setKbId] = useState(initial?.kbId ?? defaultKbId ?? kbs[0]?.id ?? '');
  const [folderId, setFolderId] = useState<string | null>(initial?.folderId ?? defaultFolderId ?? null);
  const [tags, setTags] = useState(initial?.tags.join(', ') ?? '');
  const [tagDraft, setTagDraft] = useState('');
  const [doc, setDoc] = useState(entryToDocument(initial));
  const [docBlocks, setDocBlocks] = useState<Block[]>(initial?.doc ?? []);
  const [showPreview, setShowPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(0);

  const tagList = tags
    .split(/[,，]/)
    .map((t) => t.trim())
    .filter(Boolean);

  const addTag = (raw: string): void => {
    const t = raw.replace(/[,，]/g, '').trim();
    if (!t || tagList.some((x) => x.toLowerCase() === t.toLowerCase())) { setTagDraft(''); return; }
    setTags([...tagList, t].join(', '));
    setTagDraft('');
  };
  const removeTag = (t: string): void => {
    setTags(tagList.filter((x) => x !== t).join(', '));
  };

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

  const dirty = snapshot({ title, kbId, folderId, tags: tagList, doc }) !== baseRef.current;

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
      doc: docBlocks,   // canonical:BlockNote 块文档,服务端据此派生索引
    })
      .then((saved) => {
        const nextDoc = entryToDocument(saved);
        setTitle(saved.title);
        setKbId(saved.kbId);
        setFolderId(saved.folderId);
        setTags(saved.tags.join(', '));
        setDoc(nextDoc);
        setDocBlocks(saved.doc ?? []);
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
    <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div
        className="ik-surface"
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          border: '1px solid var(--bd)',
          borderRadius: 12,
          background: 'var(--panel)',
          boxShadow: '0 10px 28px rgba(0,0,0,.045)',
          overflow: 'hidden',
        }}
      >
        {/* 统一操作栏:预览 / 返回 / 保存 */}
        <div className="ik-action-bar">
          <span className="ik-action-spacer">
            <span className={`ik-action-dot ${dirty ? 'is-dirty' : savedAt ? 'is-saved' : ''}`} />
            {dirty ? '未保存' : savedAt ? '已保存' : '编辑中'}
          </span>
          <Button
            variant="secondary"
            size="sm"
            leadingIcon={showPreview ? <PencilLine size={15} strokeWidth={2.15} /> : <Eye size={15} strokeWidth={2.15} />}
            onClick={() => setShowPreview((v) => !v)}
          >
            {showPreview ? '继续编辑' : '预览'}
          </Button>
          {onCancel && (
            <Button
              variant="ghost"
              size="sm"
              leadingIcon={<ArrowLeft size={15} strokeWidth={2.15} />}
              onClick={onCancel}
            >
              {isEdit ? '返回' : '取消'}
            </Button>
          )}
          <Button
            variant="default"
            size="sm"
            leadingIcon={<Check size={15} strokeWidth={2.4} />}
            onClick={handleSave}
            disabled={saving || !dirty}
          >
            {saving ? '保存中…' : '保存 ⌘S'}
          </Button>
        </div>

        {/* 属性栏:只做标签管理 — 输入回车/逗号新建,点 × 删除 */}
        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            padding: '10px 16px',
            borderBottom: '1px solid var(--bd)',
            background: 'color-mix(in srgb, var(--bg) 55%, transparent)',
          }}
        >
          {tagList.map((t) => (
            <span
              key={t}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '4px 6px 4px 11px',
                fontSize: 12.5,
                color: 'var(--fg)',
                background: 'var(--sel)',
                border: '1px solid var(--bd)',
                borderRadius: 999,
              }}
            >
              {t}
              <button
                type="button"
                title="删除标签"
                aria-label={`删除标签 ${t}`}
                onClick={() => removeTag(t)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 16,
                  height: 16,
                  padding: 0,
                  border: 'none',
                  borderRadius: 999,
                  background: 'transparent',
                  color: 'var(--mut)',
                  cursor: 'pointer',
                  fontSize: 14,
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </span>
          ))}
          <input
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
                e.preventDefault();
                addTag(tagDraft);
              } else if (e.key === 'Backspace' && !tagDraft && tagList.length) {
                removeTag(tagList[tagList.length - 1]);
              }
            }}
            onBlur={() => { if (tagDraft.trim()) addTag(tagDraft); }}
            placeholder={tagList.length ? '添加标签' : '添加标签，回车确认'}
            style={{
              flex: 1,
              minWidth: 120,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              color: 'var(--fg)',
              fontSize: 13,
              fontFamily: 'inherit',
              padding: '4px 2px',
            }}
          />
        </div>

        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '28px 36px 40px' }}>
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
              fontSize: 30,
              lineHeight: 1.15,
              fontWeight: 820,
              letterSpacing: '-.02em',
              fontFamily: 'inherit',
              marginBottom: 18,
            }}
          />

          {/* 编辑与预览复用同一个 BlockEditor 实例:宽度一致、切换不丢编辑内容 */}
          <BlockEditor
            editable={!showPreview}
            initialBlocks={initial?.doc}
            initialMarkdown={initial?.doc && initial.doc.length ? undefined : doc}
            onChange={setDocBlocks}
            onChangeMarkdown={setDoc}
          />

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
            <span>像写飞书文档一样输入(/ 唤起块菜单、可插图/代码/表格)</span>
            <span>标题块(H1/H2/H3)= 各级知识树索引</span>
            <span>普通段落 = 开篇说明</span>
            <span>保存后自动同步到画布和检索</span>
          </div>
        </div>
      </div>
    </div>
  );
}
