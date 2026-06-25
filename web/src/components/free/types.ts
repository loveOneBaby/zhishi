import type { Entry, EntryInput, Folder, KnowledgeBase } from '../../types';

export type CommandState =
  | { kind: 'create-kb' }
  | { kind: 'generate-kb' }
  | { kind: 'init-folders'; kbId: string; parentId: string | null; kbName: string; targetLabel: string }
  | { kind: 'create-folder'; kbId: string; parentId: string | null }
  | { kind: 'generate-entry'; kbId: string; folderId: string | null }
  | { kind: 'rewrite-entry'; entry: Entry }
  | { kind: 'confirm-generated-entry'; kbId: string; folderId: string | null; input: EntryInput }
  | { kind: 'confirm-rewrite-entry'; entry: Entry; input: EntryInput }
  | { kind: 'restore-entry-version'; entry: Entry }
  | { kind: 'rename-kb'; kb: KnowledgeBase }
  | { kind: 'rename-folder'; folder: Folder }
  | { kind: 'delete-kb'; kb: KnowledgeBase }
  | { kind: 'delete-folder'; folder: Folder }
  | { kind: 'clear-folder'; folder: Folder }
  | { kind: 'delete-entry'; entry: Entry }
  | { kind: 'discard-edit' };

export interface RestoreSnapshot {
  kbs?: KnowledgeBase[];
  folders?: Folder[];
  entries: Entry[];
}
