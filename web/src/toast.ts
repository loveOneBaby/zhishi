// 极简全局 toast（pub/sub），任意模块可直接调用 toast(...)，无需 context 穿透。
export type ToastKind = 'info' | 'error' | 'success';
export interface ToastAction {
  label: string;
  onClick: () => void | Promise<void>;
}
export interface ToastItem { id: number; msg: string; kind: ToastKind; action?: ToastAction; }
export interface ToastOptions {
  action?: ToastAction;
  durationMs?: number;
}

const listeners = new Set<(items: ToastItem[]) => void>();
let items: ToastItem[] = [];
let seq = 0;

function emit(): void { for (const l of listeners) l(items); }

export function toast(msg: string, kind: ToastKind = 'info', options: ToastOptions = {}): void {
  const id = ++seq;
  items = [...items, { id, msg, kind, action: options.action }];
  emit();
  setTimeout(() => { items = items.filter((i) => i.id !== id); emit(); }, options.durationMs ?? (options.action ? 6400 : 3200));
}

export function subscribeToasts(listener: (items: ToastItem[]) => void): () => void {
  listeners.add(listener);
  listener(items);
  return () => { listeners.delete(listener); };
}
