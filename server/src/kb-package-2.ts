import { createHash, randomUUID } from 'node:crypto';
import { convertEntry, type Asset } from './blocks-import.js';
import type { ImportEntry, ImportFolder, ImportKb, ImportPayload } from './db.js';

export const KB_PACKAGE_2_VERSION = 'kb-package-2';

type Obj = Record<string, unknown>;

interface NormalizedContainer {
  sourceId: string;
  parentSourceId: string | null;
  kind: string;
  name: string;
  sort: number;
}

interface SourceRef {
  title: string;
  url: string;
}

function asObj(value: unknown): Obj {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Obj : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numeric(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function hasOwn(obj: Obj, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function stableId(prefix: string, seed: string): string {
  return `${prefix}_${createHash('sha1').update(seed).digest('hex').slice(0, 18)}`;
}

function parseAssets(raw: unknown): Asset[] {
  if (!Array.isArray(raw)) return [];
  const assets: Asset[] = [];
  for (const item of raw) {
    const obj = asObj(item);
    const id = text(obj.id) || text(obj.sourceId);
    const url = text(obj.url) || text(obj.href);
    if (!id) continue;
    assets.push({
      id,
      type: text(obj.type) || text(obj.kind) || undefined,
      url: url || undefined,
      width: numeric(obj.width, 0) || undefined,
      height: numeric(obj.height, 0) || undefined,
      alt: text(obj.alt) || text(obj.title) || undefined,
    });
  }
  return assets;
}

function parseContainers(raw: unknown): NormalizedContainer[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, index) => {
      const obj = asObj(item);
      const sourceId = text(obj.sourceId) || text(obj.id) || `container_${index + 1}`;
      const name = text(obj.name) || text(obj.title);
      if (!name) return null;
      return {
        sourceId,
        parentSourceId: text(obj.parentSourceId) || text(obj.parentId) || null,
        kind: text(obj.kind) || text(obj.type) || 'folder',
        name,
        sort: numeric(obj.sort, index),
      };
    })
    .filter((item): item is NormalizedContainer => Boolean(item));
}

function sourceRefs(raw: unknown): SourceRef[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const obj = asObj(item);
      const url = text(obj.url) || text(obj.href);
      const title = text(obj.title) || text(obj.name) || url;
      return title || url ? { title, url } : null;
    })
    .filter((item): item is SourceRef => Boolean(item));
}

function referenceBlocks(refs: SourceRef[]): NonNullable<ImportEntry['doc']> {
  if (!refs.length) return [];
  return [
    { type: 'heading', props: { level: 3 }, content: '参考链接' },
    ...refs.map((ref) => ({
      type: 'bulletListItem',
      content: ref.url ? `${ref.title}: ${ref.url}` : ref.title,
    })),
  ];
}

function referenceText(refs: SourceRef[]): string {
  if (!refs.length) return '';
  const lines = refs.map((ref) => ref.url ? `- ${ref.title}: ${ref.url}` : `- ${ref.title}`);
  return ['参考链接', ...lines].join('\n');
}

function cloneWithAssetUrls(value: unknown, assetById: Map<string, Asset>): unknown {
  if (Array.isArray(value)) return value.map((item) => cloneWithAssetUrls(item, assetById));
  if (!value || typeof value !== 'object') return value;
  const obj = value as Obj;
  const next: Obj = {};
  for (const [key, child] of Object.entries(obj)) next[key] = cloneWithAssetUrls(child, assetById);

  if (text(next.type) === 'image') {
    const props = asObj(next.props);
    const assetId = text(props.assetId) || text(props.sourceId) || text(next.assetId) || text(next.sourceId);
    const asset = assetId ? assetById.get(assetId) : undefined;
    if (asset?.url && !text(props.url) && !text(next.url)) {
      next.props = { ...props, url: asset.url, caption: text(props.caption) || asset.alt || undefined };
    }
  }
  return next;
}

function docWithRefsAndAssets(rawDoc: unknown, refs: SourceRef[], assetById: Map<string, Asset>): ImportEntry['doc'] | undefined {
  const refsDoc = referenceBlocks(refs);
  if (!Array.isArray(rawDoc)) return undefined;
  const doc = cloneWithAssetUrls(rawDoc, assetById) as NonNullable<ImportEntry['doc']>;
  return [...doc, ...refsDoc];
}

function introWithRefs(rawIntro: unknown, refs: SourceRef[]): unknown {
  if (!refs.length) return rawIntro;
  const refsText = referenceText(refs);
  if (!refsText) return rawIntro;
  const intro = text(rawIntro);
  return intro ? `${intro}\n\n${refsText}` : refsText;
}

