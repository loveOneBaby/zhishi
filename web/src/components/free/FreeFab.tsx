import type { ReactNode } from 'react';
import { Download, FileText, FolderPlus, ImagePlus, Pencil, Plus, Sparkles, Trash2, Upload, X } from 'lucide-react';
import type { Entry } from '../../types';
import { toast } from '../../toast';

interface FreeFabProps {
  fabOpen: boolean;
  setFabOpen: (next: boolean | ((prev: boolean) => boolean)) => void;
  selectedEntry: Entry | null;
  freeKb: string;
  freeFolder: string | null;
  canImportJson: boolean;
  startEditEntry: () => void;
  startCreateEntryInFolder: (folderId: string | null) => void;
  startGenerateEntry: () => void;
  startInitFolders: (parentId?: string | null) => void;
  startRewriteEntry: () => void;
  startIllustrateEntry: () => void;
  deleteEntryAction: (entry: Entry) => void;
  startCreateEntry: () => void;
  newFolder: (kbId: string, parentId: string | null) => void;
  handleImport: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleExport: () => Promise<void>;
}

export function FreeFab(props: FreeFabProps): ReactNode {
  const { fabOpen, setFabOpen, selectedEntry, freeKb, freeFolder, canImportJson,
    startEditEntry, startCreateEntryInFolder, startGenerateEntry, startInitFolders,
    startRewriteEntry, startIllustrateEntry, deleteEntryAction, startCreateEntry, newFolder, handleImport, handleExport } = props;

  return (
    <>
      {fabOpen && <div onClick={() => setFabOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 30 }} />}
      <div className="ik-fab-wrap">
        {fabOpen && (
          <div className="ik-fab-menu">
            {selectedEntry ? (
              <>
                <button className="ik-fab-item ik-fab-item-primary" onClick={() => { setFabOpen(false); startEditEntry(); }}>
                  <span className="ik-fab-ico"><Pencil size={16} strokeWidth={2.15} /></span>编辑当前知识点
                </button>
                <button className="ik-fab-item" onClick={() => { setFabOpen(false); startCreateEntryInFolder(selectedEntry.folderId ?? null); }}>
                  <span className="ik-fab-ico"><FileText size={16} strokeWidth={2.1} /></span>新建同级知识点
                </button>
                <div className="ik-fab-sep" />
                <button className="ik-fab-item ik-fab-item-primary" onClick={() => { setFabOpen(false); startGenerateEntry(); }}>
                  <span className="ik-fab-ico"><Sparkles size={16} strokeWidth={2.15} /></span>AI 生成知识点
                </button>
                <button className="ik-fab-item ik-fab-item-primary" onClick={() => { setFabOpen(false); startInitFolders(selectedEntry.folderId ?? null); }}>
                  <span className="ik-fab-ico"><FolderPlus size={16} strokeWidth={2.1} /></span>AI 初始化目录
                </button>
                <button className="ik-fab-item ik-fab-item-primary" onClick={() => { setFabOpen(false); startRewriteEntry(); }}>
                  <span className="ik-fab-ico"><Sparkles size={16} strokeWidth={2.15} /></span>AI 改写当前知识点
                </button>
                <button className="ik-fab-item ik-fab-item-primary" onClick={() => { setFabOpen(false); startIllustrateEntry(); }}>
                  <span className="ik-fab-ico"><ImagePlus size={16} strokeWidth={2.15} /></span>AI 生成图解
                </button>
                <div className="ik-fab-sep" />
                <button className="ik-fab-item ik-fab-item-danger" onClick={() => { setFabOpen(false); deleteEntryAction(selectedEntry); }}>
                  <span className="ik-fab-ico"><Trash2 size={16} strokeWidth={2.1} /></span>删除当前知识点
                </button>
              </>
            ) : (
              <>
                <button className="ik-fab-item ik-fab-item-primary" onClick={() => { setFabOpen(false); startCreateEntry(); }}>
                  <span className="ik-fab-ico"><Plus size={16} strokeWidth={2.2} /></span>新建知识点
                </button>
                <button className="ik-fab-item ik-fab-item-primary" onClick={() => { setFabOpen(false); startGenerateEntry(); }}>
                  <span className="ik-fab-ico"><Sparkles size={16} strokeWidth={2.15} /></span>AI 生成知识点
                </button>
                <button className="ik-fab-item ik-fab-item-primary" onClick={() => { setFabOpen(false); startInitFolders(freeFolder ?? null); }}>
                  <span className="ik-fab-ico"><FolderPlus size={16} strokeWidth={2.1} /></span>AI 初始化目录
                </button>
                <button className="ik-fab-item" onClick={() => { setFabOpen(false); newFolder(freeKb, freeFolder); }}>
                  <span className="ik-fab-ico"><FolderPlus size={16} strokeWidth={2.1} /></span>{freeFolder ? '新建子文件夹' : '新建文件夹'}
                </button>
              </>
            )}
            <div className="ik-fab-sep" />
            <label
              className={`ik-fab-item ${canImportJson ? '' : 'ik-fab-item-disabled'}`}
              onClick={(e) => {
                if (canImportJson) return;
                e.preventDefault();
                toast('请先进入一个知识库，再导入 JSON', 'info');
              }}
            >
              <span className="ik-fab-ico"><Upload size={16} strokeWidth={2.1} /></span>导入到当前位置
              <input disabled={!canImportJson} type="file" accept="application/json" onChange={(e) => { setFabOpen(false); handleImport(e); }} style={{ display: 'none' }} />
            </label>
            <button className="ik-fab-item" onClick={() => { setFabOpen(false); handleExport(); }}>
              <span className="ik-fab-ico"><Download size={16} strokeWidth={2.1} /></span>导出全部
            </button>
          </div>
        )}
        <button className="ik-fab" title="操作" onClick={() => setFabOpen((v) => !v)}>
          {fabOpen ? <X size={22} strokeWidth={2.25} /> : <Plus size={23} strokeWidth={2.25} />}
        </button>
      </div>
    </>
  );
}
