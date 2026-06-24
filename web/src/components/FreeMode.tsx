import { useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { Entry, Folder, KnowledgeBase } from '../types';
import { forestOfKb, folderChain, type FolderNode } from '../tree';
import { toast } from '../toast';

interface Props {
  entries: Entry[];
  kbs: KnowledgeBase[];
  folders: Folder[];
  freeKb: string | null;
  freeFolder: string | null;
  setFreeKb: (id: string | null) => void;
  setFreeFolder: (id: string | null) => void;
  onOpen: (id: string) => void;
  onNew: () => void;
  onCreateKb: (name: string) => Promise<KnowledgeBase>;
  onCreateFolder: (input: { kbId: string; parentId?: string | null; name: string }) => Promise<Folder>;
  onRenameKb: (id: string, name: string) => Promise<void>;
  onDeleteKb: (id: string) => Promise<void>;
  onRenameFolder: (id: string, name: string) => Promise<void>;
  onDeleteFolder: (id: string) => Promise<void>;
}

const cardStyle: CSSProperties = {
  padding: 16,
  background: 'var(--panel)',
  border: '1px solid var(--bd)',
  borderRadius: 12,
  cursor: 'pointer',
  position: 'relative',
};

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
  gap: 12,
};

const actBtn: CSSProperties = {
  padding: '9px 16px',
  fontSize: 13,
  fontFamily: 'inherit',
  cursor: 'pointer',
  background: 'var(--fg)',
  color: 'var(--bg)',
  border: 'none',
  borderRadius: 9,
  fontWeight: 500,
};

const ghostBtn: CSSProperties = {
  padding: '9px 14px',
  fontSize: 13,
  fontFamily: 'inherit',
  cursor: 'pointer',
  background: 'var(--panel)',
  color: 'var(--fg)',
  border: '1px solid var(--bd)',
  borderRadius: 9,
  fontWeight: 500,
};

const crumbStyle: CSSProperties = {
  fontSize: 13,
  cursor: 'pointer',
  color: 'var(--mut)',
  background: 'transparent',
  border: 'none',
  fontFamily: 'inherit',
  padding: '4px 8px',
  borderRadius: 7,
};

function hoverOn(e: React.MouseEvent<HTMLDivElement>): void { e.currentTarget.style.borderColor = 'var(--mut)'; }
function hoverOff(e: React.MouseEvent<HTMLDivElement>): void { e.currentTarget.style.borderColor = 'var(--bd)'; }

// 卡片右上角的悬浮操作按钮
function RowActions({ onRename, onDelete }: { onRename: () => void; onDelete: () => void }): ReactNode {
  return (
    <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 4, opacity: 0.6 }}>
      <span role="button" title="重命名" style={{ fontSize: 13, color: 'var(--mut)', cursor: 'pointer', padding: '2px 5px' }} onClick={(e) => { e.stopPropagation(); onRename(); }}>✎</span>
      <span role="button" title="删除" style={{ fontSize: 13, color: 'var(--danger)', cursor: 'pointer', padding: '2px 5px' }} onClick={(e) => { e.stopPropagation(); onDelete(); }}>✕</span>
    </div>
  );
}

