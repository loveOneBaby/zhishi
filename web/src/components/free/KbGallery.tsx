import type { ReactNode } from 'react';
import { LibraryBig, Plus } from 'lucide-react';
import type { Entry, Folder, KnowledgeBase } from '../../types';
import ImportPreviewModal from '../ImportPreviewModal';
import type { ImportPayload, ImportPreview } from '../../api';
import { RowActions } from './RowActions';

interface KbGalleryProps {
  kbs: KnowledgeBase[];
  entries: Entry[];
  folders: Folder[];
  entriesOfKb: (kbId: string) => Entry[];
  newKb: () => void;
  openKb: (kb: KnowledgeBase) => void;
  renameKbAction: (kb: KnowledgeBase) => void;
  deleteKbAction: (kb: KnowledgeBase) => void;
  importPreview: { payload: ImportPayload; preview: ImportPreview } | null;
  importing: boolean;
  onCloseImportPreview: () => void;
  handleConfirmImport: (replace: boolean) => Promise<void>;
  commandDialog: ReactNode;
}

export function KbGallery(props: KbGalleryProps): ReactNode {
  const { kbs, entries, folders, entriesOfKb, newKb, openKb,
    renameKbAction, deleteKbAction, importPreview, importing, onCloseImportPreview,
    handleConfirmImport, commandDialog } = props;

  return (
    <div className="ik-kb-gallery">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 28, flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div style={{ fontSize: 12, color: 'var(--mut)', fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase' }}>Knowledge Bases</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 7 }}>
            <span style={{ fontSize: 30, fontWeight: 840, letterSpacing: '-.02em' }}>知识库</span>
            <span style={{ fontSize: 13, color: 'var(--mut)' }}>{kbs.length} 个知识库 · {entries.length} 条知识点</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="ik-btn ik-btn-default ik-btn-size-md" onClick={newKb}>
            <span className="ik-btn-leading-icon"><Plus size={15} strokeWidth={2.4} /></span>新建知识库
          </button>
        </div>
      </div>

      <div className="ik-kb-grid">
        {kbs.map((kb) => {
          const n = entriesOfKb(kb.id).length;
          const fn = folders.filter((f) => f.kbId === kb.id).length;
          return (
            <div
              className="ik-kb-card"
              key={kb.id}
              role="button"
              tabIndex={0}
              onClick={() => openKb(kb)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openKb(kb);
                }
              }}
            >
              <RowActions onRename={() => renameKbAction(kb)} onDelete={() => deleteKbAction(kb)} />
              <div className="ik-kb-tile"><LibraryBig size={22} strokeWidth={1.95} /></div>
              <div className="ik-kb-name">{kb.name}</div>
              <div className="ik-kb-stats">
                <span className="ik-kb-stat"><b>{fn}</b> 文件夹</span>
                <span className="ik-kb-stat"><b>{n}</b> 知识点</span>
              </div>
            </div>
          );
        })}
        <div className="ik-kb-create" onClick={newKb} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); newKb(); } }}>
          <span className="ik-kb-create-ico"><Plus size={20} strokeWidth={2.2} /></span>
          新建知识库
        </div>
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
      {commandDialog}
    </div>
  );
}
