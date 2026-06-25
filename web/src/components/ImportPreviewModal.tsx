import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { ImportPreview, ImportPayload, PreviewEntry } from '../api';
import SelectField, { type SelectOption } from './SelectField';
import Button from './Button';

const ROOT_FOLDER_VALUE = '__ik_root_folder__';

interface Props {
  payload: ImportPayload;
  preview: ImportPreview;
  busy: boolean;
  previewing?: boolean;
  targetFolders?: SelectOption[];
  targetFolderId?: string | null;
  allowReplace?: boolean;
  onTargetFolderChange?: (folderId: string | null) => void;
  onClose: () => void;
  onConfirm: (replace: boolean) => void;
}

const ROOT_TREE_KEY = '__root__';

const badge = (bg: string, fg: string): CSSProperties => ({
  fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 6,
  background: bg, color: fg, flexShrink: 0, whiteSpace: 'nowrap',
});

type PreviewFolder = ImportPreview['folders'][number];

interface PreviewFolderNode {
  folder: PreviewFolder;
  children: PreviewFolderNode[];
  entries: PreviewEntry[];
}

function pushMap<T>(map: Map<string, T[]>, key: string, value: T): void {
  if (!map.has(key)) map.set(key, []);
  map.get(key)!.push(value);
}

function buildPreviewTree(preview: ImportPreview): { folders: PreviewFolderNode[]; entries: PreviewEntry[] } {
  const folderIds = new Set(preview.folders.map((folder) => folder.id).filter((id): id is string => Boolean(id)));
  const foldersByParent = new Map<string, PreviewFolder[]>();
  const entriesByFolder = new Map<string, PreviewEntry[]>();

  preview.folders.forEach((folder) => {
    const key = folder.parentId && folderIds.has(folder.parentId) ? folder.parentId : ROOT_TREE_KEY;
    pushMap(foldersByParent, key, folder);
  });
  preview.entries.forEach((entry) => {
    const key = entry.folderId && folderIds.has(entry.folderId) ? entry.folderId : ROOT_TREE_KEY;
    pushMap(entriesByFolder, key, entry);
  });

  const build = (parentKey: string): PreviewFolderNode[] => (foldersByParent.get(parentKey) ?? []).map((folder) => ({
    folder,
    children: folder.id ? build(folder.id) : [],
    entries: folder.id ? (entriesByFolder.get(folder.id) ?? []) : [],
  }));

  return {
    folders: build(ROOT_TREE_KEY),
    entries: entriesByFolder.get(ROOT_TREE_KEY) ?? [],
  };
}

function countTreeEntries(node: PreviewFolderNode): number {
  return node.entries.length + node.children.reduce((sum, child) => sum + countTreeEntries(child), 0);
}

function PreviewTree({ preview }: { preview: ImportPreview }) {
  const tree = buildPreviewTree(preview);
  const empty = tree.folders.length === 0 && tree.entries.length === 0;
  return (
    <div className="ik-import-tree">
      {empty ? (
        <div className="ik-import-tree-empty">没有可导入的知识点。</div>
      ) : (
        <>
          {tree.folders.map((folder, index) => <PreviewFolderBranch key={folder.folder.id ?? `${folder.folder.path}-${index}`} node={folder} depth={0} />)}
          {tree.entries.map((entry, index) => <PreviewEntryLeaf key={entry.id ?? `${entry.title}-${index}`} entry={entry} depth={0} />)}
        </>
      )}
    </div>
  );
}

function PreviewFolderBranch({ node, depth }: { node: PreviewFolderNode; depth: number }) {
  const count = countTreeEntries(node);
  return (
    <div>
      <div className="ik-import-tree-row ik-import-tree-folder" style={{ '--tree-depth': depth } as CSSProperties}>
        <span className="ik-import-tree-icon">▾</span>
        <span className="ik-import-tree-name">{node.folder.name}</span>
        <span className="ik-import-tree-count">{count}</span>
      </div>
      {node.children.map((child, index) => <PreviewFolderBranch key={child.folder.id ?? `${child.folder.path}-${index}`} node={child} depth={depth + 1} />)}
      {node.entries.map((entry, index) => <PreviewEntryLeaf key={entry.id ?? `${entry.title}-${index}`} entry={entry} depth={depth + 1} />)}
    </div>
  );
}

