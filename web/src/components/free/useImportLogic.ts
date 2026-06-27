import { useRef, useState } from 'react';
import type { ChangeEvent, MutableRefObject } from 'react';
import type { Entry, Folder, KnowledgeBase, KbCategory } from '../../types';
import { importAll, previewImport, type ImportPayload, type ImportPreview } from '../../api';
import { toast } from '../../toast';
import { newImportBatchId } from './utils';

interface ImportLogicDeps {
  freeKb: string | null;
  kbs: KnowledgeBase[];
  freeFolder: string | null;
  canImportJson: boolean;
  onImported: (entries: Entry[], kbs: KnowledgeBase[], folders: Folder[], kbCategories?: KbCategory[]) => void;
  setFreeFolder: (id: string | null) => void;
  setPanelMode: (mode: 'detail' | 'create' | 'edit') => void;
}

type ImportFileObject = {
  version?: string;
  meta?: unknown;
  package?: unknown;
  schema?: unknown;
  containers?: unknown[];
  extensions?: unknown;
  kbCategories?: unknown[];
  kbs?: unknown[];
  folders?: unknown[];
  tree?: unknown[];
  entries?: unknown[];
  assets?: unknown[];
};

function hasImportContent(obj: ImportFileObject): boolean {
  return (Array.isArray(obj?.tree) && obj.tree.length > 0)
    || (Array.isArray(obj?.entries) && obj.entries.length > 0);
}

function baseImportPayload(obj: ImportFileObject): ImportPayload {
  return {
    version: obj.version,
    meta: obj.meta,
    package: obj.package,
    schema: obj.schema,
    containers: obj.containers,
    extensions: obj.extensions,
    kbCategories: obj.kbCategories,
    kbs: obj.kbs,
    folders: obj.folders,
    tree: obj.tree,
    entries: obj.entries,
    assets: obj.assets,
  };
}

// 导入流程：选文件 → 解析为 ImportPayload → 预览(previewImport) → 确认后 importAll 落库。
// 右键文件夹「导入」会用隐藏 input 选文件，并把目标文件夹锁定为该文件夹。
export function useImportLogic(deps: ImportLogicDeps) {
  const { freeKb, kbs, freeFolder, canImportJson, onImported, setFreeFolder, setPanelMode } = deps;

  const [importPreview, setImportPreview] = useState<{ payload: ImportPayload; preview: ImportPreview } | null>(null);
  const [importing, setImporting] = useState(false);
  const [previewingImport, setPreviewingImport] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const pendingImportFolderRef = useRef<string | null | undefined>(undefined);

  function refreshImportPreview(payload: ImportPayload): void {
    setPreviewingImport(true);
    previewImport(payload)
      .then((preview) => setImportPreview({ payload, preview }))
      .catch((err) => toast('解析失败：' + (err instanceof Error ? err.message : String(err)), 'error'))
      .finally(() => setPreviewingImport(false));
  }

  function handleImport(e: ChangeEvent<HTMLInputElement>, overrideFolderId?: string | null): void {
    const file = e.target.files?.[0];
    if (!file) return;
    const currentKb = freeKb ? kbs.find((kb) => kb.id === freeKb) : null;
    if (!currentKb) {
      toast('请先进入一个知识库，再导入数据', 'info');
      e.target.value = '';
      return;
    }
    if (!canImportJson) {
      toast('请先进入一个知识库，再导入 JSON', 'info');
      e.target.value = '';
      return;
    }
    // 右键文件夹导入会传入目标文件夹;否则默认导入到当前所在位置
    const targetFolderId = overrideFolderId !== undefined ? overrideFolderId : (freeFolder ?? null);
    const reader = new FileReader();
    reader.onload = () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(reader.result));
      } catch (err) {
        toast('文件解析失败：' + (err instanceof Error ? err.message : String(err)), 'error');
        return;
      }
      const obj = parsed as ImportFileObject;
      if (!hasImportContent(obj)) {
        toast('文件需要包含 entries 数组或 tree 结构', 'error');
        return;
      }
      const payload: ImportPayload = {
        ...baseImportPayload(obj),
        targetKbId: currentKb?.id,
        targetKbName: currentKb?.name,
        targetFolderId,
        importBatchId: newImportBatchId(),
      };
      refreshImportPreview(payload);
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function handleKnowledgeBaseImport(e: ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(reader.result));
      } catch (err) {
        toast('文件解析失败：' + (err instanceof Error ? err.message : String(err)), 'error');
        return;
      }
      const obj = parsed as ImportFileObject;
      if (!hasImportContent(obj)) {
        toast('文件需要包含 entries 数组或 tree 结构', 'error');
        return;
      }
      refreshImportPreview({
        ...baseImportPayload(obj),
        importBatchId: newImportBatchId(),
      });
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function importKnowledgeBases(): void {
    pendingImportFolderRef.current = undefined;
    importInputRef.current?.click();
  }

  function importToFolder(folder: Folder): void {
    if (!freeKb) {
      toast('请先进入一个知识库，再导入 JSON', 'info');
      return;
    }
    pendingImportFolderRef.current = folder.id;
    importInputRef.current?.click();
  }

  // 导入到当前所在位置(根层级或当前文件夹),供树工具栏 / 空状态使用
  function importHere(): void {
    if (!freeKb) {
      toast('请先进入一个知识库，再导入 JSON', 'info');
      return;
    }
    pendingImportFolderRef.current = freeFolder ?? null;
    importInputRef.current?.click();
  }

  async function handleConfirmImport(replace: boolean): Promise<void> {
    if (!importPreview) return;
    const { payload, preview } = importPreview;
    const previewFolders = preview.folders ?? [];
    const isScopedImport = Object.prototype.hasOwnProperty.call(payload, 'targetKbId')
      || Object.prototype.hasOwnProperty.call(payload, 'targetKbName')
      || Object.prototype.hasOwnProperty.call(payload, 'targetFolderId');
    if (isScopedImport && !Object.prototype.hasOwnProperty.call(payload, 'targetFolderId')) {
      toast('请选择导入位置', 'error');
      return;
    }
    setImporting(true);
    try {
      const next = await importAll(payload, replace);
      onImported(next.entries, next.kbs, next.folders, next.kbCategories);
      const importedKbCount = Array.isArray(payload.kbs) ? payload.kbs.length : 0;
      const importedKbText = !isScopedImport && importedKbCount > 0 ? `${importedKbCount} 个知识库、` : '';
      toast(`已导入 ${importedKbText}${preview.valid} 条知识点，生成 ${previewFolders.length} 个文件夹`, 'success');
      setImportPreview(null);
      if (!isScopedImport) {
        setPanelMode('detail');
        return;
      }
      const importedFolderIds = new Set(previewFolders.map((folder) => folder.id).filter((id): id is string => Boolean(id)));
      const firstImportedFolder = next.folders.find((folder) => importedFolderIds.has(folder.id) && folder.parentId === payload.targetFolderId)
        ?? next.folders.find((folder) => importedFolderIds.has(folder.id));
      setFreeFolder(firstImportedFolder?.id ?? payload.targetFolderId ?? null);
      setPanelMode('detail');
    } catch (err) {
      toast('导入失败：' + (err instanceof Error ? err.message : String(err)), 'error');
    } finally {
      setImporting(false);
    }
  }

  return {
    importPreview,
    setImportPreview,
    importing,
    previewingImport,
    importInputRef,
    pendingImportFolderRef,
    handleImport,
    handleKnowledgeBaseImport,
    importKnowledgeBases,
    importToFolder,
    importHere,
    refreshImportPreview,
    handleConfirmImport,
  };
}
