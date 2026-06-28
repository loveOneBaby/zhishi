import { useEffect, useRef, useState } from 'react';
import { Check, Command, Keyboard } from 'lucide-react';

interface Props {
  doubleCommandEnabled: boolean;
  onDoubleCommandEnabled: (enabled: boolean) => void;
}

const SHORTCUTS = [
  { keys: ['⌘', '⌘'], title: '进入搜索', detail: '快速按两次 Command' },
  { keys: ['⌘', 'K'], title: '搜索', detail: '任意页面聚焦搜索框' },
  { keys: ['⌘', '/'], title: '关键点', detail: '打开标签筛选面板' },
  { keys: ['/'], title: '限定范围', detail: '在搜索框里选择知识库' },
  { keys: ['↑', '↓', '↵'], title: '浏览结果', detail: '选择并打开知识点' },
  { keys: ['Esc'], title: '收起/清空', detail: '关闭面板或清空当前搜索' },
];

export default function ShortcutMenu({ doubleCommandEnabled, onDoubleCommandEnabled }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutside = (event: PointerEvent): void => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={ref} className="ik-shortcuts">
      <button
        type="button"
        className={`ik-shortcuts-trigger ${open ? 'is-open' : ''}`}
        aria-label="快捷键"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="快捷键"
        onClick={() => setOpen((next) => !next)}
      >
        <Keyboard size={15} strokeWidth={2.1} />
      </button>
      {open && (
        <div className="ik-shortcuts-menu" role="dialog" aria-label="快捷键设置">
          <div className="ik-shortcuts-head">
            <span><Command size={14} strokeWidth={2.2} />快捷键</span>
            <b>{SHORTCUTS.length} 个</b>
          </div>
          <div className="ik-shortcuts-list">
            {SHORTCUTS.map((item) => (
              <div className="ik-shortcut-row" key={`${item.title}-${item.keys.join('')}`}>
                <span className="ik-shortcut-keys">
                  {item.keys.map((key, index) => <kbd key={`${key}-${index}`}>{key}</kbd>)}
                </span>
                <span className="ik-shortcut-copy">
                  <b>{item.title}</b>
                  <small>{item.detail}</small>
                </span>
              </div>
            ))}
          </div>
          <label className="ik-shortcut-toggle">
            <input
              type="checkbox"
              checked={doubleCommandEnabled}
              onChange={(event) => onDoubleCommandEnabled(event.target.checked)}
            />
            <span>{doubleCommandEnabled && <Check size={12} strokeWidth={2.4} />}</span>
            <b>启用双击 Command 进入搜索</b>
          </label>
        </div>
      )}
    </div>
  );
}
