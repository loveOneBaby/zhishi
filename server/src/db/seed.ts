import { db, DEFAULT_KB_NAME } from './client.js';
import { createKb, ensureKb } from './kb.js';
import { ensureFolder } from './folder.js';
import { SEED_LIBRARIES } from '../seed-data/index.js';
import { parseBodyToIndex } from '../index-tree.js';

// 一次性数据迁移：把旧的「按 cat 平铺」结构升级为「知识库 → 文件夹 → 知识点」
export function migrateKbFolder(): void {
  const applied = new Set(
    (db.prepare('SELECT version FROM seed_migrations').all() as { version: string }[]).map((r) => r.version)
  );
  if (applied.has('kb-folder-v1')) return;

  let defaultKbId: string;
  const kbCount = (db.prepare('SELECT COUNT(*) AS n FROM knowledge_bases').get() as { n: number }).n;
  if (kbCount === 0) {
    defaultKbId = createKb(DEFAULT_KB_NAME).id;
  } else {
    const first = db.prepare('SELECT id FROM knowledge_bases ORDER BY sort ASC, createdAt ASC LIMIT 1').get() as { id: string };
    defaultKbId = first.id;
  }

  // 为每个 distinct cat 在默认知识库下建根文件夹
  const cats = db.prepare(
    "SELECT DISTINCT COALESCE(NULLIF(cat,''),'未分类') AS cat FROM entries WHERE COALESCE(kbId,'')=''"
  ).all() as { cat: string }[];
  const catToFolder = new Map<string, string>();
  for (const { cat } of cats) catToFolder.set(cat, ensureFolder(defaultKbId, cat, null).id);

  const entriesToMigrate = db.prepare(
    "SELECT id, COALESCE(NULLIF(cat,''),'未分类') AS cat FROM entries WHERE COALESCE(kbId,'')=''"
  ).all() as { id: string; cat: string }[];
  const updateEntry = db.prepare('UPDATE entries SET kbId = :kbId, folderId = :folderId WHERE id = :id');
  db.exec('BEGIN');
  try {
    for (const e of entriesToMigrate) {
      updateEntry.run({ kbId: defaultKbId, folderId: catToFolder.get(e.cat) ?? null, id: e.id });
    }
    db.prepare('INSERT INTO seed_migrations (version, appliedAt) VALUES (?, ?)').run('kb-folder-v1', Date.now());
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  if (entriesToMigrate.length) {
    console.log(`[db] 已将 ${entriesToMigrate.length} 条知识点归入知识库 / 文件夹结构`);
  }
}

// ───────────────────────── 种子数据 ─────────────────────────

// 按版本导入知识库；旧种子的 markdown 正文在写入时转换为结构化索引。
// 种子统一归入「面试知识库」，并按 cat 自动建立根文件夹（与一次性迁移保持一致）。
export function seedBuiltins(): void {
  const applied = new Set(
    (db.prepare('SELECT version FROM seed_migrations').all() as { version: string }[]).map((row) => row.version)
  );
  const count = db.prepare('SELECT COUNT(*) AS n FROM entries').get() as { n: number };
  const defaultKb = ensureKb(DEFAULT_KB_NAME);
  const insert = db.prepare(
    `INSERT INTO entries (id, cat, kbId, folderId, title, py, tags, summary, body, idx, sort, createdAt, updatedAt)
     VALUES (:id, :cat, :kbId, :folderId, :title, :py, :tags, :summary, :body, :idx, :sort, :createdAt, :updatedAt)`
  );
  const updateBuiltin = db.prepare(
    `UPDATE entries SET cat=:cat, kbId=:kbId, folderId=:folderId, py=:py, tags=:tags,
       summary=:summary, body=:body, idx=:idx, updatedAt=:updatedAt WHERE id=:id`
  );
  const deleteBuiltin = db.prepare('DELETE FROM entries WHERE id = ?');
  const markApplied = db.prepare('INSERT INTO seed_migrations (version, appliedAt) VALUES (?, ?)');
  let added = 0, updated = 0, removed = 0;

  db.exec('BEGIN');
  try {
    for (const library of SEED_LIBRARIES) {
      if (applied.has(library.version)) continue;
      const skipLegacyBase = library.version === 'base-v1' && count.n > 0;
      if (!skipLegacyBase) {
        const now = Date.now();
        for (const e of library.entries) {
          const idx = JSON.stringify(parseBodyToIndex(e.body));
          const catName = (e.cat && e.cat.trim()) || '未分类';
          const folder = ensureFolder(defaultKb.id, catName, null);
          const kbId = defaultKb.id;
          const folderId = folder.id;
          const values = {
            id: e.id, cat: defaultKb.name, kbId, folderId, title: e.title, py: e.py,
            tags: JSON.stringify(e.tags), summary: e.summary, body: e.body, idx,
            sort: now, createdAt: now, updatedAt: now,
          };
          if (library.overwrite) {
            const info = updateBuiltin.run({
              id: e.id, cat: defaultKb.name, kbId, folderId, py: e.py,
              tags: JSON.stringify(e.tags), summary: e.summary, body: e.body, idx, updatedAt: now,
            });
            if (Number(info.changes) > 0) updated += Number(info.changes);
            else added += Number(insert.run(values).changes);
          } else {
            added += Number(insert.run(values).changes);
          }
        }
        for (const id of library.removeIds ?? []) removed += Number(deleteBuiltin.run(id).changes);
      }
      markApplied.run(library.version, Date.now());
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  if (added || updated || removed) {
    console.log(`[db] 内置知识点：新增 ${added}，更新 ${updated}，移除 ${removed}`);
  }
}