function PreviewEntryLeaf({ entry, depth }: { entry: PreviewEntry; depth: number }) {
  return (
    <div className="ik-import-tree-row ik-import-tree-entry" style={{ '--tree-depth': depth } as CSSProperties}>
      <span className="ik-import-tree-icon">•</span>
      <span className="ik-import-tree-copy">
        <span className="ik-import-tree-name">{entry.title}</span>
        {entry.summary && <span className="ik-import-tree-summary">{entry.summary}</span>}
      </span>
      {entry.valid
        ? (entry.exists
          ? <span style={badge('var(--sel)', 'var(--fg)')}>更新</span>
          : <span style={badge('var(--fg)', 'var(--bg)')}>新增</span>)
        : <span style={badge('transparent', 'var(--danger)')}>跳过</span>}
    </div>
  );
}

export default function ImportPreviewModal({
  payload,
  preview,
  busy,
  previewing = false,
  targetFolders,
  targetFolderId,
  allowReplace = true,
  onTargetFolderChange,
  onClose,
  onConfirm,
}: Props) {
  const [armedReplace, setArmedReplace] = useState(false);

  const previewFolders = preview.folders ?? [];
  const locked = busy || previewing;
  const needsTargetFolder = Boolean(targetFolders && onTargetFolderChange);
  const hasTargetFolder = !needsTargetFolder || targetFolderId !== undefined;
  const selectValue = targetFolderId === null ? ROOT_FOLDER_VALUE : targetFolderId;

  return (
    <div onClick={locked ? undefined : onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.34)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '48px 20px', overflowY: 'auto', zIndex: 60, animation: 'ik-fade .15s' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 920, background: 'var(--panel)', border: '1px solid var(--bd)', borderRadius: 16, padding: 24, animation: 'ik-pop .18s ease' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700 }}>导入预览</div>
            <div style={{ fontSize: 12, color: 'var(--mut)', marginTop: 3 }}>
              共解析 {preview.total} 条 · JSON 文件夹 <b style={{ color: 'var(--fg)' }}>{previewFolders.length}</b> 个 · 将导入 <b style={{ color: 'var(--fg)' }}>{preview.valid}</b> 条（新增 {preview.newCount} · 更新 {preview.updateCount}）{preview.skipped > 0 ? ` · 跳过 ${preview.skipped} 条（无标题）` : ''}
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} disabled={locked} aria-label="关闭">✕</Button>
        </div>

        {needsTargetFolder && (
          <div style={{ display: 'grid', gridTemplateColumns: '88px minmax(0, 1fr)', alignItems: 'center', gap: 12, marginBottom: 14, padding: 12, border: '1px solid var(--bd)', borderRadius: 10, background: 'var(--bg)' }}>
            <span style={{ fontSize: 12.5, color: 'var(--mut)', fontWeight: 650 }}>导入位置</span>
            <SelectField
              value={selectValue}
              disabled={locked || !targetFolders?.length}
              options={targetFolders ?? []}
              placeholder="请选择导入位置"
              title="导入位置"
              onChange={(value) => {
                setArmedReplace(false);
                onTargetFolderChange?.(value === ROOT_FOLDER_VALUE ? null : value);
              }}
            />
          </div>
        )}

        {preview.byCat.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
            {preview.byCat.map((c) => (
              <span key={c.cat} style={{ fontSize: 11.5, color: 'var(--mut)', border: '1px solid var(--bd)', borderRadius: 7, padding: '3px 10px' }}>{c.cat} · {c.count}</span>
            ))}
          </div>
        )}

        <div style={{ marginBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
            <div style={{ fontSize: 13, color: 'var(--fg)', fontWeight: 760 }}>导入结构</div>
            <div style={{ fontSize: 12, color: 'var(--mut)' }}>{previewFolders.length} 个文件夹 · {preview.valid} 条知识点</div>
          </div>
          <PreviewTree preview={preview} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11.5, color: 'var(--mut)' }}>
            {previewing
              ? '正在按目标文件夹重新生成预览。'
              : !hasTargetFolder
                ? '请选择导入文件夹后再确认。'
                : allowReplace
                  ? (armedReplace ? '替换将先清空现有全部知识点，再次点击确认。' : '合并：按 id 更新已有、新增其余；替换：先清空再整体导入。')
                  : '导入到选定文件夹；同 id 知识点会更新，其余新增。'}
          </span>
          <div style={{ display: 'flex', gap: 10 }}>
            <Button variant="secondary" onClick={onClose} disabled={locked}>取消</Button>
            <Button variant="secondary" onClick={() => onConfirm(false)} disabled={locked || !hasTargetFolder}>{busy ? '导入中…' : previewing ? '预览中…' : allowReplace ? '合并导入' : '确认导入'}</Button>
            {allowReplace && (
              <Button
                variant={armedReplace ? 'destructive' : 'secondary'}
                onClick={() => { if (armedReplace) onConfirm(true); else setArmedReplace(true); }}
                disabled={locked || !hasTargetFolder}
              >
                {armedReplace ? '确认替换？' : '替换导入'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
