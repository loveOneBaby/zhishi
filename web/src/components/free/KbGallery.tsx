import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Check, ChevronRight, Download, Folder, FolderPlus, LibraryBig, PencilLine, Plus, Tags, Trash2 } from 'lucide-react';
import type { Entry, Folder as KbFolder, KnowledgeBase, KbCategory } from '../../types';
import ImportPreviewModal from '../ImportPreviewModal';
import CommandDialog from '../CommandDialog';
import type { ImportPayload, ImportPreview } from '../../api';
import { RowActions } from './RowActions';
import { toast } from '../../toast';

const ALL_CATEGORIES = '__all__';
const UNCATEGORIZED = '__uncategorized__';

type ActiveCategory = typeof ALL_CATEGORIES | typeof UNCATEGORIZED | string;

type CategoryCommand =
  | { kind: 'create'; parentId: string | null; parentName?: string }
  | { kind: 'rename'; category: KbCategory }
  | { kind: 'delete'; category: KbCategory };

interface CategoryRow {
  category: KbCategory;
  depth: number;
  childCount: number;
}

interface KbGalleryProps {
  kbs: KnowledgeBase[];
  categories: KbCategory[];
  entries: Entry[];
  folders: KbFolder[];
  entriesOfKb: (kbId: string) => Entry[];
  newKb: (categoryId?: string | null, categoryName?: string) => void;
  createCategory: (input: { name: string; parentId?: string | null }) => Promise<KbCategory>;
  renameCategory: (id: string, name: string) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
  moveKbToCategory: (id: string, categoryId?: string | null) => Promise<void>;
  onExportAll: () => Promise<void>;
  openKb: (kb: KnowledgeBase) => void;
  renameKbAction: (kb: KnowledgeBase) => void;
  deleteKbAction: (kb: KnowledgeBase) => void;
  importPreview: { payload: ImportPayload; preview: ImportPreview } | null;
  importing: boolean;
  onCloseImportPreview: () => void;
  handleConfirmImport: (replace: boolean) => Promise<void>;
  commandDialog: ReactNode;
}

function categoryKey(parentId: string | null): string {
  return parentId ?? '';
}

function categoryName(category: KbCategory | undefined): string {
  return category?.name ?? '未分类';
}

