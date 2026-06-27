import type { ReactNode } from 'react';
import { PencilLine, Trash } from 'lucide-react';

// 卡片 / 树节点右侧的轻量操作按钮
export function RowActions({ children, onRename, onDelete }: { children?: ReactNode; onRename: () => void; onDelete: () => void }): ReactNode {
  return (
    <div className="ik-row-actions">
      {children}
      <button type="button" title="重命名" className="ik-row-action-btn" onClick={(e) => { e.stopPropagation(); onRename(); }}>
        <PencilLine size={14} strokeWidth={1.95} />
      </button>
      <button type="button" title="删除" className="ik-row-action-btn ik-row-action-danger" onClick={(e) => { e.stopPropagation(); onDelete(); }}>
        <Trash size={14} strokeWidth={1.95} />
      </button>
    </div>
  );
}
