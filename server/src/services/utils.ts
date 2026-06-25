import { createHash } from 'node:crypto';
import type { Response } from 'express';
import { listFolders } from '../db.js';

export function stableImportId(prefix: string, seed: string): string {
  return `${prefix}_${createHash('sha1').update(seed).digest('hex').slice(0, 18)}`;
}

export function folderPathLabel(folderId: string | null): string {
  if (!folderId) return '根层级';
  const folders = listFolders();
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const names: string[] = [];
  const seen = new Set<string>();
  let current = byId.get(folderId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return names.join(' / ') || '根层级';
}

export function sendSse(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function pathKey(parts: string[]): string {
  return parts.join('\u0000');
}
