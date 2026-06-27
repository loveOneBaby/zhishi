import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { FileText, FolderPlus, History, ImagePlus, LibraryBig, Pencil, Sparkles, Trash2 } from 'lucide-react';
import type { Entry, EntryInput, Folder, KnowledgeBase, KbCategory } from '../types';
import { folderChain, folderPathName, folderSubtreeIds } from '../tree';
import DetailSidePanel from './DetailSidePanel';
import LiveRewritePanel from './free/LiveRewritePanel';
import EntryEditor from './EntryEditor';
import ImportPreviewModal from './ImportPreviewModal';
import VersionHistoryModal from './VersionHistoryModal';
import KnowledgeTree from './KnowledgeTree';
import type { SelectOption } from './SelectField';
import { exportAll, generateEntryDraftWithAIStream, generateEntryIllustrationWithAIStream, rewriteEntryDraftWithAIStream, commitRewriteEntryDraft, type KbSuggestion } from '../api';
import { toast } from '../toast';
import { KbGallery } from './free/KbGallery';
import AiTaskCenter, { type AiQuickAction, type LiveTask } from './AiTaskCenter';
import { ROOT_IMPORT_TARGET, orderEntries, treePanelStyle } from './free/utils';
import { useAiLiveOutput } from './free/useAiLiveOutput';
import { useUndoableDeletes } from './free/useUndoableDeletes';
import { useImportLogic } from './free/useImportLogic';
import { useCommandSystem } from './free/useCommandSystem';
import { CommandDialogRenderer } from './free/CommandDialogRenderer';
import type { AiKnowledgeBaseJob } from '../api';

interface Props {
  entries: Entry[];
  kbs: KnowledgeBase[];
  kbCategories: KbCategory[];
  folders: Folder[];
  freeKb: string | null;
  freeFolder: string | null;
  setFreeKb: (id: string | null) => void;
  setFreeFolder: (id: string | null) => void;
  onNew: () => void;
  onCreate: (input: EntryInput) => Promise<Entry>;
  onUpdate: (id: string, input: EntryInput) => Promise<Entry>;
  onDelete: (id: string) => Promise<void>;
  onReorderEntries: (ids: string[]) => Promise<void>;
  onImported: (entries: Entry[], kbs: KnowledgeBase[], folders: Folder[], kbCategories?: KbCategory[]) => void;
  onGeneratedEntry: (entry: Entry) => void;
  onStartKnowledgeBaseJob: (domain: string) => Promise<void>;
  onStartFolderInitJob: (input: { kbId: string; parentId?: string | null; domain?: string }) => Promise<void>;
  onStartFolderEntriesJob: (input: { kbId: string; parentId?: string | null; domain?: string }) => Promise<void>;
  onStartAnalyzeJob: (kbId: string) => Promise<void>;
  onStartAnalyzeEntryJob: (entryId: string) => Promise<void>;
  onCreateKb: (name: string, categoryId?: string | null) => Promise<KnowledgeBase>;
  onCreateKbCategory: (input: { name: string; parentId?: string | null }) => Promise<KbCategory>;
  onRenameKbCategory: (id: string, name: string) => Promise<void>;
  onDeleteKbCategory: (id: string) => Promise<void>;
  onMoveKbToCategory: (id: string, categoryId?: string | null) => Promise<void>;
  onCreateFolder: (input: { kbId: string; parentId?: string | null; name: string }) => Promise<Folder>;
  onRenameKb: (id: string, name: string) => Promise<void>;
  onDeleteKb: (id: string) => Promise<void>;
  onRenameFolder: (id: string, name: string) => Promise<void>;
  onDeleteFolder: (id: string) => Promise<void>;
  onMoveFolder: (id: string, opts: { parentId?: string | null; kbId?: string }) => Promise<void>;
  onReorderFolders: (ids: string[]) => Promise<void>;
  aiJobs: AiKnowledgeBaseJob[];
  aiTaskPanelOpen: boolean;
  onAiTaskPanelOpenChange: (open: boolean) => void;
  onOpenAiJobResult: (job: AiKnowledgeBaseJob) => void;
  onCancelAiJob: (id: string) => Promise<void>;
  onRetryAiJob: (id: string) => Promise<void>;
  onClearAiJobHistory: () => Promise<void>;
}

