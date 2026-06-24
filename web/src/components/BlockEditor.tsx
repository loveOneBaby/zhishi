import { useEffect, useRef } from 'react';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import type { PartialBlock } from '@blocknote/core';
import type { Block } from '../types';
import { uploadAsset } from '../api';

interface Props {
  initialBlocks?: Block[];
  initialMarkdown?: string;   // 无块文档时,用 markdown 解析回填(种子/旧数据)
  editable?: boolean;
  dark?: boolean;
  onChange?: (blocks: Block[]) => void;
  onChangeMarkdown?: (md: string) => void;  // 同步导出 markdown(模式B:文档→标题派生索引)
}

// 基于 BlockNote 的块编辑器 / 只读视图(editable=false)。图片上传走 /api/assets。
export default function BlockEditor({ initialBlocks, initialMarkdown, editable = true, dark = false, onChange, onChangeMarkdown }: Props) {
  const editor = useCreateBlockNote({
    initialContent: initialBlocks && initialBlocks.length ? (initialBlocks as unknown as PartialBlock[]) : undefined,
    uploadFile: async (file: File) => uploadAsset(file),
  });

  // 无初始块但有 markdown:异步解析后回填
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    if ((!initialBlocks || initialBlocks.length === 0) && initialMarkdown && initialMarkdown.trim()) {
      Promise.resolve(editor.tryParseMarkdownToBlocks(initialMarkdown))
        .then((blocks) => { editor.replaceBlocks(editor.document, blocks as unknown as PartialBlock[]); })
        .catch(() => { /* 解析失败保持空 */ });
    }
  }, [editor, initialBlocks, initialMarkdown]);

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

  return (
    <BlockNoteView
      editor={editor}
      editable={editable}
      theme={dark ? 'dark' : 'light'}
      onChange={handleChange}
    />
  );
}
