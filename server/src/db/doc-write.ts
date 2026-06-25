import type { Block } from '../blocks.js';
import { createDataAsset } from './asset.js';
import { deriveDoc } from './client.js';
import { splitDocToIndex } from '../doc.js';
import type { IndexTree } from '../index-tree.js';

// 把图片块里的 data:base64 落库为 asset,只留站内 url(去重,避免 JSON 膨胀)
function rewriteDocImages(doc: Block[]): Block[] {
  const walk = (blocks: Block[]): void => {
    for (const b of blocks) {
      if (b.type === 'image') {
        const props = (b.props ?? {}) as Record<string, unknown>;
        const url = String(props.url ?? '');
        if (/^data:/i.test(url)) {
          const asset = createDataAsset(url, String(props.caption ?? ''));
          if (asset) props.url = asset.url;
        }
        b.props = props;
      }
      if (Array.isArray(b.children)) walk(b.children);
    }
  };
  walk(doc);
  return doc;
}

// 统一得到 canonical 块文档 + 派生索引,并落 idx(写入路径:含图片落库)
export function buildDocIdx(input: { doc?: unknown; intro?: unknown; nodes?: unknown; body?: string }): { doc: Block[]; tree: IndexTree; idx: string } {
  const doc = rewriteDocImages(deriveDoc(input));
  const tree = splitDocToIndex(doc);
  return { doc, tree, idx: JSON.stringify({ doc }) };
}