export function KbGallery(props: KbGalleryProps): ReactNode {
  const {
    kbs, categories, entries, folders, entriesOfKb, newKb,
    createCategory, renameCategory, deleteCategory, moveKbToCategory,
    onExportAll, openKb, renameKbAction, deleteKbAction, importPreview, importing, onCloseImportPreview,
    handleConfirmImport, commandDialog,
  } = props;

  const [activeCategory, setActiveCategory] = useState<ActiveCategory>(ALL_CATEGORIES);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [categoryCommand, setCategoryCommand] = useState<CategoryCommand | null>(null);

  const categoryById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);
  const childrenByParent = useMemo(() => {
    const map = new Map<string, KbCategory[]>();
    for (const category of categories) {
      const key = categoryKey(category.parentId);
      const list = map.get(key) ?? [];
      list.push(category);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.sort - b.sort) || (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.name.localeCompare(b.name, 'zh-Hans-CN'));
    }
    return map;
  }, [categories]);

  useEffect(() => {
    setExpanded((current) => {
      const next = new Set(current);
      for (const category of categories) next.add(category.id);
      return next;
    });
  }, [categories]);

  useEffect(() => {
    if (activeCategory !== ALL_CATEGORIES && activeCategory !== UNCATEGORIZED && !categoryById.has(activeCategory)) {
      setActiveCategory(ALL_CATEGORIES);
    }
  }, [activeCategory, categoryById]);

  const categoryRows = useMemo<CategoryRow[]>(() => {
    const rows: CategoryRow[] = [];
    const walk = (parentId: string | null, depth: number): void => {
      for (const category of childrenByParent.get(categoryKey(parentId)) ?? []) {
        rows.push({
          category,
          depth,
          childCount: childrenByParent.get(categoryKey(category.id))?.length ?? 0,
        });
        if (expanded.has(category.id)) walk(category.id, depth + 1);
      }
    };
    walk(null, 0);
    return rows;
  }, [childrenByParent, expanded]);

  const allCategoryRows = useMemo<CategoryRow[]>(() => {
    const rows: CategoryRow[] = [];
    const walk = (parentId: string | null, depth: number): void => {
      for (const category of childrenByParent.get(categoryKey(parentId)) ?? []) {
        rows.push({
          category,
          depth,
          childCount: childrenByParent.get(categoryKey(category.id))?.length ?? 0,
        });
        walk(category.id, depth + 1);
      }
    };
    walk(null, 0);
    return rows;
  }, [childrenByParent]);

  const subtreeIds = useMemo(() => {
    const cache = new Map<string, Set<string>>();
    const collect = (id: string): Set<string> => {
      if (cache.has(id)) return cache.get(id)!;
      const ids = new Set<string>([id]);
      for (const child of childrenByParent.get(categoryKey(id)) ?? []) {
        for (const childId of collect(child.id)) ids.add(childId);
      }
      cache.set(id, ids);
      return ids;
    };
    for (const category of categories) collect(category.id);
    return cache;
  }, [categories, childrenByParent]);

  const visibleKbs = useMemo(() => {
    if (activeCategory === ALL_CATEGORIES) return kbs;
    if (activeCategory === UNCATEGORIZED) return kbs.filter((kb) => !kb.categoryId);
    const ids = subtreeIds.get(activeCategory) ?? new Set([activeCategory]);
    return kbs.filter((kb) => kb.categoryId && ids.has(kb.categoryId));
  }, [activeCategory, kbs, subtreeIds]);

  const activeCategoryName = activeCategory === ALL_CATEGORIES
    ? '全部知识库'
    : activeCategory === UNCATEGORIZED
      ? '未分类'
      : categoryName(categoryById.get(activeCategory));
  const activeCategoryId = activeCategory !== ALL_CATEGORIES && activeCategory !== UNCATEGORIZED ? activeCategory : null;

  const exactCount = (id: string | null): number => kbs.filter((kb) => (kb.categoryId ?? null) === id).length;
  const subtreeCount = (id: string): number => {
    const ids = subtreeIds.get(id) ?? new Set([id]);
    return kbs.filter((kb) => kb.categoryId && ids.has(kb.categoryId)).length;
  };

  const categoryOptions = [
    { value: '', label: '未分类', depth: 0 },
    ...allCategoryRows.map((row) => ({
      value: row.category.id,
      label: row.category.name,
      depth: row.depth,
    })),
  ];

  const createKbInActiveCategory = (): void => {
    if (activeCategory === ALL_CATEGORIES || activeCategory === UNCATEGORIZED) newKb(null);
    else newKb(activeCategory, activeCategoryName);
  };

  const toggleExpanded = (id: string): void => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runCategoryCommand = async (value: string): Promise<void> => {
    if (!categoryCommand) return;
    try {
      if (categoryCommand.kind === 'create') {
        const name = value.trim();
        if (!name) throw new Error('分类名称不能为空');
        await createCategory({ name, parentId: categoryCommand.parentId });
        toast('已新建分类', 'success');
      } else if (categoryCommand.kind === 'rename') {
        const name = value.trim();
        if (!name) throw new Error('分类名称不能为空');
        await renameCategory(categoryCommand.category.id, name);
        toast('已重命名分类', 'success');
      } else {
        await deleteCategory(categoryCommand.category.id);
        if (activeCategory === categoryCommand.category.id) setActiveCategory(categoryCommand.category.parentId ?? ALL_CATEGORIES);
        toast('已删除分类，内容已移动到上一级', 'success');
      }
      setCategoryCommand(null);
    } catch (err) {
      toast('分类操作失败：' + (err instanceof Error ? err.message : String(err)), 'error');
      throw err;
    }
  };

  const categoryDialog = categoryCommand ? (
    <CommandDialog
      open
      tone={categoryCommand.kind === 'delete' ? 'danger' : 'default'}
      title={categoryCommand.kind === 'create' ? '新建分类' : categoryCommand.kind === 'rename' ? '重命名分类' : '删除分类'}
      description={categoryCommand.kind === 'create'
        ? (categoryCommand.parentName ? `将在「${categoryCommand.parentName}」下创建子分类。` : '将在根层级创建分类。')
        : categoryCommand.kind === 'rename'
          ? '只修改分类名称，不影响知识库内容。'
          : `确定删除「${categoryCommand.category.name}」？下级分类和知识库会移动到上一级。`}
      inputLabel={categoryCommand.kind === 'delete' ? undefined : '分类名称'}
      initialValue={categoryCommand.kind === 'rename' ? categoryCommand.category.name : ''}
      placeholder="例如：后端、前端、AI、数据库"
      confirmText={categoryCommand.kind === 'delete' ? '删除分类' : '保存'}
      cancelText="取消"
      helper={categoryCommand.kind === 'delete' ? '删除分类不会删除任何知识库或知识点。' : undefined}
      onOpenChange={(open) => { if (!open) setCategoryCommand(null); }}
      onConfirm={runCategoryCommand}
    />
  ) : null;

  return (
    <div className="ik-kb-gallery">
      <div className="ik-kb-gallery-head">
        <div>
          <div style={{ fontSize: 12, color: 'var(--mut)', fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase' }}>Knowledge Bases</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 7, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 30, fontWeight: 840, letterSpacing: 0 }}>知识库</span>
            <span style={{ fontSize: 13, color: 'var(--mut)' }}>{kbs.length} 个知识库 · {entries.length} 条知识点 · {categories.length} 个分类</span>
          </div>
        </div>
        <div className="ik-kb-gallery-actions">
          <button
            className="ik-btn ik-btn-secondary ik-btn-size-md"
            onClick={() => {
              void onExportAll();
            }}
          >
            <span className="ik-btn-leading-icon"><Download size={15} strokeWidth={2.3} /></span>导出全部
          </button>
          <button className="ik-btn ik-btn-secondary ik-btn-size-md" onClick={() => setCategoryCommand({ kind: 'create', parentId: activeCategoryId, parentName: activeCategoryId ? activeCategoryName : undefined })}>
            <span className="ik-btn-leading-icon"><FolderPlus size={15} strokeWidth={2.4} /></span>新建分类
          </button>
          <button className="ik-btn ik-btn-default ik-btn-size-md" onClick={createKbInActiveCategory}>
            <span className="ik-btn-leading-icon"><Plus size={15} strokeWidth={2.4} /></span>新建知识库
          </button>
        </div>
      </div>

      <div className="ik-kb-library-layout">
        <aside className="ik-kb-category-panel">
          <div className="ik-kb-category-title">
            <span>分类树</span>
            <b>{visibleKbs.length}</b>
          </div>
          <div className="ik-kb-category-list">
            <button
              type="button"
              className={`ik-kb-category-row is-root ${activeCategory === ALL_CATEGORIES ? 'is-active' : ''}`}
              onClick={() => setActiveCategory(ALL_CATEGORIES)}
            >
              <span className="ik-kb-category-icon"><LibraryBig size={15} strokeWidth={2.05} /></span>
              <span className="ik-kb-category-name">全部知识库</span>
              <span className="ik-kb-category-count">{kbs.length}</span>
            </button>
            <button
              type="button"
              className={`ik-kb-category-row ${activeCategory === UNCATEGORIZED ? 'is-active' : ''}`}
              onClick={() => setActiveCategory(UNCATEGORIZED)}
            >
              <span className="ik-kb-category-icon"><Folder size={15} strokeWidth={2.05} /></span>
              <span className="ik-kb-category-name">未分类</span>
              <span className="ik-kb-category-count">{exactCount(null)}</span>
            </button>

            {categoryRows.map((row) => {
              const { category, childCount } = row;
              const active = activeCategory === category.id;
              return (
                <div
                  key={category.id}
                  className={`ik-kb-category-item ${active ? 'is-active' : ''} ${expanded.has(category.id) ? 'is-expanded' : ''}`}
                  style={{ paddingLeft: 4 + row.depth * 16 } as CSSProperties}
                >
                  <button
                    type="button"
                    className="ik-kb-category-expand"
                    disabled={childCount === 0}
                    title={expanded.has(category.id) ? '收起' : '展开'}
                    onClick={() => toggleExpanded(category.id)}
                  >
                    <ChevronRight size={14} strokeWidth={2.15} />
                  </button>
                  <button
                    type="button"
                    className="ik-kb-category-main"
                    onClick={() => setActiveCategory(category.id)}
                    title={category.name}
                  >
                    <span className="ik-kb-category-icon"><Folder size={15} strokeWidth={2.05} /></span>
                    <span className="ik-kb-category-name">{category.name}</span>
                    <span className="ik-kb-category-count">{subtreeCount(category.id)}</span>
                  </button>
                  <button
                    type="button"
                    className="ik-kb-category-tool"
                    title="新建子分类"
                    onClick={() => setCategoryCommand({ kind: 'create', parentId: category.id, parentName: category.name })}
                  >
                    <Plus size={13} strokeWidth={2.2} />
                  </button>
                  <button
                    type="button"
                    className="ik-kb-category-tool"
                    title="重命名分类"
                    onClick={() => setCategoryCommand({ kind: 'rename', category })}
                  >
                    <PencilLine size={13} strokeWidth={2.1} />
                  </button>
                  <button
                    type="button"
                    className="ik-kb-category-tool is-danger"
                    title="删除分类"
                    onClick={() => setCategoryCommand({ kind: 'delete', category })}
                  >
                    <Trash2 size={13} strokeWidth={2.1} />
                  </button>
                </div>
              );
            })}
          </div>
        </aside>

        <section className="ik-kb-library-main">
          <div className="ik-kb-section-head">
            <div>
              <span>{activeCategoryName}</span>
              <b>{visibleKbs.length} 个知识库</b>
            </div>
          </div>

          {visibleKbs.length > 0 ? (
            <div className="ik-kb-grid">
              {visibleKbs.map((kb) => {
                const n = entriesOfKb(kb.id).length;
                const fn = folders.filter((f) => f.kbId === kb.id).length;
                const category = kb.categoryId ? categoryById.get(kb.categoryId) : undefined;
                const currentCategoryValue = kb.categoryId ?? '';
                return (
                  <div
                    className="ik-kb-card"
                    key={kb.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openKb(kb)}
                    onKeyDown={(e) => {
                      if ((e.target as HTMLElement).closest('button, details, summary, select, input, a')) return;
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openKb(kb);
                      }
                    }}
                  >
                    <RowActions onRename={() => renameKbAction(kb)} onDelete={() => deleteKbAction(kb)} />
                    <div className="ik-kb-tile"><LibraryBig size={22} strokeWidth={1.95} /></div>
                    <div className="ik-kb-name">{kb.name}</div>
                    <div className="ik-kb-card-category">
                      <Tags size={13} strokeWidth={2.05} />
                      <span>{categoryName(category)}</span>
                    </div>
                    <div className="ik-kb-stats">
                      <span className="ik-kb-stat"><b>{fn}</b> 文件夹</span>
                      <span className="ik-kb-stat"><b>{n}</b> 知识点</span>
                    </div>
                    <details className="ik-kb-move-menu" onClick={(event) => event.stopPropagation()}>
                      <summary title="移动分类" aria-label="移动分类"><Tags size={14} strokeWidth={2.15} /></summary>
                      <div className="ik-kb-move-popover">
                        <div className="ik-kb-move-title">移动到</div>
                        {categoryOptions.map((option) => {
                          const selected = option.value === currentCategoryValue;
                          return (
                            <button
                              type="button"
                              key={option.value || 'none'}
                              className={`ik-kb-move-option ${selected ? 'is-selected' : ''}`}
                              style={{ paddingLeft: 10 + option.depth * 14 } as CSSProperties}
                              onClick={(event) => {
                                event.preventDefault();
                                if (selected) {
                                  event.currentTarget.closest('details')?.removeAttribute('open');
                                  return;
                                }
                                const next = option.value || null;
                                void moveKbToCategory(kb.id, next)
                                  .then(() => {
                                    event.currentTarget.closest('details')?.removeAttribute('open');
                                    toast('已移动知识库分类', 'success');
                                  })
                                  .catch((err) => toast('移动分类失败：' + (err instanceof Error ? err.message : String(err)), 'error'));
                              }}
                            >
                              <span>{option.label}</span>
                              {selected && <Check size={13} strokeWidth={2.2} />}
                            </button>
                          );
                        })}
                      </div>
                    </details>
                  </div>
                );
              })}
              <div className="ik-kb-create" onClick={createKbInActiveCategory} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); createKbInActiveCategory(); } }}>
                <span className="ik-kb-create-ico"><Plus size={20} strokeWidth={2.2} /></span>
                新建知识库
              </div>
            </div>
          ) : (
            <div className="ik-kb-empty">
              <LibraryBig size={24} strokeWidth={1.9} />
              <span>当前分类还没有知识库。</span>
              <button type="button" className="ik-btn ik-btn-default ik-btn-size-md" onClick={createKbInActiveCategory}>新建知识库</button>
            </div>
          )}
        </section>
      </div>

      {importPreview && (
        <ImportPreviewModal
          payload={importPreview.payload}
          preview={importPreview.preview}
          busy={importing}
          onClose={onCloseImportPreview}
          onConfirm={handleConfirmImport}
        />
      )}
      {categoryDialog}
      {commandDialog}
    </div>
  );
}
