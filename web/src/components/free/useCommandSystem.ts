import { useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { Entry, EntryInput, Folder, KnowledgeBase } from '../../types';
import {
  commitRewriteEntryDraft,
  fetchEntryVersions,
  generateEntryDraftWithAIStream,
  generateEntryIllustrationWithAIStream,
  restoreEntryVersion,
  rewriteEntryDraftWithAIStream,
} from '../../api';
import { toast } from '../../toast';
import type { CommandState } from './types';

interface CommandSystemDeps {
  aiLive: {
    setAiLiveLogs: Dispatch<SetStateAction<string[]>>;
    setAiLivePlan: Dispatch<SetStateAction<string>>;
    setAiLiveOutput: Dispatch<SetStateAction<string>>;
    aiRawOutputRef: MutableRefObject<string>;
    updateAiVisibleOutput: (nextRaw: string) => void;
  };
  deletes: {
    deleteKbWithUndo: (kb: KnowledgeBase) => Promise<void>;
    deleteFolderWithUndo: (folder: Folder, toastMessage?: string) => Promise<void>;
    deleteEntryWithUndo: (entry: Entry, toastMessage?: string) => Promise<void>;
    clearFolderWithUndo: (folder: Folder) => Promise<void>;
  };
  onCreateKb: (name: string) => Promise<KnowledgeBase>;
  onStartKnowledgeBaseJob: (domain: string) => Promise<void>;
  onStartFolderInitJob: (input: { kbId: string; parentId?: string | null; domain?: string }) => Promise<void>;
  onCreateFolder: (input: { kbId: string; parentId?: string | null; name: string }) => Promise<Folder>;
  onCreate: (input: EntryInput) => Promise<Entry>;
  onRenameKb: (id: string, name: string) => Promise<void>;
  onRenameFolder: (id: string, name: string) => Promise<void>;
  onGeneratedEntry: (entry: Entry) => void;
  setSelectedEntryId: (id: string | null) => void;
  setFreeFolder: (id: string | null) => void;
  setPanelMode: (mode: 'detail' | 'create' | 'edit') => void;
  dirtyRef: MutableRefObject<boolean>;
  pendingGuardRef: MutableRefObject<(() => void) | null>;
}

// 命令弹窗的确认逻辑：根据 command.kind 分发到对应的新建/生成/重命名/删除操作。
// AI 生成/改写走流式回调，实时回填 aiLive；删除走 deletes.*WithUndo 提供撤销。
export function useCommandSystem(deps: CommandSystemDeps) {
  const {
    aiLive, deletes, onCreateKb, onStartKnowledgeBaseJob, onStartFolderInitJob,
    onCreateFolder, onRenameKb, onRenameFolder, onGeneratedEntry,
    onCreate, setSelectedEntryId, setFreeFolder, setPanelMode, dirtyRef, pendingGuardRef,
  } = deps;
  const { setAiLiveLogs, setAiLivePlan, setAiLiveOutput, aiRawOutputRef, updateAiVisibleOutput } = aiLive;
  const { deleteKbWithUndo, deleteFolderWithUndo, deleteEntryWithUndo, clearFolderWithUndo } = deletes;
  const [command, setCommand] = useState<CommandState | null>(null);

  function commandErrorPrefix(next: CommandState): string {
    switch (next.kind) {
      case 'create-kb':
      case 'create-folder':
        return '新建失败';
      case 'generate-kb':
        return 'AI 新建知识库失败';
      case 'init-folders':
        return 'AI 初始化目录失败';
      case 'generate-entry':
        return '生成失败';
      case 'rewrite-entry':
        return '改写失败';
      case 'illustrate-entry':
        return '图解生成失败';
      case 'confirm-generated-entry':
        return '写入失败';
      case 'confirm-rewrite-entry':
        return '保存改写失败';
      case 'restore-entry-version':
        return '恢复版本失败';
      case 'rename-kb':
      case 'rename-folder':
        return '重命名失败';
      case 'delete-kb':
      case 'delete-folder':
      case 'delete-entry':
        return '删除失败';
      case 'clear-folder':
        return '清空失败';
      case 'discard-edit':
        return '操作失败';
    }
  }

  async function confirmCommand(value: string): Promise<void> {
    if (!command) return;
    try {
      switch (command.kind) {
        case 'create-kb': {
          await onCreateKb(value);
          toast('已新建知识库', 'success');
          return;
        }
        case 'generate-kb': {
          await onStartKnowledgeBaseJob(value);
          return;
        }
        case 'init-folders': {
          await onStartFolderInitJob({
            kbId: command.kbId,
            parentId: command.parentId,
            domain: value || command.kbName,
          });
          return;
        }
        case 'create-folder': {
          await onCreateFolder({ kbId: command.kbId, parentId: command.parentId, name: value });
          toast('已新建文件夹', 'success');
          return;
        }
        case 'generate-entry': {
          setAiLiveLogs(['提交主题到后端']);
          setAiLivePlan('');
          setAiLiveOutput('');
          aiRawOutputRef.current = '';
          const input = await generateEntryDraftWithAIStream({ topic: value, kbId: command.kbId, folderId: command.folderId }, {
            onStage: (message) => setAiLiveLogs((current) => [...current, message]),
            onContext: (items) => setAiLiveLogs((current) => [
              ...current,
              items.length ? `找到 ${items.length} 条相似知识点作为参考` : '没有找到相似知识点，直接生成',
            ]),
            onDelta: (content) => updateAiVisibleOutput(`${aiRawOutputRef.current}${content}`),
            onOutput: (content) => updateAiVisibleOutput(content),
            onParsed: (payload) => setAiLiveLogs((current) => [
              ...current,
              `解析完成：${payload.title || '未命名'} · ${payload.tags.length} 个标签 · ${payload.sections} 个小节`,
            ]),
            onImage: (payload) => setAiLiveLogs((current) => [...current, `图解已生成：${payload.caption || '知识点图解'}`]),
          });
          setAiLiveLogs((current) => [...current, `草稿已生成：${input.title}`]);
          setCommand({ kind: 'confirm-generated-entry', kbId: command.kbId, folderId: command.folderId, input });
          toast('AI 草稿已生成，请确认写入', 'success');
          return;
        }
        case 'confirm-generated-entry': {
          const entry = await onCreate({
            ...command.input,
            kbId: command.kbId,
            folderId: command.folderId,
          });
          setPanelMode('detail');
          dirtyRef.current = false;
          onGeneratedEntry(entry);
          setSelectedEntryId(entry.id);
          setFreeFolder(entry.folderId ?? null);
          toast('AI 已生成知识点', 'success');
          return;
        }
        case 'rewrite-entry': {
          setAiLiveLogs(['提交当前 doc 到后端']);
          setAiLivePlan('');
          setAiLiveOutput('');
          aiRawOutputRef.current = '';
          const input = await rewriteEntryDraftWithAIStream(command.entry.id, {
            onStage: (message) => setAiLiveLogs((current) => [...current, message]),
            onDelta: (content) => updateAiVisibleOutput(`${aiRawOutputRef.current}${content}`),
            onOutput: (content) => updateAiVisibleOutput(content),
            onParsed: (payload) => setAiLiveLogs((current) => [
              ...current,
              `解析完成：${payload.title || '未命名'} · ${payload.tags.length} 个标签 · ${payload.sections} 个小节`,
            ]),
            onImage: (payload) => setAiLiveLogs((current) => [...current, `图解已生成：${payload.caption || '知识点图解'}`]),
          });
          setAiLiveLogs((current) => [...current, `改写草稿已生成：${input.title}`]);
          setCommand({ kind: 'confirm-rewrite-entry', entry: command.entry, input });
          toast('AI 改写草稿已生成，请确认保存', 'success');
          return;
        }
        case 'illustrate-entry': {
          setAiLiveLogs(['提交当前知识点到 Qwen Image']);
          setAiLivePlan('');
          setAiLiveOutput('');
          aiRawOutputRef.current = '';
          const entry = await generateEntryIllustrationWithAIStream(command.entry.id, {
            onStage: (message) => setAiLiveLogs((current) => [...current, message]),
            onImage: (payload) => {
              setAiLiveLogs((current) => [...current, `图解已生成：${payload.caption || '知识点图解'}`]);
              setAiLivePlan(payload.prompt);
              setAiLiveOutput(JSON.stringify({ assetId: payload.assetId, url: payload.url, caption: payload.caption }, null, 2));
            },
            onSaved: (next) => setAiLiveLogs((current) => [...current, `已写回：${next.title}`]),
          });
          setPanelMode('detail');
          dirtyRef.current = false;
          onGeneratedEntry(entry);
          setSelectedEntryId(entry.id);
          setFreeFolder(entry.folderId ?? null);
          toast('AI 图解已生成', 'success');
          return;
        }
        case 'confirm-rewrite-entry': {
          const entry = await commitRewriteEntryDraft(command.entry.id, command.input);
          setPanelMode('detail');
          dirtyRef.current = false;
          onGeneratedEntry(entry);
          setSelectedEntryId(entry.id);
          setFreeFolder(entry.folderId ?? null);
          toast('AI 已改写知识点', 'success');
          return;
        }
        case 'restore-entry-version': {
          const versions = await fetchEntryVersions(command.entry.id);
          const latest = versions[0];
          if (!latest) throw new Error('暂无可恢复的历史版本');
          const entry = await restoreEntryVersion(command.entry.id, latest.id);
          setPanelMode('detail');
          dirtyRef.current = false;
          onGeneratedEntry(entry);
          setSelectedEntryId(entry.id);
          setFreeFolder(entry.folderId ?? null);
          toast(`已恢复到 ${new Date(latest.createdAt).toLocaleString('zh-CN')}`, 'success');
          return;
        }
        case 'rename-kb': {
          if (value === command.kb.name) return;
          await onRenameKb(command.kb.id, value);
          toast('已重命名知识库', 'success');
          return;
        }
        case 'rename-folder': {
          if (value === command.folder.name) return;
          await onRenameFolder(command.folder.id, value);
          toast('已重命名文件夹', 'success');
          return;
        }
        case 'delete-kb': {
          await deleteKbWithUndo(command.kb);
          return;
        }
        case 'delete-folder': {
          await deleteFolderWithUndo(command.folder);
          return;
        }
        case 'clear-folder': {
          await clearFolderWithUndo(command.folder);
          return;
        }
        case 'delete-entry': {
          await deleteEntryWithUndo(command.entry);
          setPanelMode('detail');
          dirtyRef.current = false;
          return;
        }
        case 'discard-edit': {
          const next = pendingGuardRef.current;
          pendingGuardRef.current = null;
          dirtyRef.current = false;
          next?.();
          return;
        }
      }
    } catch (err) {
      toast(`${commandErrorPrefix(command)}：${err instanceof Error ? err.message : String(err)}`, 'error');
      throw err;
    }
  }

  return { command, setCommand, confirmCommand };
}
