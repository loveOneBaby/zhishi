// 扁平文件夹列表 ↔ 树结构的纯逻辑工具，供自由 / 管理 / 搜索模式复用。
import type { Folder } from './types';

export interface FolderNode {
  folder: Folder;
  children: FolderNode[];
}

const byParentIndex = (folders: Folder[]): Map<string | null, Folder[]> => {
  const map = new Map<string | null, Folder[]>();
  for (const f of folders) {
    const key = f.parentId;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(f);
  }
  for (const arr of map.values()) arr.sort((a, b) => a.sort - b.sort || (a.createdAt ?? 0) - (b.createdAt ?? 0));
  return map;
};

// 把文件夹列表构建为森林（仅根级 + 子树）
export function buildForest(folders: Folder[]): FolderNode[] {
  const byParent = byParentIndex(folders);
  const build = (parentId: string | null): FolderNode[] =>
    (byParent.get(parentId) ?? []).map((folder) => ({ folder, children: build(folder.id) }));
  return build(null);
}

// 某知识库的根级文件夹树
export function forestOfKb(folders: Folder[], kbId: string): FolderNode[] {
  return buildForest(folders.filter((f) => f.kbId === kbId));
}

// 文件夹路径链：从根到该 folder（含自身），用于面包屑
export function folderChain(folders: Folder[], folderId: string | null): Folder[] {
  if (!folderId) return [];
  const byId = new Map(folders.map((f) => [f.id, f] as const));
  const chain: Folder[] = [];
  let cur = byId.get(folderId);
  while (cur) {
    chain.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return chain;
}

// 文件夹路径名（展示用）：如「前端 / 基础概念」
export function folderPathName(folders: Folder[], folderId: string | null): string {
  return folderChain(folders, folderId).map((f) => f.name).join(' / ');
}

// 收集某 folder 子树下全部 folder id（含自身），用于级联统计 / 过滤
export function folderSubtreeIds(folders: Folder[], folderId: string | null): Set<string> {
  const result = new Set<string>();
  if (!folderId) return result;
  const byParent = byParentIndex(folders);
  const stack = [folderId];
  while (stack.length) {
    const cur = stack.pop()!;
    result.add(cur);
    for (const c of byParent.get(cur) ?? []) stack.push(c.id);
  }
  return result;
}