export default function FreeMode(props: Props): ReactNode {
  const { entries, kbs, folders, freeKb, freeFolder, setFreeKb, setFreeFolder, onOpen, onNew,
    onCreateKb, onCreateFolder, onRenameKb, onDeleteKb, onRenameFolder, onDeleteFolder } = props;

  const [menuId, setMenuId] = useState<string | null>(null);

  const entriesOfKb = useMemo(() => (kbId: string) => entries.filter((e) => e.kbId === kbId), [entries]);
  const currentKb = kbs.find((k) => k.id === freeKb) ?? null;

  // ── 新建操作 ──
  function newKb(): void {
    const name = window.prompt('新建知识库名称：');
    if (!name?.trim()) return;
    onCreateKb(name.trim()).catch((err) => toast('新建失败：' + (err instanceof Error ? err.message : String(err)), 'error'));
  }
  function newFolder(kbId: string, parentId: string | null): void {
    const name = window.prompt('新建文件夹名称：');
    if (!name?.trim()) return;
    onCreateFolder({ kbId, parentId, name: name.trim() }).catch((err) => toast('新建失败：' + (err instanceof Error ? err.message : String(err)), 'error'));
  }
  function renameKbAction(kb: KnowledgeBase): void {
    const next = window.prompt(`重命名知识库「${kb.name}」为：`, kb.name);
    if (!next?.trim() || next.trim() === kb.name) return;
    onRenameKb(kb.id, next.trim()).catch((err) => toast('重命名失败：' + (err instanceof Error ? err.message : String(err)), 'error'));
  }
  function deleteKbAction(kb: KnowledgeBase): void {
    const n = entriesOfKb(kb.id).length;
    if (!window.confirm(`确定删除知识库「${kb.name}」及其下 ${n} 条知识点与全部文件夹？此操作不可撤销。`)) return;
    onDeleteKb(kb.id).catch((err) => toast('删除失败：' + (err instanceof Error ? err.message : String(err)), 'error'));
  }
  function renameFolderAction(folder: Folder): void {
    const next = window.prompt(`重命名文件夹「${folder.name}」为：`, folder.name);
    if (!next?.trim() || next.trim() === folder.name) return;
    onRenameFolder(folder.id, next.trim()).catch((err) => toast('重命名失败：' + (err instanceof Error ? err.message : String(err)), 'error'));
  }
  function deleteFolderAction(folder: Folder): void {
    if (!window.confirm(`确定删除文件夹「${folder.name}」及其下全部子文件夹与知识点？此操作不可撤销。`)) return;
    onDeleteFolder(folder.id).catch((err) => toast('删除失败：' + (err instanceof Error ? err.message : String(err)), 'error'));
  }

  // ── 知识库列表页 ──
  if (!freeKb) {
    return (
      <div style={{ padding: '28px 0 60px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22, flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{ fontSize: 18, fontWeight: 800 }}>知识库</span>
            <span style={{ fontSize: 12, color: 'var(--mut)' }}>{kbs.length} 个</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={ghostBtn} onClick={newKb}>＋ 新建知识库</button>
            <button style={actBtn} onClick={onNew}>＋ 新建知识点</button>
          </div>
        </div>

        {kbs.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--mut)', fontSize: 13 }}>
            还没有知识库，点击「＋ 新建知识库」开始。
          </div>
        ) : (
          <div style={gridStyle}>
            {kbs.map((kb) => {
              const n = entriesOfKb(kb.id).length;
              const fn = folders.filter((f) => f.kbId === kb.id).length;
              return (
                <div
                  key={kb.id}
                  style={cardStyle}
                  onMouseEnter={hoverOn}
                  onMouseLeave={(e) => { hoverOff(e); setMenuId(null); }}
                  onClick={() => { setFreeKb(kb.id); setFreeFolder(null); }}
                >
                  <RowActions onRename={() => renameKbAction(kb)} onDelete={() => deleteKbAction(kb)} />
                  <div style={{ fontSize: 22, marginBottom: 8 }}>📚</div>
                  <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>{kb.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--mut)' }}>
                    {fn} 个文件夹 · {n} 条知识点
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── 知识库内 / 文件夹内页 ──
  const kbId = freeKb;
  const folderForest = forestOfKb(folders, kbId); // 根级文件夹树
  const chain = folderChain(folders, freeFolder); // 面包屑路径链
  // 当前层级的子文件夹 + 知识点
  const childFolders: FolderNode[] = freeFolder
    ? (folderForest.flatMap((n) => findNode(n, freeFolder)))[0]?.children ?? []
    : folderForest;
  const childEntries = freeFolder
    ? entries.filter((e) => e.folderId === freeFolder)
    : entries.filter((e) => e.kbId === kbId && !e.folderId);

  return (
    <div style={{ padding: '20px 0 60px' }}>
      {/* 面包屑 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', marginBottom: 18 }}>
        <button style={crumbStyle} onClick={() => { setFreeKb(null); setFreeFolder(null); }}>‹ 全部知识库</button>
        <span style={{ color: 'var(--mut)', fontSize: 12 }}>/</span>
        <button
          style={{ ...crumbStyle, color: freeFolder ? 'var(--mut)' : 'var(--fg)', fontWeight: freeFolder ? 500 : 700 }}
          onClick={() => setFreeFolder(null)}
        >
          {currentKb?.name ?? '知识库'}
        </button>
        {chain.map((f) => (
          <span key={f.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
            <span style={{ color: 'var(--mut)', fontSize: 12 }}>/</span>
            <button
              style={{ ...crumbStyle, color: f.id === freeFolder ? 'var(--fg)' : 'var(--mut)', fontWeight: f.id === freeFolder ? 700 : 500 }}
              onClick={() => setFreeFolder(f.id)}
            >
              {f.name}
            </button>
          </span>
        ))}
      </div>

      {/* 工具栏 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <span style={{ fontSize: 12, color: 'var(--mut)' }}>
          {childFolders.length} 个文件夹 · {childEntries.length} 条知识点
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={ghostBtn} onClick={() => newFolder(kbId, freeFolder)}>＋ 新建文件夹</button>
          <button style={actBtn} onClick={onNew}>＋ 新建知识点</button>
        </div>
      </div>

      {/* 文件夹卡片 */}
      {childFolders.length > 0 && (
        <div style={{ marginBottom: 26 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--mut)', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 10 }}>文件夹</div>
          <div style={gridStyle}>
            {childFolders.map(({ folder }) => {
              const subFolders = folders.filter((f) => f.parentId === folder.id).length;
              const subEntries = entries.filter((e) => e.folderId === folder.id).length;
              return (
                <div
                  key={folder.id}
                  style={cardStyle}
                  onMouseEnter={hoverOn}
                  onMouseLeave={(e) => { hoverOff(e); setMenuId(null); }}
                  onClick={() => setFreeFolder(folder.id)}
                >
                  <RowActions onRename={() => renameFolderAction(folder)} onDelete={() => deleteFolderAction(folder)} />
                  <div style={{ fontSize: 22, marginBottom: 8 }}>📁</div>
                  <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>{folder.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--mut)' }}>
                    {subFolders} 个子文件夹 · {subEntries} 条知识点
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 知识点卡片 */}
      {childEntries.length > 0 ? (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--mut)', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 10 }}>知识点</div>
          <div style={gridStyle}>
            {childEntries.map((item) => (
              <div
                key={item.id}
                style={cardStyle}
                onMouseEnter={hoverOn}
                onMouseLeave={hoverOff}
                onClick={() => onOpen(item.id)}
              >
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{item.title}</div>
                <div style={{ fontSize: 13, color: 'var(--mut)', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{item.summary}</div>
                {item.tags.length > 0 && (
                  <div style={{ marginTop: 8, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    {item.tags.slice(0, 3).map((tg) => (
                      <span key={tg} style={{ fontSize: 10.5, color: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 10%, transparent)', padding: '1px 7px', borderRadius: 20 }}>#{tg}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : childFolders.length === 0 ? (
        <div style={{ padding: 36, textAlign: 'center', color: 'var(--mut)', fontSize: 13, border: '1px dashed var(--bd)', borderRadius: 14 }}>
          这里还没有内容，点击「＋ 新建文件夹」或「＋ 新建知识点」开始构建。
        </div>
      ) : null}
    </div>
  );
}

// 在文件夹树中查找 id 为 targetId 的节点
function findNode(node: FolderNode, targetId: string): FolderNode[] {
  if (node.folder.id === targetId) return [node];
  for (const child of node.children) {
    const found = findNode(child, targetId);
    if (found.length) return found;
  }
  return [];
}
