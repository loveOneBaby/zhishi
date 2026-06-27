import type { ReactNode, MutableRefObject } from 'react';
import { ImagePlus, RotateCcw, Sparkles } from 'lucide-react';
import type { Block, Entry, EntryInput, Folder, KnowledgeBase } from '../../types';
import { folderPathName, folderSubtreeIds } from '../../tree';
import CommandDialog from '../CommandDialog';
import type { CommandState } from './types';

interface CommandDialogRendererProps {
  command: CommandState | null;
  folders: Folder[];
  entries: Entry[];
  entriesOfKb: (kbId: string) => Entry[];
  currentKb: KnowledgeBase | null;
  aiLiveLogs: string[];
  aiLivePlan: string;
  aiLiveOutput: string;
  onSetCommand: (cmd: CommandState | null) => void;
  onResetAiLive: () => void;
  pendingGuardRef: MutableRefObject<(() => void) | null>;
  onConfirm: (value: string) => Promise<void>;
  onCancelRunning?: () => void;
}

function inlineText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(inlineText).filter(Boolean).join('');
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return inlineText(obj.text ?? obj.content ?? obj.href ?? obj.url ?? '');
  }
  return '';
}

function collectHeadings(blocks?: Block[]): string[] {
  const out: string[] = [];
  const walk = (list?: Block[]): void => {
    if (!Array.isArray(list)) return;
    for (const block of list) {
      if (block.type === 'heading') {
        const text = inlineText(block.content).trim();
        if (text) out.push(text);
      }
      walk(block.children);
    }
  };
  walk(blocks);
  return out;
}

