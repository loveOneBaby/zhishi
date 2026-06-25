import { useRef, useState } from 'react';
import type { ChangeEvent, MutableRefObject } from 'react';
import type { Entry, Folder, KnowledgeBase } from '../../types';
import { importAll, previewImport, type ImportPayload, type ImportPreview } from '../../api';
import { toast } from '../../toast';
import { newImportBatchId } from './utils';

interface ImportLogicDeps {
  freeKb: string | null;
  kbs: KnowledgeBase[];
  freeFolder: string | null;
  canImportJson: boolean;
  onImported: (entries: Entry[], kbs: KnowledgeBase[], folders: Folder[]) => void;
  setFreeFolder: (id: string | null) => void;
  setPanelMode: (mode: 'detail' | 'create' | 'edit') => void;
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
      const obj = parsed as {
        version?: string;
        meta?: unknown;
        package?: unknown;
        schema?: unknown;
        containers?: unknown[];
        extensions?: unknown;
        kbs?: unknown[];
        folders?: unknown[];
        tree?: unknown[];
        entries?: unknown[];
        assets?: unknown[];
      };
      const hasTree = Array.isArray(obj?.tree) && obj.tree.length > 0;
      const hasEntries = Array.isArray(obj?.entries) && obj.entries.length > 0;
      if (!hasTree && !hasEntries) {
        toast('文件需要 kb-package-2 的 entries 数组', 'error');
        return;
      }
      const payload: ImportPayload = {
        version: obj.version,
        meta: obj.meta,
        package: obj.package,
        schema: obj.schema,
        containers: obj.containers,
        extensions: obj.extensions,
        kbs: obj.kbs,
        folders: obj.folders,
        tree: obj.tree,
        entries: obj.entries,
        assets: obj.assets,
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

  function importToFolder(folder: Folder): void {
    if (!freeKb) {
      toast('请先进入一个知识库，再导入 JSON', 'info');
      return;
    }
    pendingImportFolderRef.current = folder.id;
    importInputRef.current?.click();
  }

  async function handleConfirmImport(replace: boolean): Promise<void> {
    if (!importPreview) return;
    const { payload, preview } = importPreview;
    const previewFolders = preview.folders ?? [];
    if (!Object.prototype.hasOwnProperty.call(payload, 'targetFolderId')) {
      toast('请选择导入位置', 'error');
      return;
    }
    setImporting(true);
    try {
      const next = await importAll(payload, replace);
      onImported(next.entries, next.kbs, next.folders);
      toast(`已导入 ${preview.valid} 条知识点，生成 ${previewFolders.length} 个文件夹`, 'success');
      setImportPreview(null);
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
    importToFolder,
    refreshImportPreview,
    handleConfirmImport,
  };
}