export function isKbPackage2(input: unknown): boolean {
  return text(asObj(input).version) === KB_PACKAGE_2_VERSION;
}

export function kbPackage2ToImportPayload(input: unknown): ImportPayload {
  const payload = asObj(input);
  if (!isKbPackage2(payload)) throw new Error(`导入文件必须声明 version="${KB_PACKAGE_2_VERSION}"`);
  if (!Array.isArray(payload.entries)) throw new Error('kb-package-2 需要 entries 数组');

  const packageInfo = asObj(payload.package);
  const packageSourceId = text(packageInfo.sourceId)
    || text(packageInfo.id)
    || text(packageInfo.namespace)
    || text(packageInfo.title)
    || KB_PACKAGE_2_VERSION;
  const packageTitle = text(packageInfo.title) || text(packageInfo.name) || '知识包';
  const packageSourceUrl = text(packageInfo.sourceUrl);
  const packageSourceTitle = text(packageInfo.source) || packageTitle || '来源';
  const defaultSourceRefs = packageSourceUrl ? [{ title: packageSourceTitle, url: packageSourceUrl }] : [];
  const requestedKbId = text(payload.targetKbId);
  const targetKbName = text(payload.targetKbName);
  const targetFolderProvided = hasOwn(payload, 'targetFolderId');
  const targetFolderId = targetFolderProvided ? (text(payload.targetFolderId) || null) : undefined;
  const importBatchId = text(payload.importBatchId) || randomUUID();
  const routed = Boolean(requestedKbId || targetFolderProvided);

  const kbId = requestedKbId || stableId('kb', packageSourceId);
  const kbName = targetKbName || packageTitle;
  const kbs: ImportKb[] | undefined = requestedKbId ? undefined : [{ id: kbId, name: kbName, sort: 0 }];

  const containers = parseContainers(payload.containers);
  const containerIdMap = new Map<string, string>();
  for (const container of containers) {
    const seed = routed
      ? `${importBatchId}/${kbId}/${container.sourceId}`
      : `${packageSourceId}/${container.sourceId}`;
    containerIdMap.set(container.sourceId, stableId('fld', seed));
  }

  const folders: ImportFolder[] = containers.map((container) => {
    const id = containerIdMap.get(container.sourceId)!;
    const parentId = container.parentSourceId
      ? containerIdMap.get(container.parentSourceId)
      : (targetFolderProvided ? targetFolderId ?? null : null);
    if (container.parentSourceId && !parentId) {
      throw new Error(`容器 ${container.sourceId} 的 parentSourceId 不存在：${container.parentSourceId}`);
    }
    return {
      id,
      kbId,
      parentId: parentId ?? null,
      name: container.kind === 'folder' ? container.name : `${container.name}`,
      sort: container.sort,
    };
  });

  const assets = parseAssets(payload.assets);
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const entries: ImportEntry[] = payload.entries.map((raw, index) => {
    const obj = asObj(raw);
    const sourceId = text(obj.sourceId) || text(obj.id) || `entry_${index + 1}`;
    const containerSourceId = text(obj.containerSourceId);
    const mappedFolderId = containerSourceId ? containerIdMap.get(containerSourceId) : undefined;
    if (containerSourceId && !mappedFolderId) {
      throw new Error(`知识点 ${sourceId} 的 containerSourceId 不存在：${containerSourceId}`);
    }

    const refs = sourceRefs(obj.sourceRefs);
    const effectiveRefs = refs.length ? refs : defaultSourceRefs;
    const doc = docWithRefsAndAssets(obj.doc, effectiveRefs, assetById);
    const intro = Array.isArray(obj.doc) ? obj.intro : introWithRefs(obj.intro, effectiveRefs);
    const entryId = routed
      ? stableId('ke', `${importBatchId}/${kbId}/${sourceId}`)
      : stableId('ke', `${packageSourceId}/${sourceId}`);
    const entry = convertEntry({
      ...obj,
      id: entryId,
      kbId,
      cat: kbName,
      folderId: mappedFolderId ?? (targetFolderProvided ? targetFolderId ?? null : null),
      intro,
      doc,
    }, assets);
    return entry;
  });

  return {
    kbs,
    folders,
    entries,
    ...(requestedKbId ? { targetKbId: requestedKbId } : {}),
    targetKbName: kbName,
    ...(targetFolderProvided ? { targetFolderId: targetFolderId ?? null } : {}),
    importBatchId,
  };
}