function DraftPreview({ input, mode }: { input: EntryInput; mode: 'create' | 'rewrite' }): ReactNode {
  const headings = collectHeadings(input.doc);
  const outline = headings.length ? headings : input.nodes?.map((node) => node.title).filter(Boolean) ?? [];
  return (
    <section className="ik-command-draft" aria-label="AI 草稿预览">
      <div className="ik-command-draft-head">
        <span>{mode === 'rewrite' ? '待保存改写' : '待写入草稿'}</span>
        <b>{input.title}</b>
        {input.summary && <p>{input.summary}</p>}
      </div>
      {input.tags.length > 0 && (
        <div className="ik-command-draft-tags">
          {input.tags.slice(0, 8).map((tag) => <span key={tag}>{tag}</span>)}
        </div>
      )}
      {outline.length > 0 && (
        <div className="ik-command-draft-outline">
          <span>内容结构</span>
          <ul>
            {outline.slice(0, 6).map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
          </ul>
        </div>
      )}
    </section>
  );
}

// 根据 command.kind 渲染对应的命令弹窗。AI 类弹窗关闭时需要清空 aiLive 实时输出。
export function CommandDialogRenderer(props: CommandDialogRendererProps): ReactNode {
  const {
    command, folders, entries, entriesOfKb, currentKb,
    aiLiveLogs, aiLivePlan, aiLiveOutput, onSetCommand, onResetAiLive, pendingGuardRef, onConfirm, onCancelRunning,
  } = props;

  if (!command) return null;
  if (command.kind === 'create-kb') {
    return (
      <CommandDialog
        open
        title="新建知识库"
        description={command.categoryName ? `创建到「${command.categoryName}」分类下，用于承载独立主题的文件夹和知识点。` : '创建一个新的知识库入口，用于承载独立主题的文件夹和知识点。'}
        inputLabel="知识库名称"
        placeholder="例如：AI Agent"
        confirmText="创建"
        onOpenChange={(open) => { if (!open) onSetCommand(null); }}
        onConfirm={onConfirm}
      />
    );
  }
  if (command.kind === 'generate-kb') {
    return (
      <CommandDialog
        open
        title="AI 新建知识库"
        description="提交后会在后台生成，任务面板会持续显示目录规划、高频题和写入结果。"
        inputLabel="领域名称"
        placeholder="例如：Java 后端、前端工程化、Redis、AI Agent"
        helper="会创建新的知识库，不会覆盖现有数据。你可以继续检索、编辑或浏览已有知识点。"
        confirmText="后台生成"
        size="wide"
        icon={<Sparkles size={18} strokeWidth={2.15} />}
        onOpenChange={(open) => {
          if (!open) {
            onSetCommand(null);
            onResetAiLive();
          }
        }}
        onConfirm={onConfirm}
      />
    );
  }
  if (command.kind === 'init-folders') {
    return (
      <CommandDialog
        open
        title="AI 初始化目录"
        description={`将在 ${command.targetLabel} 下初始化文件夹结构，只创建目录，不生成知识点。`}
        inputLabel="目录领域"
        initialValue={command.kbName}
        placeholder="例如：Kafka、Java 并发、前端工程化"
        helper="提交后在后台运行，你可以继续检索、编辑或浏览已有知识点。已有同名同层级目录会复用。"
        confirmText="后台初始化"
        size="wide"
        icon={<Sparkles size={18} strokeWidth={2.15} />}
        onOpenChange={(open) => { if (!open) onSetCommand(null); }}
        onConfirm={onConfirm}
      />
    );
  }
  if (command.kind === 'create-folder') {
    const parentLabel = command.parentId ? folderPathName(folders, command.parentId) : '知识库根层级';
    return (
      <CommandDialog
        open
        title="新建文件夹"
        description={`将创建在 ${parentLabel || '当前文件夹'} 下。`}
        inputLabel="文件夹名称"
        placeholder="例如：工作模式"
        confirmText="创建"
        helper="右键树节点也可以在指定文件夹下快速创建。"
        onOpenChange={(open) => { if (!open) onSetCommand(null); }}
        onConfirm={onConfirm}
      />
    );
  }
  if (command.kind === 'generate-entry') {
    const targetLabel = command.folderId ? folderPathName(folders, command.folderId) : `${currentKb?.name ?? '当前知识库'} / 根层级`;
    return (
      <CommandDialog
        open
        title="AI 生成知识点"
        description={`将生成到 ${targetLabel || '当前位置'}。`}
        inputLabel="主题或面试题"
        initialValue={command.topic ?? ''}
        placeholder="例如：ReAct 工作模式、RAG 多路召回、MCP 协议"
        helper="会自动生成知识内容、面试考点、常见追问和易错点。"
        confirmText="生成"
        submittingCancelText="取消生成"
        icon={<Sparkles size={18} strokeWidth={2.15} />}
        liveLogs={aiLiveLogs}
        livePlan={aiLivePlan}
        livePlanLabel="公开生成思路"
        liveOutput={aiLiveOutput}
        liveOutputLabel="结构化 JSON"
        closeOnConfirm={false}
        onCancelSubmitting={onCancelRunning}
        onOpenChange={(open) => {
          if (!open) {
            onSetCommand(null);
            onResetAiLive();
          }
        }}
        onConfirm={onConfirm}
      />
    );
  }
  if (command.kind === 'rewrite-entry') {
    return (
      <CommandDialog
        open
        title="AI 改写知识点"
        description={`将基于「${command.entry.title}」当前 doc 内容原地改写。`}
        helper="会保留当前知识库和文件夹，重写正文结构、面试考点、追问和易错点。"
        confirmText="开始改写"
        submittingCancelText="取消改写"
        icon={<Sparkles size={18} strokeWidth={2.15} />}
        liveLogs={aiLiveLogs}
        livePlan={aiLivePlan}
        livePlanLabel="公开改写思路"
        liveOutput={aiLiveOutput}
        liveOutputLabel="结构化 JSON"
        closeOnConfirm={false}
        onCancelSubmitting={onCancelRunning}
        onOpenChange={(open) => {
          if (!open) {
            onSetCommand(null);
            onResetAiLive();
          }
        }}
        onConfirm={onConfirm}
      />
    );
  }
  if (command.kind === 'illustrate-entry') {
    return (
      <CommandDialog
        open
        title="AI 生成图解"
        description={`将基于「${command.entry.title}」当前 doc 内容生成一张中文技术图解，并追加到正文末尾。`}
        helper="使用 qwen-image-2.0-pro，图片会下载到本地资源库，刷新后仍可查看。"
        confirmText="生成图解"
        submittingCancelText="取消图解"
        icon={<ImagePlus size={18} strokeWidth={2.15} />}
        liveLogs={aiLiveLogs}
        livePlan={aiLivePlan}
        livePlanLabel="图解提示词"
        liveOutput={aiLiveOutput}
        liveOutputLabel="图片资源"
        closeOnConfirm={false}
        onCancelSubmitting={onCancelRunning}
        onOpenChange={(open) => {
          if (!open) {
            onSetCommand(null);
            onResetAiLive();
          }
        }}
        onConfirm={onConfirm}
      />
    );
  }
  if (command.kind === 'confirm-generated-entry') {
    const targetLabel = command.folderId ? folderPathName(folders, command.folderId) : `${currentKb?.name ?? '当前知识库'} / 根层级`;
    return (
      <CommandDialog
        open
        title="确认写入知识点"
        description={`AI 已生成草稿，将写入到 ${targetLabel || '当前位置'}。`}
        helper="确认后才会写入知识库；取消会丢弃这次草稿。"
        confirmText="写入知识库"
        cancelText="丢弃草稿"
        size="wide"
        icon={<Sparkles size={18} strokeWidth={2.15} />}
        preview={<DraftPreview input={command.input} mode="create" />}
        onOpenChange={(open) => {
          if (!open) {
            onSetCommand(null);
            onResetAiLive();
          }
        }}
        onConfirm={onConfirm}
      />
    );
  }
  if (command.kind === 'confirm-rewrite-entry') {
    return (
      <CommandDialog
        open
        title="确认保存改写"
        description={`将覆盖「${command.entry.title}」当前内容，保存前会自动备份旧版本。`}
        helper="确认后写入当前知识点；取消会丢弃这次 AI 改写草稿。"
        confirmText="保存改写"
        cancelText="丢弃草稿"
        size="wide"
        icon={<Sparkles size={18} strokeWidth={2.15} />}
        preview={<DraftPreview input={command.input} mode="rewrite" />}
        onOpenChange={(open) => {
          if (!open) {
            onSetCommand(null);
            onResetAiLive();
          }
        }}
        onConfirm={onConfirm}
      />
    );
  }
  if (command.kind === 'restore-entry-version') {
    return (
      <CommandDialog
        open
        title="恢复上个版本"
        description={`将把「${command.entry.title}」恢复到最近一次 AI 改写前的备份。`}
        helper="恢复前会先保存当前内容为一个版本，方便继续回退。"
        confirmText="恢复"
        cancelText="取消"
        icon={<RotateCcw size={18} strokeWidth={2.15} />}
        onOpenChange={(open) => { if (!open) onSetCommand(null); }}
        onConfirm={onConfirm}
      />
    );
  }
  if (command.kind === 'rename-kb') {
    return (
      <CommandDialog
        open
        title="重命名知识库"
        description="名称会同步到这个知识库下的知识点分类。"
        inputLabel="知识库名称"
        initialValue={command.kb.name}
        confirmText="保存"
        onOpenChange={(open) => { if (!open) onSetCommand(null); }}
        onConfirm={onConfirm}
      />
    );
  }
  if (command.kind === 'rename-folder') {
    return (
      <CommandDialog
        open
        title="重命名文件夹"
        description={folderPathName(folders, command.folder.id) || command.folder.name}
        inputLabel="文件夹名称"
        initialValue={command.folder.name}
        confirmText="保存"
        onOpenChange={(open) => { if (!open) onSetCommand(null); }}
        onConfirm={onConfirm}
      />
    );
  }
  if (command.kind === 'delete-kb') {
    const entryCount = entriesOfKb(command.kb.id).length;
    const folderCount = folders.filter((folder) => folder.kbId === command.kb.id).length;
    return (
      <CommandDialog
        open
        tone="danger"
        title="删除知识库"
        description={`确定删除「${command.kb.name}」？其中包含 ${folderCount} 个文件夹、${entryCount} 条知识点。`}
        helper="此操作不可撤销，删除后需要重新导入或手动创建。"
        confirmText="删除"
        cancelText="保留"
        onOpenChange={(open) => { if (!open) onSetCommand(null); }}
        onConfirm={onConfirm}
      />
    );
  }
  if (command.kind === 'delete-folder') {
    const ids = folderSubtreeIds(folders, command.folder.id);
    const childCount = Math.max(0, ids.size - 1);
    const entryCount = entries.filter((entry) => entry.folderId && ids.has(entry.folderId)).length;
    return (
      <CommandDialog
        open
        tone="danger"
        title="删除文件夹"
        description={`确定删除「${command.folder.name}」？会同时删除 ${childCount} 个子文件夹、${entryCount} 条知识点。`}
        helper="删除文件夹会连同下面的内容一起移除。"
        confirmText="删除"
        cancelText="保留"
        onOpenChange={(open) => { if (!open) onSetCommand(null); }}
        onConfirm={onConfirm}
      />
    );
  }
  if (command.kind === 'clear-folder') {
    const ids = folderSubtreeIds(folders, command.folder.id);
    const childCount = Math.max(0, ids.size - 1);
    const entryCount = entries.filter((entry) => entry.folderId && ids.has(entry.folderId)).length;
    return (
      <CommandDialog
        open
        tone="danger"
        title="清空文件夹"
        description={`确定清空「${command.folder.name}」？会删除里面的 ${childCount} 个子文件夹、${entryCount} 条知识点，但保留这个文件夹本身。`}
        helper="只删除文件夹里的内容，文件夹会保留为空。"
        confirmText="清空"
        cancelText="保留"
        onOpenChange={(open) => { if (!open) onSetCommand(null); }}
        onConfirm={onConfirm}
      />
    );
  }
  if (command.kind === 'delete-entry') {
    return (
      <CommandDialog
        open
        tone="danger"
        title="删除知识点"
        description={`确定删除「${command.entry.title}」？`}
        helper="删除后不会影响同一文件夹下的其他知识点。"
        confirmText="删除"
        cancelText="保留"
        onOpenChange={(open) => { if (!open) onSetCommand(null); }}
        onConfirm={onConfirm}
      />
    );
  }
  return (
    <CommandDialog
      open
      tone="danger"
      title="放弃未保存修改"
      description="当前知识点还有未保存的编辑内容。"
      helper="放弃后会切换到你刚才选择的位置，未保存内容不会保留。"
      confirmText="放弃修改"
      cancelText="继续编辑"
      onOpenChange={(open) => {
        if (!open) {
          pendingGuardRef.current = null;
          onSetCommand(null);
        }
      }}
      onConfirm={onConfirm}
    />
  );
}