export default function FreeMode(props: Props): ReactNode {
  const { entries, kbs, kbCategories, folders, freeKb, freeFolder, setFreeKb, setFreeFolder, onNew,
    onCreate, onUpdate, onDelete, onImported, onGeneratedEntry, onStartKnowledgeBaseJob, onStartFolderInitJob,
    onStartFolderEntriesJob, onStartAnalyzeJob, onStartAnalyzeEntryJob, onCreateKb, onCreateKbCategory, onRenameKbCategory, onDeleteKbCategory, onMoveKbToCategory, onCreateFolder, onRenameKb, onDeleteKb, onRenameFolder, onDeleteFolder, onMoveFolder, onReorderFolders, onReorderEntries,
    aiJobs, aiTaskPanelOpen, onAiTaskPanelOpenChange, onOpenAiJobResult, onCancelAiJob, onRetryAiJob, onClearAiJobHistory } = props;

  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(() => localStorage.getItem('ik_free_entry') || null);
  const [panelMode, setPanelMode] = useState<'detail' | 'create' | 'edit'>('detail');
  const dirtyRef = useRef(false);
  const pendingGuardRef = useRef<(() => void) | null>(null);

  const entriesOfKb = useMemo(() => (kbId: string) => orderEntries(entries.filter((e) => e.kbId === kbId)), [entries]);
  const currentKb = kbs.find((k) => k.id === freeKb) ?? null;
  const kbEntries = useMemo(() => (freeKb ? entriesOfKb(freeKb) : []), [entriesOfKb, freeKb]);
  const selectedEntry = useMemo(
    () => kbEntries.find((entry) => entry.id === selectedEntryId) ?? null,
    [kbEntries, selectedEntryId],
  );
  const currentFolderId = selectedEntry?.folderId ?? freeFolder;
  const currentFolderChain = useMemo(() => folderChain(folders, currentFolderId), [currentFolderId, folders]);
  const operationPath = [
    currentKb?.name ?? '知识库',
    ...(currentFolderChain.length ? currentFolderChain.map((folder) => folder.name) : ['根层级']),
  ];
  const viewingPath = selectedEntry ? [...operationPath, selectedEntry.title] : operationPath;
  const operationPathLabel = operationPath.join(' / ');
  const viewingPathLabel = viewingPath.join(' / ');
  const importFolderOptions = useMemo<SelectOption[]>(() => {
    if (!freeKb) return [];
    const currentRoot = currentKb?.name ? `${currentKb.name} / 根层级` : '知识库根层级';
    const folderOptions = folders
      .filter((folder) => folder.kbId === freeKb)
      .map((folder) => ({ value: folder.id, label: folderPathName(folders, folder.id) || folder.name }))
      .sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans-CN'));
    return [{ value: ROOT_IMPORT_TARGET, label: currentRoot }, ...folderOptions];
  }, [currentKb?.name, folders, freeKb]);
  const canImportJson = Boolean(freeKb);

  const aiLive = useAiLiveOutput();
  const deletes = useUndoableDeletes({
    entries, folders, freeFolder, selectedEntryId, currentKb,
    onImported, onDeleteKb, onDeleteFolder, onDelete,
    setFreeKb, setFreeFolder, setSelectedEntryId, setPanelMode, dirtyRef,
  });
  const importLogic = useImportLogic({
    freeKb, kbs, freeFolder, canImportJson, onImported, setFreeFolder, setPanelMode,
  });
  const { command, setCommand, confirmCommand, cancelRunningCommand } = useCommandSystem({
    aiLive, deletes, onCreateKb, onStartKnowledgeBaseJob, onStartFolderInitJob,
    onCreateFolder, onCreate, onRenameKb, onRenameFolder, onGeneratedEntry,
    setSelectedEntryId, setFreeFolder, setPanelMode, dirtyRef, pendingGuardRef,
  });

  useEffect(() => {
    if (!freeKb) {
      if (selectedEntryId) setSelectedEntryId(null);
      if (panelMode !== 'detail') setPanelMode('detail');
      return;
    }
    if (selectedEntryId && kbEntries.some((entry) => entry.id === selectedEntryId)) return;
    if (selectedEntryId && kbEntries.length === 0) return;
    setSelectedEntryId(kbEntries[0]?.id ?? null);
  }, [freeKb, kbEntries, panelMode, selectedEntryId]);

  useEffect(() => {
    if (selectedEntryId) localStorage.setItem('ik_free_entry', selectedEntryId);
    else localStorage.removeItem('ik_free_entry');
  }, [selectedEntryId]);

  useEffect(() => {
    if (!freeKb || !freeFolder) return;
    const stillExists = folders.some((folder) => folder.id === freeFolder && folder.kbId === freeKb);
    if (!stillExists) setFreeFolder(null);
  }, [folders, freeFolder, freeKb, setFreeFolder]);

  useEffect(() => {
    if (panelMode === 'edit' && !selectedEntry) setPanelMode('detail');
  }, [panelMode, selectedEntry]);

  const onDirtyChange = (dirty: boolean): void => {
    dirtyRef.current = dirty;
  };

  function guardPanel(next: () => void): void {
    if (dirtyRef.current) {
      pendingGuardRef.current = next;
      setCommand({ kind: 'discard-edit' });
      return;
    }
    next();
  }

  // ── 新建操作 ──
  function newKb(categoryId?: string | null, categoryName?: string): void {
    setCommand({ kind: 'create-kb', categoryId: categoryId ?? null, categoryName });
  }
  function startGenerateKnowledgeBase(): void {
    aiLive.resetAiLive();
    setCommand({ kind: 'generate-kb' });
  }
  function startInitFolders(parentId?: string | null): void {
    if (!currentKb) {
      toast('请先进入一个知识库，再初始化目录', 'info');
      return;
    }
    const targetParentId = parentId !== undefined ? parentId : (selectedEntry?.folderId ?? freeFolder ?? null);
    const targetLabel = targetParentId ? folderPathName(folders, targetParentId) : `${currentKb.name} / 根层级`;
    setCommand({
      kind: 'init-folders',
      kbId: currentKb.id,
      parentId: targetParentId,
      kbName: currentKb.name,
      targetLabel: targetLabel || '当前位置',
    });
  }
  function startGenerateFolderEntries(parentId?: string | null): void {
    if (!currentKb) {
      toast('请先进入一个知识库，再按目录生成知识点', 'info');
      return;
    }
    const targetParentId = parentId !== undefined ? parentId : (selectedEntry?.folderId ?? freeFolder ?? null);
    void onStartFolderEntriesJob({
      kbId: currentKb.id,
      parentId: targetParentId,
      domain: currentKb.name,
    }).catch((err) => {
      toast('按目录生成知识点失败：' + (err instanceof Error ? err.message : String(err)), 'error');
    });
  }
  function newFolder(kbId: string, parentId: string | null): void {
    setCommand({ kind: 'create-folder', kbId, parentId });
  }
  function renameKbAction(kb: KnowledgeBase): void {
    setCommand({ kind: 'rename-kb', kb });
  }
  function deleteKbAction(kb: KnowledgeBase): void {
    setCommand({ kind: 'delete-kb', kb });
  }
  function renameFolderAction(folder: Folder): void {
    setCommand({ kind: 'rename-folder', folder });
  }
  function deleteFolderAction(folder: Folder): void {
    setCommand({ kind: 'delete-folder', folder });
  }
  function clearFolderAction(folder: Folder): void {
    setCommand({ kind: 'clear-folder', folder });
  }

  async function handleExport(): Promise<void> {
    try {
      const all = await exportAll();
      const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `knowledge-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast('已导出全量知识点', 'success');
    } catch (err) {
      toast('导出失败：' + (err instanceof Error ? err.message : String(err)), 'error');
    }
  }

  function startCreateEntryInFolder(folderId: string | null): void {
    if (!freeKb) {
      onNew();
      return;
    }
    guardPanel(() => {
      setFreeFolder(folderId);
      setPanelMode('create');
      dirtyRef.current = false;
    });
  }

  function startGenerateEntry(): void {
    if (!freeKb) {
      toast('请先进入一个知识库，再生成知识点', 'info');
      return;
    }
    const folderId = selectedEntry?.folderId ?? freeFolder ?? null;
    aiLive.resetAiLive();
    setCommand({ kind: 'generate-entry', kbId: freeKb, folderId });
  }

  // AI 分析:作为后台任务跑(进队列、可持久化),建议的逐条应用在控制台里就地完成
  const [appliedIds, setAppliedIds] = useState<Set<string>>(() => new Set());
  const [runningId, setRunningId] = useState<string | null>(null);
  // 前端流式 AI 操作(生成/改写/图解)作为「实时任务」:运行时驱动实时预览,完成后保留为记录
  const [liveTasks, setLiveTasks] = useState<LiveTask[]>([]);
  const liveAbortRef = useRef<Map<string, AbortController>>(new Map());
  const liveBusy = (): boolean => liveAbortRef.current.size > 0;
  const patchLive = (id: string, patch: Partial<LiveTask>): void =>
    setLiveTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  function cancelLiveTask(id: string): void {
    patchLive(id, { status: 'cancelled', stage: '已取消' });
    liveAbortRef.current.get(id)?.abort();
    applyAllRef.current = false; // 同时中断"一键应用全部"的后续条目
  }
  const runningLive = liveTasks.find((t) => t.status === 'running') ?? null;

  // 直接生成一个知识点(不弹窗):输入题目后流式生成并写入当前位置
  function isAbortError(err: unknown): boolean {
    return err instanceof DOMException && err.name === 'AbortError';
  }
  function beginLiveTask(task: Omit<LiveTask, 'status' | 'raw' | 'createdAt'> & { raw?: string }): AbortController {
    const controller = new AbortController();
    liveAbortRef.current.set(task.id, controller);
    const liveTask: LiveTask = { ...task, raw: task.raw ?? '', status: 'running', createdAt: Date.now() };
    setLiveTasks((prev) => [liveTask, ...prev].slice(0, 30));
    return controller;
  }

  async function runGenerateEntryDirect(topic: string, folderId: string | null): Promise<void> {
    if (!freeKb) { toast('请先进入一个知识库，再生成知识点', 'info'); return; }
    const t = topic.trim();
    if (!t) { toast('请输入要生成的题目', 'info'); return; }
    if (liveBusy()) { toast('已有 AI 任务进行中，请稍候', 'info'); return; }
    onAiTaskPanelOpenChange(true);
    const id = `live_${Date.now().toString(36)}`;
    const controller = beginLiveTask({ id, entryId: '__generate__', title: t, label: 'AI 生成知识点', mode: 'generate', stage: '准备生成…' });
    try {
      const draft = await generateEntryDraftWithAIStream(
        { topic: t, kbId: freeKb, folderId },
        {
          onStage: (message) => patchLive(id, { stage: message }),
          onDelta: (content) => setLiveTasks((prev) => prev.map((x) => (x.id === id ? { ...x, raw: x.raw + content } : x))),
        },
        controller.signal,
      );
      if (controller.signal.aborted) throw new DOMException('aborted', 'AbortError');
      const entry = await onCreate({ ...draft, kbId: freeKb, folderId });
      onGeneratedEntry(entry);
      setFreeFolder(entry.folderId ?? null);
      setPanelMode('detail');
      setSelectedEntryId(entry.id);
      patchLive(id, { status: 'succeeded', stage: '已生成知识点' });
      toast('已生成知识点', 'success');
    } catch (err) {
      if (controller.signal.aborted || isAbortError(err)) { patchLive(id, { status: 'cancelled', stage: '已取消' }); toast('已取消生成', 'info'); }
      else { patchLive(id, { status: 'failed', stage: '生成失败' }); toast('生成失败：' + (err instanceof Error ? err.message : String(err)), 'error'); }
    } finally {
      liveAbortRef.current.delete(id);
    }
  }

  // 直接初始化目录(不弹窗):可选聚焦主题,默认知识库名,作为后台任务执行
  function startInitFoldersDirect(parentId: string | null, domain: string): void {
    if (!currentKb) { toast('请先进入一个知识库，再初始化目录', 'info'); return; }
    onAiTaskPanelOpenChange(true);
    void onStartFolderInitJob({ kbId: currentKb.id, parentId, domain: domain.trim() || currentKb.name });
  }

  // 直接生成图解(不弹窗):对当前知识点追加 AI 图解并写回
  async function runIllustrateDirect(): Promise<void> {
    if (!selectedEntry) { toast('请先选择一个知识点', 'info'); return; }
    if (liveBusy()) { toast('已有 AI 任务进行中，请稍候', 'info'); return; }
    onAiTaskPanelOpenChange(true);
    const target = selectedEntry;
    setSelectedEntryId(target.id);
    setPanelMode('detail');
    const id = `live_${Date.now().toString(36)}`;
    const controller = beginLiveTask({ id, entryId: target.id, title: target.title, label: 'AI 生成图解', mode: 'illustrate', stage: '调用 qwen-image 生成中文技术图解…' });
    try {
      const entry = await generateEntryIllustrationWithAIStream(target.id, {
        onStage: (message) => patchLive(id, { stage: message }),
        onImage: (payload) => patchLive(id, {
          stage: `图解已生成：${payload.caption || '知识点图解'}`,
          raw: JSON.stringify({ assetId: payload.assetId, url: payload.url, caption: payload.caption }, null, 2),
        }),
        onSaved: (next) => patchLive(id, { stage: `已写回：${next.title}` }),
      }, controller.signal);
      if (controller.signal.aborted) throw new DOMException('aborted', 'AbortError');
      onGeneratedEntry(entry);
      setSelectedEntryId(entry.id);
      patchLive(id, { status: 'succeeded', stage: '已生成图解' });
      toast('已生成图解', 'success');
    } catch (err) {
      if (controller.signal.aborted || isAbortError(err)) { patchLive(id, { status: 'cancelled', stage: '已取消' }); toast('已取消生成图解', 'info'); }
      else { patchLive(id, { status: 'failed', stage: '生成图解失败' }); toast('生成图解失败：' + (err instanceof Error ? err.message : String(err)), 'error'); }
    } finally {
      liveAbortRef.current.delete(id);
    }
  }

  // 改写当前/指定知识点,流式驱动实时预览,完成后落库返回最新 entry
  async function runLiveRewrite(entry: Entry, instruction?: string): Promise<boolean> {
    if (liveBusy()) { toast('已有 AI 任务进行中，请稍候', 'info'); return false; }
    setSelectedEntryId(entry.id);
    setPanelMode('detail');
    const id = `live_${Date.now().toString(36)}`;
    const controller = beginLiveTask({ id, entryId: entry.id, title: entry.title, label: 'AI 改写知识点', mode: 'rewrite', stage: '准备改写…' });
    try {
      const draft = await rewriteEntryDraftWithAIStream(
        entry.id,
        {
          onStage: (message) => patchLive(id, { stage: message }),
          onDelta: (content) => setLiveTasks((prev) => prev.map((x) => (x.id === id ? { ...x, raw: x.raw + content } : x))),
        },
        instruction,
        controller.signal,
      );
      if (controller.signal.aborted) throw new DOMException('aborted', 'AbortError');
      const saved = await commitRewriteEntryDraft(entry.id, draft);
      onGeneratedEntry(saved);
      setSelectedEntryId(saved.id);
      patchLive(id, { status: 'succeeded', stage: '已改写' });
      return true;
    } catch (err) {
      if (controller.signal.aborted || isAbortError(err)) { patchLive(id, { status: 'cancelled', stage: '已取消' }); toast('已取消改写', 'info'); return false; }
      patchLive(id, { status: 'failed', stage: '改写失败' });
      throw err;
    } finally {
      liveAbortRef.current.delete(id);
    }
  }
  function startAnalyzeKb(): void {
    if (!freeKb) {
      toast('请先进入一个知识库', 'info');
      return;
    }
    void onStartAnalyzeJob(freeKb);
  }
  const [applyingAll, setApplyingAll] = useState(false);
  const applyAllRef = useRef(false);
  function markApplied(id: string): void {
    setAppliedIds((prev) => { const next = new Set(prev); next.add(id); return next; });
  }
  async function applyAllSuggestions(list: KbSuggestion[]): Promise<void> {
    if (applyingAll || !freeKb) return;
    setApplyingAll(true);
    applyAllRef.current = true;
    let ok = 0;
    let fail = 0;
    try {
      const pending = list.filter((s) => s.kind !== 'note' && !appliedIds.has(s.id));
      // 把指向同一知识点的改写建议合并成一次改写,避免反复"构思 + 写入"
      const entryGroups = new Map<string, KbSuggestion[]>();
      const others: KbSuggestion[] = [];
      for (const s of pending) {
        if ((s.kind === 'refine-entry' || s.kind === 'rewrite-entry') && s.entryId) {
          const group = entryGroups.get(s.entryId) ?? [];
          group.push(s);
          entryGroups.set(s.entryId, group);
        } else {
          others.push(s);
        }
      }

      for (const [entryId, group] of entryGroups) {
        if (!applyAllRef.current) break;
        const entry = entries.find((e) => e.id === entryId);
        if (!entry) { fail += group.length; continue; }
        try {
          // 仅有一条「整篇改写」时走默认改写;否则把多条建议合成一份改写指令,一次成稿
          const onlyFullRewrite = group.length === 1 && group[0].kind === 'rewrite-entry';
          const instruction = onlyFullRewrite
            ? undefined
            : group.map((s, i) => `${i + 1}. ${[s.title, s.detail].filter(Boolean).join('：')}`).join('\n');
          const saved = await runLiveRewrite(entry, instruction);
          if (!saved) { fail += group.length; continue; }
          for (const s of group) markApplied(s.id);
          ok += group.length;
        } catch {
          fail += group.length;
        }
      }

      for (const s of others) {
        if (!applyAllRef.current) break;
        try {
          const applied = await applyOne(s);
          if (applied) ok += 1;
          else fail += 1;
        } catch {
          fail += 1;
        }
      }
    } finally {
      setApplyingAll(false);
      applyAllRef.current = false;
    }
    toast(`一键应用完成：成功 ${ok} 条${fail ? `，失败 ${fail} 条` : ''}`, fail ? 'info' : 'success');
  }
  // 单条应用的核心逻辑(供单点应用与一键应用复用)
  async function applyOne(s: KbSuggestion): Promise<boolean> {
    if (!freeKb) return false;
    setRunningId(s.id);
    try {
      if (s.kind === 'create-folder' && s.name) {
        await onCreateFolder({ kbId: freeKb, parentId: s.folderId ?? null, name: s.name });
        markApplied(s.id);
        return true;
      } else if (s.kind === 'rename-folder' && s.folderId && s.name) {
        await onRenameFolder(s.folderId, s.name);
        markApplied(s.id);
        return true;
      } else if (s.kind === 'create-entry' && s.name) {
        const draft = await generateEntryDraftWithAIStream({ topic: s.name, kbId: freeKb, folderId: s.folderId ?? null });
        const entry = await onCreate({ ...draft, kbId: freeKb, folderId: s.folderId ?? null });
        onGeneratedEntry(entry);
        setSelectedEntryId(entry.id);
        markApplied(s.id);
        return true;
      } else if (s.kind === 'rewrite-entry' && s.entryId) {
        const entry = entries.find((e) => e.id === s.entryId);
        if (!entry) return false;
        const saved = await runLiveRewrite(entry);
        if (!saved) return false;
        markApplied(s.id);
        return true;
      } else if (s.kind === 'refine-entry' && s.entryId) {
        const entry = entries.find((e) => e.id === s.entryId);
        if (!entry) return false;
        // 按建议改写:把建议标题 + 说明作为改写指令传给后端
        const instruction = [s.title, s.detail].filter(Boolean).join('：');
        const saved = await runLiveRewrite(entry, instruction);
        if (!saved) return false;
        markApplied(s.id);
        return true;
      }
      return false;
    } finally {
      setRunningId(null);
    }
  }
  async function applySuggestion(s: KbSuggestion): Promise<void> {
    if (!freeKb || runningId || applyingAll) return;
    try {
      const applied = await applyOne(s);
      if (applied) toast('已应用该建议', 'success');
    } catch (err) {
      toast('应用失败：' + (err instanceof Error ? err.message : String(err)), 'error');
    }
  }

  function startIllustrateEntry(): void {
    if (!selectedEntry) {
      toast('请先选择一个知识点', 'info');
      return;
    }
    aiLive.resetAiLive();
    setCommand({ kind: 'illustrate-entry', entry: selectedEntry });
  }

  const [versionEntry, setVersionEntry] = useState<Entry | null>(null);
  function restoreEntryVersionAction(): void {
    if (!selectedEntry) {
      toast('请先选择一个知识点', 'info');
      return;
    }
    setVersionEntry(selectedEntry);
  }

  function startEditEntry(): void {
    if (!selectedEntry) {
      toast('请先选择一个知识点', 'info');
      return;
    }
    guardPanel(() => {
      setPanelMode('edit');
      dirtyRef.current = false;
    });
  }

  function backToDetail(): void {
    guardPanel(() => {
      setPanelMode('detail');
      dirtyRef.current = false;
    });
  }

  function deleteSelectedEntry(): void {
    if (!selectedEntry) return;
    deleteEntryAction(selectedEntry);
  }

  function deleteEntryAction(entry: Entry): void {
    setCommand({ kind: 'delete-entry', entry });
  }

  function selectRoot(): void {
    guardPanel(() => {
      setFreeFolder(null);
      setSelectedEntryId(null);
      setPanelMode('detail');
      dirtyRef.current = false;
    });
  }

  function selectFolder(folder: Folder): void {
    guardPanel(() => {
      setFreeFolder(folder.id);
      setSelectedEntryId(null);
      setPanelMode('detail');
      dirtyRef.current = false;
    });
  }

  function selectEntry(entry: Entry): void {
    guardPanel(() => {
      setSelectedEntryId(entry.id);
      setFreeFolder(entry.folderId ?? null);
      setPanelMode('detail');
      dirtyRef.current = false;
    });
  }

  function editEntryAction(entry: Entry): void {
    guardPanel(() => {
      setSelectedEntryId(entry.id);
      setFreeFolder(entry.folderId ?? null);
      setPanelMode('edit');
      dirtyRef.current = false;
    });
  }

  async function moveEntryAction(entry: Entry, folderId: string | null): Promise<void> {
    const moved = await onUpdate(entry.id, {
      title: entry.title,
      kbId: entry.kbId,
      folderId,
      tags: entry.tags,
      summary: entry.summary,
      py: entry.py,
      intro: entry.intro,
      nodes: entry.nodes,
      doc: entry.doc,
    });
    if (selectedEntryId === entry.id) {
      setSelectedEntryId(moved.id);
      setFreeFolder(moved.folderId ?? null);
    }
  }

  function openKb(kb: KnowledgeBase): void {
    setFreeKb(kb.id);
    setFreeFolder(null);
    setSelectedEntryId(entriesOfKb(kb.id)[0]?.id ?? null);
    setPanelMode('detail');
    dirtyRef.current = false;
  }

  function backToKbList(): void {
    guardPanel(() => {
      setFreeKb(null);
      setFreeFolder(null);
      setSelectedEntryId(null);
      setPanelMode('detail');
      dirtyRef.current = false;
    });
  }

  function folderEntryCount(folderId: string): number {
    const ids = folderSubtreeIds(folders, folderId);
    return kbEntries.filter((entry) => entry.folderId && ids.has(entry.folderId)).length;
  }

  const commandDialog = (
    <CommandDialogRenderer
      command={command}
      folders={folders}
      entries={entries}
      entriesOfKb={entriesOfKb}
      currentKb={currentKb}
      aiLiveLogs={aiLive.aiLiveLogs}
      aiLivePlan={aiLive.aiLivePlan}
      aiLiveOutput={aiLive.aiLiveOutput}
      onSetCommand={setCommand}
      onResetAiLive={aiLive.resetAiLive}
      pendingGuardRef={pendingGuardRef}
      onConfirm={confirmCommand}
      onCancelRunning={cancelRunningCommand}
    />
  );
  const runAiAction = (action: () => void): void => {
    onAiTaskPanelOpenChange(false);
    action();
  };
  const aiContextLabel = selectedEntry ? viewingPathLabel : operationPathLabel;
  const aiActions: AiQuickAction[] = freeKb ? [
    {
      id: 'generate-entry',
      title: '生成知识点',
      description: selectedEntry ? '写入当前知识点所在文件夹' : '写入当前浏览位置',
      icon: <FileText size={16} strokeWidth={2.15} />,
      onClick: () => {},
      prompt: {
        placeholder: '输入要生成的题目，回车生成',
        submitLabel: '生成',
        onSubmit: (value) => { void runGenerateEntryDirect(value, selectedEntry?.folderId ?? freeFolder ?? null); },
      },
      meta: '实时生成',
    },
    {
      id: 'init-folders',
      title: '初始化目录',
      description: selectedEntry ? '围绕当前文件夹补齐结构' : '在当前位置生成目录骨架',
      icon: <FolderPlus size={16} strokeWidth={2.15} />,
      onClick: () => {},
      prompt: {
        placeholder: '聚焦主题（可留空，默认知识库名）',
        submitLabel: '初始化',
        optional: true,
        onSubmit: (value) => startInitFoldersDirect(selectedEntry?.folderId ?? freeFolder ?? null, value),
      },
      meta: '后台任务',
    },
    {
      id: 'folder-entries',
      title: '按目录补全知识点',
      description: '无需输入题目，自动为当前目录树生成内容',
      icon: <Sparkles size={16} strokeWidth={2.15} />,
      onClick: () => runAiAction(() => startGenerateFolderEntries(selectedEntry?.folderId ?? freeFolder ?? null)),
      confirm: true,
      meta: '后台任务',
    },
    {
      id: 'analyze-kb',
      title: 'AI 分析知识库',
      description: '诊断目录与内容,给出建议并逐条应用',
      icon: <Sparkles size={16} strokeWidth={2.15} />,
      onClick: () => { onAiTaskPanelOpenChange(true); startAnalyzeKb(); },
      confirm: true,
      meta: '诊断 / 建议',
    },
    ...(selectedEntry ? [
      {
        id: 'analyze-entry',
        title: 'AI 分析知识点',
        description: '诊断页面结构 / 内容质量 / 排版,给出建议',
        icon: <Sparkles size={16} strokeWidth={2.15} />,
        onClick: () => { onAiTaskPanelOpenChange(true); void onStartAnalyzeEntryJob(selectedEntry.id); },
        confirm: true,
        meta: '诊断 / 建议',
      },
      {
        id: 'illustrate-entry',
        title: '生成图解',
        description: '调用 qwen-image 追加中文技术图解',
        icon: <ImagePlus size={16} strokeWidth={2.15} />,
        onClick: () => { void runIllustrateDirect(); },
        confirm: true,
        meta: '写回 doc',
      },
    ] : []),
  ] : [
    {
      id: 'generate-kb',
      title: 'AI 新建知识库',
      description: '输入领域后后台生成目录和知识点',
      icon: <LibraryBig size={16} strokeWidth={2.15} />,
      onClick: () => {},
      prompt: {
        placeholder: '输入领域，如「Java 并发」',
        submitLabel: '生成',
        onSubmit: (value) => { void onStartKnowledgeBaseJob(value); },
      },
      meta: '后台任务',
    },
  ];
  const aiCenter = (
    <AiTaskCenter
      jobs={aiJobs}
      open={aiTaskPanelOpen}
      onOpenChange={onAiTaskPanelOpenChange}
      onOpenResult={onOpenAiJobResult}
      onCancel={onCancelAiJob}
      onRetry={onRetryAiJob}
      onClearHistory={onClearAiJobHistory}
      actions={aiActions}
      contextLabel={aiContextLabel}
      onApplySuggestion={applySuggestion}
      onApplyAllSuggestions={applyAllSuggestions}
      analysisAppliedIds={appliedIds}
      analysisRunningId={runningId}
      analysisApplyingAll={applyingAll}
      liveTasks={liveTasks}
      onCancelLiveTask={cancelLiveTask}
      onClearLiveHistory={() => setLiveTasks((prev) => prev.filter((task) => task.status === 'running'))}
    />
  );

  // ── 知识库列表页 ──
  if (!freeKb) {
    return (
      <>
        <KbGallery
          kbs={kbs}
          categories={kbCategories}
          entries={entries}
          folders={folders}
          entriesOfKb={entriesOfKb}
          newKb={newKb}
          createCategory={onCreateKbCategory}
          renameCategory={onRenameKbCategory}
          deleteCategory={onDeleteKbCategory}
          moveKbToCategory={onMoveKbToCategory}
          openKb={openKb}
          renameKbAction={renameKbAction}
          deleteKbAction={deleteKbAction}
          importPreview={importLogic.importPreview}
          importing={importLogic.importing}
          onCloseImportPreview={() => { if (!importLogic.importing) importLogic.setImportPreview(null); }}
          handleConfirmImport={importLogic.handleConfirmImport}
          commandDialog={commandDialog}
        />
        {aiCenter}
      </>
    );
  }

  const editorKey = `${panelMode}:${selectedEntry?.id ?? 'new'}:${freeKb}:${freeFolder ?? 'root'}`;

  return (
    <div className="ik-free-workspace">
      {aiCenter}
      {/* 右下角悬浮操作：默认只露一个按钮，点开才展开动作 */}
      <div className="ik-free-layout">
        <aside className="ik-surface ik-tree-panel" style={treePanelStyle}>
          <div className="ik-tree-panel-head">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
              <button
                type="button"
                className={`ik-location-chip ik-location-chip-button ${freeFolder === null && !selectedEntryId ? 'is-active' : ''}`}
                onClick={selectRoot}
                title={`${operationPathLabel} · 点击回到知识库根层级`}
              >
                {operationPathLabel}
              </button>
              <div className="ik-tree-panel-counter">
                {folders.filter((folder) => folder.kbId === freeKb).length} / {kbEntries.length}
              </div>
            </div>
          </div>

          <div className="ik-tree-panel-body">
            <KnowledgeTree
              kbId={freeKb}
              folders={folders.filter((folder) => folder.kbId === freeKb)}
              entries={kbEntries}
              selectedFolderId={freeFolder}
              selectedEntryId={selectedEntryId}
              folderEntryCount={folderEntryCount}
              onSelectFolder={selectFolder}
              onSelectEntry={selectEntry}
              onCreateFolder={(parentId) => newFolder(freeKb, parentId)}
              onCreateEntry={startCreateEntryInFolder}
              onRenameFolder={renameFolderAction}
              onDeleteFolder={deleteFolderAction}
              onClearFolder={clearFolderAction}
              onImportToFolder={importLogic.importToFolder}
              onImportHere={importLogic.importHere}
              onExportAll={handleExport}
              onEditEntry={editEntryAction}
              onDeleteEntry={deleteEntryAction}
              onDeleteBatch={deletes.deleteSelectionWithUndo}
              onMoveFolder={onMoveFolder}
              onReorderFolders={onReorderFolders}
              onMoveEntry={moveEntryAction}
              onReorderEntries={onReorderEntries}
            />
          </div>
        </aside>

        <div style={{ minWidth: 0, minHeight: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div className="ik-detail-region">
            {panelMode === 'create' ? (
              <EntryEditor
                key={editorKey}
                initial={null}
                kbs={kbs}
                folders={folders}
                defaultKbId={freeKb}
                defaultFolderId={freeFolder}
                onDirtyChange={onDirtyChange}
                onCancel={backToDetail}
                onSave={(input) =>
                  onCreate(input).then((entry) => {
                    setPanelMode('detail');
                    dirtyRef.current = false;
                    setSelectedEntryId(entry.id);
                    setFreeFolder(entry.folderId ?? null);
                    return entry;
                  })
                }
              />
            ) : panelMode === 'edit' && selectedEntry ? (
              <EntryEditor
                key={editorKey}
                initial={selectedEntry}
                kbs={kbs}
                folders={folders}
                onDirtyChange={onDirtyChange}
                onCancel={backToDetail}
                onSave={(input) =>
                  onUpdate(selectedEntry.id, input).then((entry) => {
                    setPanelMode('detail');
                    dirtyRef.current = false;
                    setSelectedEntryId(entry.id);
                    setFreeFolder(entry.folderId ?? null);
                    return entry;
                  })
                }
              />
            ) : runningLive && runningLive.entryId === selectedEntryId ? (
              <div className="ik-detail-shell">
                <LiveRewritePanel title={runningLive.title} raw={runningLive.raw} stage={runningLive.stage} mode={runningLive.mode} onCancel={() => cancelLiveTask(runningLive.id)} />
              </div>
            ) : (
              <div className="ik-detail-shell">
                <DetailSidePanel
                  entry={selectedEntry}
                  query=""
                  contextLabel={viewingPathLabel}
                  actions={selectedEntry ? (
                    <>
                      <button type="button" className="ik-segbtn" onClick={restoreEntryVersionAction}>
                        <History size={14} strokeWidth={2.15} />版本
                      </button>
                      <button type="button" className="ik-segbtn" onClick={startEditEntry}>
                        <Pencil size={14} strokeWidth={2.15} />编辑
                      </button>
                      <button type="button" className="ik-segbtn ik-segbtn-danger" onClick={deleteSelectedEntry}>
                        <Trash2 size={14} strokeWidth={2.15} />删除
                      </button>
                    </>
                  ) : null}
                />
              </div>
            )}
          </div>
        </div>
      </div>
      {importLogic.importPreview && (
        <ImportPreviewModal
          payload={importLogic.importPreview.payload}
          preview={importLogic.importPreview.preview}
          busy={importLogic.importing}
          previewing={importLogic.previewingImport}
          targetFolders={importFolderOptions}
          targetFolderId={importLogic.importPreview.payload.targetFolderId}
          allowReplace={false}
          onTargetFolderChange={(folderId) => {
            if (importLogic.importPreview) importLogic.refreshImportPreview({ ...importLogic.importPreview.payload, targetFolderId: folderId === ROOT_IMPORT_TARGET ? null : folderId });
          }}
          onClose={() => { if (!importLogic.importing && !importLogic.previewingImport) importLogic.setImportPreview(null); }}
          onConfirm={importLogic.handleConfirmImport}
        />
      )}
      {commandDialog}
      {versionEntry && (
        <VersionHistoryModal
          entry={versionEntry}
          onClose={() => setVersionEntry(null)}
          onRestored={(updated) => { onGeneratedEntry(updated); setSelectedEntryId(updated.id); }}
        />
      )}
      {/* 右键文件夹导入用的隐藏文件选择器 */}
      <input
        ref={importLogic.importInputRef}
        type="file"
        accept="application/json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const folderId = importLogic.pendingImportFolderRef.current;
          importLogic.pendingImportFolderRef.current = undefined;
          importLogic.handleImport(e, folderId);
        }}
      />
    </div>
  );
}
