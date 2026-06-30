import { useEffect, useMemo, useRef, type MouseEvent } from 'react';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import type { PartialBlock } from '@blocknote/core';
import type { Block } from '../types';
import { uploadAsset } from '../api';
import { resolveAssetUrl } from '../api/client';
import { linkifyBlocks } from '../linkify';

interface Props {
  initialBlocks?: Block[];
  initialMarkdown?: string;   // 无块文档时,用 markdown 解析回填(种子/旧数据)
  editable?: boolean;
  dark?: boolean;
  onChange?: (blocks: Block[]) => void;
  onChangeMarkdown?: (md: string) => void;  // 同步导出 markdown(模式B:文档→标题派生索引)
}

function safeOpenHref(href: string): string {
  const value = href.trim();
  if (!value) return '';
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? value : '';
  } catch {
    return '';
  }
}

function resolveBlockAssetUrls(blocks?: Block[]): Block[] | undefined {
  if (!blocks?.length) return blocks;
  let changed = false;
  const next = blocks.map((block) => {
    const children = resolveBlockAssetUrls(block.children);
    const url = typeof block.props?.url === 'string' ? resolveAssetUrl(block.props.url) : undefined;
    const propsChanged = Boolean(url && url !== block.props?.url);
    const childrenChanged = children !== block.children;
    if (!propsChanged && !childrenChanged) return block;
    changed = true;
    return {
      ...block,
      ...(propsChanged ? { props: { ...block.props, url } } : {}),
      ...(childrenChanged ? { children } : {}),
    };
  });
  return changed ? next : blocks;
}

// 基于 BlockNote 的块编辑器 / 只读视图(editable=false)。图片上传走 /api/assets。
export default function BlockEditor({ initialBlocks, initialMarkdown, editable = true, dark = false, onChange, onChangeMarkdown }: Props) {
  const resolvedInitialBlocks = useMemo(() => resolveBlockAssetUrls(initialBlocks), [initialBlocks]);
  // 只读预览:把纯文本里的裸 URL 转成可点击链接(编辑态保持原样,避免干扰输入)
  const seedBlocks = editable ? resolvedInitialBlocks : linkifyBlocks(resolvedInitialBlocks);
  const editor = useCreateBlockNote({
    initialContent: seedBlocks && seedBlocks.length ? (seedBlocks as unknown as PartialBlock[]) : undefined,
    uploadFile: async (file: File) => uploadAsset(file),
  });

  // 无初始块但有 markdown:异步解析后回填
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    if ((!resolvedInitialBlocks || resolvedInitialBlocks.length === 0) && initialMarkdown && initialMarkdown.trim()) {
      Promise.resolve(editor.tryParseMarkdownToBlocks(initialMarkdown))
        .then((blocks) => { editor.replaceBlocks(editor.document, resolveBlockAssetUrls(blocks as unknown as Block[]) as unknown as PartialBlock[]); })
        .catch(() => { /* 解析失败保持空 */ });
    }
  }, [editor, resolvedInitialBlocks, initialMarkdown]);

  // markdown 导出有异步竞态,用序号保证只采用最新一次
  const mdSeq = useRef(0);
  function handleChange(): void {
    onChange?.(editor.document as unknown as Block[]);
    if (onChangeMarkdown) {
      const seq = ++mdSeq.current;
      Promise.resolve(editor.blocksToMarkdownLossy(editor.document))
        .then((md) => { if (seq === mdSeq.current) onChangeMarkdown(md); })
        .catch(() => { /* 忽略 */ });
    }
  }

  // 只读预览时,拦截链接点击 → 新标签打开(BlockNote 默认不导航)。
  // 用捕获阶段,抢在 BlockNote/ProseMirror 自己的处理之前接管。
  function handleClickCapture(e: MouseEvent): void {
    if (editable) return;
    const anchor = (e.target as HTMLElement).closest('a');
    const href = anchor?.getAttribute('href');
    if (anchor && href) {
      e.preventDefault();
      e.stopPropagation();
      const safe = safeOpenHref(href);
      if (safe) window.open(safe, '_blank', 'noopener,noreferrer');
    }
  }

  return (
    <div className="ik-bn-wrap" onClickCapture={handleClickCapture}>
      <BlockNoteView
        editor={editor}
        editable={editable}
        className="ik-bn"
        theme={dark ? 'dark' : 'light'}
        onChange={handleChange}
      />
    </div>
  );
}
