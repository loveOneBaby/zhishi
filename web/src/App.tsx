import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { LogOut } from 'lucide-react';
import type { Entry, EntryInput, Folder, KnowledgeBase, KbCategory, ThemeKey } from './types';
import { THEMES, themeVars } from './themes';
import { filterEntries, suggestQueries, type SearchSuggestion } from './search';
import {
  fetchBootstrap,
  fetchEntry,
  fetchAiJobs,
  createEntry,
  updateEntry,
  deleteEntry,
  reorderEntries,
  createKb,
  createKbCategory,
  renameKbCategory,
  deleteKbCategory,
  moveKbToCategory,
  renameKb,
  deleteKb,
  deleteKbTag,
  updateKbFavorite,
  createFolder,
  renameFolder,
  deleteFolder,
  moveFolder,
  reorderFolders,
  startGenerateKnowledgeBaseJob,
  startInitKnowledgeBaseFoldersJob,
  startGenerateKnowledgePointsFromFoldersJob,
  startGenerateFoldersAndKnowledgePointsJob,
  startAnalyzeJob,
  startAnalyzeEntryJob,
  startAgentEditJob,
  cancelAiJob,
  retryAiJob,
  applyAiJobDraft,
  revertAiJobApply,
  clearAiJob,
  clearAiJobHistory,
  type AiKnowledgeBaseJob,
  type EntryInput as ApiEntryInput,
} from './api';
import { logout, type AuthStatus } from './api';
import { getApiBase } from './api/client';
import TopBar, { type AppMode } from './components/TopBar';
import SearchBox from './components/SearchBox';
import SearchMode from './components/SearchMode';
import FreeMode from './components/FreeMode';
import {
  ALL_CATEGORIES as KB_GALLERY_ALL,
  FAVORITES as KB_GALLERY_FAVORITES,
  UNCATEGORIZED as KB_GALLERY_UNCATEGORIZED,
  type ActiveCategory as KbGalleryCategory,
} from './components/free/KbGallery';
import DetailModal from './components/DetailModal';
import AskModal from './components/AskModal';
import EntryEditor from './components/EntryEditor';
import AiTaskCenter from './components/AiTaskCenter';
import LoginPanel from './components/LoginPanel';
import ShortcutMenu from './components/ShortcutMenu';
import DesktopUpdateButton from './components/DesktopUpdateButton';
import Toaster from './components/Toaster';
import { toast } from './toast';

// 轻量哈希路由:把「模块 + 视图 + 当前知识库/文件夹 + 知识点 ID」写进 URL,刷新/前进后退/分享都能恢复
// free 模式:#/library(知识库画廊) | #/library/favorites | #/library/uncategorized | #/library/category/{categoryId}
//          #/kb/{kbId} | #/kb/{kbId}/folder/{folderId},进入知识库后用 ?category=... 保留来源分类
// search 模式:#/search/list | #/search/canvas | #/search/list/{entryId} | #/search/canvas/{entryId}
type Route = {
  mode: AppMode;
  viewType: 'list' | 'canvas';
  kbId: string | null;
  folderId: string | null;
  entryId: string | null;
  libraryCategory: KbGalleryCategory;
};

function decodeHashPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function libraryCategoryFromValue(value: string | null | undefined): KbGalleryCategory {
  if (!value || value === 'all') return KB_GALLERY_ALL;
  if (value === 'favorites') return KB_GALLERY_FAVORITES;
  if (value === 'uncategorized') return KB_GALLERY_UNCATEGORIZED;
  return value;
}

function libraryCategoryFromPath(parts: string[]): KbGalleryCategory {
  const segment = parts[1] ?? '';
  if (segment === 'favorites') return KB_GALLERY_FAVORITES;
  if (segment === 'uncategorized') return KB_GALLERY_UNCATEGORIZED;
  if (segment === 'category' && parts[2]) return parts[2];
  return KB_GALLERY_ALL;
}

function libraryCategoryToValue(category: KbGalleryCategory): string | null {
  if (category === KB_GALLERY_ALL) return null;
  if (category === KB_GALLERY_FAVORITES) return 'favorites';
  if (category === KB_GALLERY_UNCATEGORIZED) return 'uncategorized';
  return category;
}

function libraryCategoryToHash(category: KbGalleryCategory): string {
  if (category === KB_GALLERY_ALL) return '#/library';
  if (category === KB_GALLERY_FAVORITES) return '#/library/favorites';
  if (category === KB_GALLERY_UNCATEGORIZED) return '#/library/uncategorized';
  return `#/library/category/${encodeURIComponent(category)}`;
}

function withLibraryCategoryQuery(hash: string, category: KbGalleryCategory): string {
  const value = libraryCategoryToValue(category);
  return value ? `${hash}?category=${encodeURIComponent(value)}` : hash;
}

function isBuiltinLibraryCategory(category: KbGalleryCategory): boolean {
  return category === KB_GALLERY_ALL || category === KB_GALLERY_FAVORITES || category === KB_GALLERY_UNCATEGORIZED;
}

function parseRoute(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [pathRaw, queryRaw = ''] = raw.split('?');
  const parts = pathRaw.split('/').filter(Boolean).map(decodeHashPart);
  const params = new URLSearchParams(queryRaw);
  const categoryFromQuery = params.has('category') ? libraryCategoryFromValue(params.get('category')) : null;
  const seg = parts[0] ?? '';
  if (seg === 'library') {
    return {
      mode: 'free',
      viewType: 'list',
      kbId: null,
      folderId: null,
      entryId: null,
      libraryCategory: categoryFromQuery ?? libraryCategoryFromPath(parts),
    };
  }
  if (seg === 'free') {
    const second = parts[1] ?? '';
    if (second && second !== 'favorites' && second !== 'uncategorized' && second !== 'category') {
      const folderId = parts[2] === 'folder' && parts[3] ? parts[3] : null;
      return { mode: 'free', viewType: 'list', kbId: second, folderId, entryId: null, libraryCategory: categoryFromQuery ?? KB_GALLERY_ALL };
    }
    return {
      mode: 'free',
      viewType: 'list',
      kbId: null,
      folderId: null,
      entryId: null,
      libraryCategory: categoryFromQuery ?? libraryCategoryFromPath(parts),
    };
  }
  if (seg === 'kb') {
    const kbId = parts[1] ?? null;
    const folderId = parts[2] === 'folder' && parts[3] ? parts[3] : null;
    return { mode: 'free', viewType: 'list', kbId, folderId, entryId: null, libraryCategory: categoryFromQuery ?? KB_GALLERY_ALL };
  }
  // search 模式：#/search/list | #/search/canvas | #/search/list/{entryId} | #/search/canvas/{entryId}
  const viewType = parts[1] === 'canvas' ? 'canvas' : 'list';
  const entryId = (parts[2] && parts[2] !== 'list' && parts[2] !== 'canvas') ? parts[2] : null;
  return { mode: 'search', viewType, kbId: null, folderId: null, entryId, libraryCategory: categoryFromQuery ?? KB_GALLERY_ALL };
}
function routeToHash(route: Route): string {
  if (route.mode === 'search') {
    const base = `#/search/${route.viewType}`;
    return route.entryId ? `${base}/${route.entryId}` : base;
  }
  if (route.kbId) {
    const base = route.folderId ? `#/kb/${route.kbId}/folder/${route.folderId}` : `#/kb/${route.kbId}`;
    return withLibraryCategoryQuery(base, route.libraryCategory);
  }
  return libraryCategoryToHash(route.libraryCategory);
}

function itemVersionKey(item: { id: string; updatedAt?: number; sort?: number }): string {
  return `${item.id}:${item.updatedAt ?? ''}:${item.sort ?? ''}`;
}

function sameItems<T extends { id: string; updatedAt?: number; sort?: number }>(current: T[], incoming: T[]): boolean {
  if (current.length !== incoming.length) return false;
  return current.every((item, index) => itemVersionKey(item) === itemVersionKey(incoming[index]));
}

function isOlderVersion(existing: { updatedAt?: number }, incoming: { updatedAt?: number }): boolean {
  const existingUpdatedAt = Number(existing.updatedAt ?? 0);
  const incomingUpdatedAt = Number(incoming.updatedAt ?? 0);
  return existingUpdatedAt > 0 && incomingUpdatedAt > 0 && incomingUpdatedAt < existingUpdatedAt;
}

function mergeById<T extends { id: string; updatedAt?: number; sort?: number }>(current: T[], incoming: T[]): T[] {
  if (!incoming.length) return current;
  let changed = false;
  const map = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) {
    const existing = map.get(item.id);
    if (!existing) {
      map.set(item.id, item);
      changed = true;
      continue;
    }
    if (isOlderVersion(existing, item)) continue;
    if (itemVersionKey(existing) !== itemVersionKey(item)) {
      map.set(item.id, item);
      changed = true;
    }
  }
  if (!changed) return current;
  return [...map.values()];
}

function replaceByKb<T extends { id: string; kbId: string; updatedAt?: number; sort?: number }>(current: T[], kbId: string, incoming: T[]): T[] {
  const currentInKb = current.filter((item) => item.kbId === kbId);
  if (sameItems(currentInKb, incoming)) return current;
  return [...current.filter((item) => item.kbId !== kbId), ...incoming];
}

function aiJobResultKey(job: AiKnowledgeBaseJob): string {
  if (!job.result) return '';
  return [
    job.result.kb.id,
    job.result.kb.updatedAt,
    job.result.folders.length,
    job.result.entries.length,
    job.result.folders.map((folder) => `${folder.id}:${folder.updatedAt}`).join(','),
    job.result.entries.map((entry) => `${entry.id}:${entry.updatedAt}`).join(','),
  ].join('|');
}

function aiJobListKey(jobs: AiKnowledgeBaseJob[]): string {
  return jobs.map((job) => [
    job.id,
    job.kind,
    job.status,
    job.agentPhase ?? '',
    job.updatedAt,
    job.logs.length,
    job.modelOutput,
    job.error ?? '',
    job.resumable ? 1 : 0,
    job.promptTokens,
    job.completionTokens,
    job.totalTokens,
    job.analysis ? `${job.analysis.overview}|${job.analysis.suggestions.length}` : '',
    job.rollback ? `${job.rollback.appliedAt}:${job.rollback.revertedAt ?? ''}` : '',
    aiJobResultKey(job),
  ].join('\u001f')).join('\u001e');
}

function sameAiJobs(current: AiKnowledgeBaseJob[], incoming: AiKnowledgeBaseJob[]): boolean {
  return current.length === incoming.length && aiJobListKey(current) === aiJobListKey(incoming);
}

function collectFolderSubtreeIds(folders: Folder[], rootIds: Set<string>): Set<string> {
  const ids = new Set(rootIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) {
        ids.add(folder.id);
        changed = true;
      }
    }
  }
  return ids;
}

function pruneAiJobResultItems(job: AiKnowledgeBaseJob, folderIds: Set<string>, entryIds: Set<string>): AiKnowledgeBaseJob {
  if (!job.result || (!folderIds.size && !entryIds.size)) return job;
  const resultFolderIds = collectFolderSubtreeIds(job.result.folders, folderIds);
  const folders = job.result.folders.filter((folder) => !resultFolderIds.has(folder.id));
  const entries = job.result.entries.filter((entry) => (
    !entryIds.has(entry.id) && !(entry.folderId && resultFolderIds.has(entry.folderId))
  ));
  if (folders.length === job.result.folders.length && entries.length === job.result.entries.length) return job;
  return { ...job, result: { ...job.result, folders, entries } };
}

function pruneAiJobsResultItems(jobs: AiKnowledgeBaseJob[], folderIds: Set<string>, entryIds: Set<string>): AiKnowledgeBaseJob[] {
  let changed = false;
  const next = jobs.map((job) => {
    const pruned = pruneAiJobResultItems(job, folderIds, entryIds);
    if (pruned !== job) changed = true;
    return pruned;
  });
  return changed ? next : jobs;
}

function isKeyPointShortcut(event: KeyboardEvent): boolean {
  if (!event.metaKey && !event.ctrlKey) return false;
  return event.code === 'Slash' || event.code === 'NumpadDivide' || event.key === '/' || event.key === '?';
}

function isScopePickerQuery(value: string): boolean {
  return value.startsWith('.') || value.startsWith('。');
}

export default function App() {
  const initialRoute = parseRoute();
  const apiBaseLabel = getApiBase();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [kbCategories, setKbCategories] = useState<KbCategory[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [aiJobs, setAiJobs] = useState<AiKnowledgeBaseJob[]>([]);
  const [aiTaskPanelOpen, setAiTaskPanelOpen] = useState(false);
  // 鉴权状态:检索/浏览公开,知识库管理需登录。默认开放态,首屏后再由 /auth/status 校正。
  const [auth, setAuth] = useState<AuthStatus>({ authRequired: false, authenticated: true });

  const [mode, setMode] = useState<AppMode>(initialRoute.mode);
  const [viewType, setViewType] = useState<'list' | 'canvas'>(initialRoute.viewType);
  const [query, setQuery] = useState('');
  const [searchKb, setSearchKb] = useState<string | null>(null);   // 检索作用域:null=全部知识库
  const [kpOpen, setKpOpen] = useState(false);   // 关键点(标签)面板是否展开
  const [sel, setSel] = useState(0);
  const [sugSel, setSugSel] = useState(-1);   // 联想下拉的键盘选中项（-1 = 无）
  const [theme, setThemeState] = useState<ThemeKey>('mono');
  const [doubleCommandEnabled, setDoubleCommandEnabled] = useState(() => localStorage.getItem('ik_double_command_enabled') !== '0');

  // 自由模式导航：freeKb 当前进入的知识库；freeFolder 当前浏览的文件夹（null = 知识库根）
  // 优先从 URL 路由恢复（刷新/分享可还原），URL 无值时回退 localStorage（记忆上次位置）
  const [freeKb, setFreeKb] = useState<string | null>(() => initialRoute.kbId ?? localStorage.getItem('ik_free_kb') ?? null);
  const [freeFolder, setFreeFolder] = useState<string | null>(() => initialRoute.folderId ?? localStorage.getItem('ik_free_folder') ?? null);
  const [libraryCategory, setLibraryCategory] = useState<KbGalleryCategory>(() => initialRoute.libraryCategory);

  const [openId, setOpenId] = useState<string | null>(() => initialRoute.entryId ?? null);
  const [fullEntry, setFullEntry] = useState<Entry | null>(null);
  const [entryLoadingId, setEntryLoadingId] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const mergedJobIdsRef = useRef<Set<string>>(new Set());
  const notifiedJobIdsRef = useRef<Set<string>>(new Set());
  const notifiedJobEventsRef = useRef<Set<string>>(new Set());
  const deletedKbIdsRef = useRef<Set<string>>(new Set());
  const deletedFolderIdsRef = useRef<Set<string>>(new Set());
  const deletedEntryIdsRef = useRef<Set<string>>(new Set());
  const kbCategoryMoveVersionRef = useRef<Map<string, number>>(new Map());
  const kbFavoriteVersionRef = useRef<Map<string, number>>(new Map());
  const lastCommandTapRef = useRef(0);
  // 浏览器前进/后退触发的一次性标记:本轮 URL 同步用 replaceState(避免把回退后的地址又压成新历史)
  // 初始为 true,让首次挂载的 URL 规整也走 replace(不污染历史)
  const skipPushRef = useRef(true);

  // 路由同步:状态变化 → 写 URL(用户操作走 pushState,可前进后退;回退触发的那次走 replaceState)
  useEffect(() => {
    const target = routeToHash({ mode, viewType, kbId: freeKb, folderId: freeFolder, entryId: mode === 'search' ? openId : null, libraryCategory });
    const skip = skipPushRef.current;
    skipPushRef.current = false;
    if (window.location.hash !== target) {
      if (skip) window.history.replaceState(null, '', target);
      else window.history.pushState(null, '', target);
    }
  }, [mode, viewType, freeKb, freeFolder, openId, libraryCategory]);
  useEffect(() => {
    const onPop = (): void => {
      const next = parseRoute();
      skipPushRef.current = true;   // 本次由地址栏驱动,后续写 URL 用 replace 避免循环压栈
      setMode(next.mode);
      setViewType(next.viewType);
      setFreeKb(next.kbId);
      setFreeFolder(next.folderId);
      setLibraryCategory(next.libraryCategory);
      if (next.mode === 'search') setOpenId(next.entryId);
    };
    window.addEventListener('hashchange', onPop);
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('hashchange', onPop);
      window.removeEventListener('popstate', onPop);
    };
  }, []);

  // 加载数据 + 恢复主题
  useEffect(() => {
    let cancelled = false;
    const saved = localStorage.getItem('ik_theme');
    if (saved && (saved in THEMES)) setThemeState(saved as ThemeKey);
    fetchBootstrap()
      .then((data) => {
        if (cancelled) return;
        setAuth(data.auth);
        setEntries(data.entries);
        setKbs(data.kbs);
        setFolders(data.folders);
        setKbCategories(data.kbCategories);
      })
      .catch(() => {
        if (cancelled) return;
        setEntries([]);
        setKbs([]);
        setFolders([]);
        setKbCategories([]);
      })
      .finally(() => {
        if (cancelled) return;
        setLoaded(true);
        setTimeout(() => inputRef.current?.focus(), 60);
      });
    return () => { cancelled = true; };
  }, []);

  const applyCompletedJobs = useCallback((jobs: AiKnowledgeBaseJob[]): void => {
    const materialized = jobs
      .filter((job) => job.result && !deletedKbIdsRef.current.has(job.result.kb.id))
      .map((job) => {
        const result = job.result!;
        return {
          job,
          result: {
            ...result,
            folders: result.folders.filter((folder) => !deletedFolderIdsRef.current.has(folder.id)),
            entries: result.entries.filter((entry) => (
              !deletedEntryIdsRef.current.has(entry.id)
              && !(entry.folderId && deletedFolderIdsRef.current.has(entry.folderId))
            )),
          },
        };
      });
    if (materialized.length) {
      setKbs((prev) => mergeById(prev, materialized.map((item) => item.result.kb)));
      const exact = materialized.filter((item) => item.job.kind === 'agent-edit' && (item.job.agentPhase === 'applied' || item.job.agentPhase === 'reverted'));
      const merging = materialized.filter((item) => !(item.job.kind === 'agent-edit' && (item.job.agentPhase === 'applied' || item.job.agentPhase === 'reverted')));
      if (merging.length) {
        setFolders((prev) => mergeById(prev, merging.flatMap((item) => item.result.folders)));
        setEntries((prev) => mergeById(prev, merging.flatMap((item) => item.result.entries)));
      }
      if (exact.length) {
        setFolders((prev) => exact.reduce((next, item) => replaceByKb(next, item.result.kb.id, item.result.folders), prev));
        setEntries((prev) => exact.reduce((next, item) => replaceByKb(next, item.result.kb.id, item.result.entries), prev));
      }
    }

    const completed = jobs.filter((job) => (
      job.status === 'succeeded'
      && job.result
      && !deletedKbIdsRef.current.has(job.result.kb.id)
      && !mergedJobIdsRef.current.has(job.id)
    ));
    if (completed.length) {
      for (const job of completed) {
        mergedJobIdsRef.current.add(job.id);
        if (job.kind === 'agent-edit' && job.agentPhase) continue;
        if (!notifiedJobIdsRef.current.has(job.id)) {
          notifiedJobIdsRef.current.add(job.id);
          toast(job.kind === 'folder-init'
            ? `AI 已初始化「${job.result!.kb.name}」目录`
            : job.kind === 'folder-entries'
              ? `AI 已按目录补全「${job.result!.kb.name}」知识点`
              : job.kind === 'folder-full'
                ? `AI 已生成「${job.result!.kb.name}」目录和知识点`
                : job.kind === 'agent-edit'
                  ? `AI 已调整「${job.result!.kb.name}」`
                  : `AI 已新建「${job.result!.kb.name}」`, 'success');
        }
      }
    }

    const draftJobs = jobs.filter((job) => job.kind === 'agent-edit' && job.status === 'succeeded' && job.agentPhase === 'draft');
    for (const job of draftJobs) {
      const key = `${job.id}:draft`;
      if (!notifiedJobEventsRef.current.has(key)) {
        notifiedJobEventsRef.current.add(key);
        toast('AI 已生成调整计划，请确认后应用', 'success');
      }
    }

    const appliedJobs = jobs.filter((job) => job.kind === 'agent-edit' && job.status === 'succeeded' && job.agentPhase === 'applied');
    for (const job of appliedJobs) {
      const key = `${job.id}:applied`;
      if (!notifiedJobEventsRef.current.has(key)) {
        notifiedJobEventsRef.current.add(key);
        toast('AI 调整已应用，可在控制台撤销', 'success');
      }
    }

    for (const job of jobs) {
      if (job.status === 'failed' && !notifiedJobIdsRef.current.has(job.id)) {
        notifiedJobIdsRef.current.add(job.id);
        toast(`${job.kind === 'folder-init'
          ? 'AI 初始化目录失败'
          : job.kind === 'folder-entries'
            ? 'AI 按目录生成知识点失败'
            : job.kind === 'folder-full'
              ? 'AI 一键生成目录和知识点失败'
              : job.kind === 'agent-edit'
                ? 'AI 调整知识库失败'
                : 'AI 建库失败'}：${job.error || job.domain}`, 'error');
      }
    }
  }, []);

  const refreshAiJobs = useCallback(async (): Promise<AiKnowledgeBaseJob[]> => {
    const jobs = await fetchAiJobs();
    setAiJobs((prev) => sameAiJobs(prev, jobs) ? prev : jobs);
    applyCompletedJobs(jobs);
    return jobs;
  }, [applyCompletedJobs]);

  useEffect(() => {
    // 管理类接口需登录:未登录时不轮询 AI 任务,避免 401 刷屏。
    if (!loaded) return;
    if (auth.authRequired && !auth.authenticated) return;
    let stopped = false;
    let timer: number | null = null;
    const schedule = (delay: number): void => {
      if (stopped) return;
      timer = window.setTimeout(tick, delay);
    };
    const tick = (): void => {
      refreshAiJobs().then((jobs) => {
        const active = jobs.some((job) => job.status === 'queued' || job.status === 'running');
        schedule(active ? 1600 : aiTaskPanelOpen ? 5000 : 10000);
      }).catch(() => {
        if (!stopped) {
          // 后端未启动时不打扰用户，主数据加载会给出状态。
          schedule(6000);
        }
      });
    };
    tick();
    return () => {
      stopped = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [refreshAiJobs, auth.authRequired, auth.authenticated, aiTaskPanelOpen, loaded]);

  useEffect(() => {
    if (!loaded) return;
    if (freeKb && !kbs.some((kb) => kb.id === freeKb)) {
      setFreeKb(null);
      setFreeFolder(null);
      return;
    }
    if (freeFolder && !folders.some((folder) => folder.id === freeFolder && folder.kbId === freeKb)) {
      setFreeFolder(null);
    }
  }, [folders, freeFolder, freeKb, kbs, loaded]);

  useEffect(() => {
    if (!loaded) return;
    if (!isBuiltinLibraryCategory(libraryCategory) && !kbCategories.some((category) => category.id === libraryCategory)) {
      setLibraryCategory(KB_GALLERY_ALL);
    }
  }, [kbCategories, libraryCategory, loaded]);

  useEffect(() => {
    if (freeKb) localStorage.setItem('ik_free_kb', freeKb);
    else localStorage.removeItem('ik_free_kb');
  }, [freeKb]);

  useEffect(() => {
    if (freeFolder) localStorage.setItem('ik_free_folder', freeFolder);
    else localStorage.removeItem('ik_free_folder');
  }, [freeFolder]);

  const setTheme = (k: ThemeKey) => {
    setThemeState(k);
    try { localStorage.setItem('ik_theme', k); } catch { /* ignore */ }
  };

  const setDoubleCommandShortcut = useCallback((enabled: boolean): void => {
    setDoubleCommandEnabled(enabled);
    try { localStorage.setItem('ik_double_command_enabled', enabled ? '1' : '0'); } catch { /* ignore */ }
  }, []);

  const t = THEMES[theme];
  useEffect(() => {
    const vars = themeVars(t) as unknown as Record<string, string>;
    for (const [key, value] of Object.entries(vars)) {
      document.documentElement.style.setProperty(key, value);
    }
    document.body.style.background = 'var(--app-bg, var(--bg))';
    document.body.style.color = t.fg;
    document.body.style.fontFamily = t.font;
  }, [t]);

  // 防抖：输入即时更新，过滤/建议在空闲时计算（避免逐字全量重算）
  const deferredQuery = useDeferredValue(query);
  // 检索作用域:限定到某个知识库时,先把候选集缩到该库
  const scopedEntries = useMemo(
    () => (searchKb ? entries.filter((e) => e.kbId === searchKb) : entries),
    [entries, searchKb]
  );
  // "." / "。" 开头是正在选知识库,不作为检索词
  const filterQuery = isScopePickerQuery(deferredQuery) ? '' : deferredQuery;
  const results = useMemo(
    () => (mode === 'search' ? filterEntries(scopedEntries, filterQuery) : []),
    [scopedEntries, filterQuery, mode]
  );
  const suggestions = useMemo(
    () => (mode === 'search' ? suggestQueries(scopedEntries, filterQuery) : []),
    [scopedEntries, filterQuery, mode]
  );

  const closeAll = useCallback(() => { setOpenId(null); setAiOpen(false); setFormOpen(false); }, []);
  const clearSearch = useCallback(() => {
    setQuery('');
    setSel(0);
    setSugSel(-1);
    setOpenId(null);
    setAiOpen(false);
    setTimeout(() => inputRef.current?.focus(), 20);
  }, []);
  const isSearchList = mode === 'search' && viewType === 'list';

  useEffect(() => {
    if (!isSearchList) return;
    if (results.length === 0) {
      if (openId) setOpenId(null);
      return;
    }
    const currentVisible = openId ? results.some((entry) => entry.id === openId) : false;
    if (currentVisible) return;
    const clamped = Math.min(sel, results.length - 1);
    setOpenId(results[Math.max(0, clamped)].id);
  }, [isSearchList, openId, results, sel]);

  // ⌘K / Ctrl+K / 双击 Command 呼出搜索：切到检索模式 + 清空 + 聚焦输入框（保留当前详情，避免重复加载）
  const summonSearch = useCallback(() => {
    setMode('search');
    setQuery('');
    setSel(0);
    setSugSel(-1);
    setAiOpen(false);
    setFormOpen(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const summonKeyPoints = useCallback(() => {
    setMode('search');
    setQuery((current) => (isScopePickerQuery(current) ? '' : current));
    setSel(0);
    setSugSel(-1);
    setOpenId(null);
    setAiOpen(false);
    setFormOpen(false);
    setKpOpen((open) => (mode === 'search' ? !open : true));
  }, [mode]);

  // 应用一条联想：有 entryId 直接打开详情，否则作为查询填入
  const applySuggestion = useCallback((s: SearchSuggestion) => {
    setQuery(s.value);
    setSugSel(-1);
    if (s.entryId) setOpenId(s.entryId);
    else { setOpenId(null); setSel(0); }
  }, []);

  // 键盘交互：⌘K 呼出搜索、联想下拉的 ↑↓ 选择 / ↵ 应用、esc 关闭
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      // 快速按两次 Command 进入搜索框。只响应单独 Command，避免影响 ⌘K / ⌘/ 等组合键。
      if (doubleCommandEnabled && e.key === 'Meta' && !e.repeat && !e.altKey && !e.ctrlKey && !e.shiftKey) {
        const now = Date.now();
        if (now - lastCommandTapRef.current <= 450) {
          e.preventDefault();
          lastCommandTapRef.current = 0;
          summonSearch();
          return;
        }
        lastCommandTapRef.current = now;
      }
      // 全局：⌘K / Ctrl+K 呼出搜索（任意模式、任意焦点）
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        summonSearch();
        return;
      }
      // ⌘/ / Ctrl+/ 呼出关键点(标签)面板（任意模式可用）
      if (isKeyPointShortcut(e)) {
        e.preventDefault();
        e.stopPropagation();
        summonKeyPoints();
        return;
      }
      const modalOpen = Boolean(openId && !isSearchList);
      if (modalOpen || aiOpen || formOpen) { if (e.key === 'Escape') closeAll(); return; }
      if (mode !== 'search') return;
      if (viewType === 'canvas') { if (e.key === 'Escape' && query) { setQuery(''); setSel(0); } return; }

      // 列表视图:↑↓ 在结果间移动并加载完整详情,↵ 打开,esc 清空
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (results.length === 0) {
          setSel(0);
          setOpenId(null);
          return;
        }
        const next = Math.min(Math.min(sel, results.length - 1) + 1, results.length - 1);
        setSel(next);
        setOpenId(results[next]?.id ?? null);
      }
      else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (results.length === 0) {
          setSel(0);
          setOpenId(null);
          return;
        }
        const next = Math.max(0, Math.min(sel, results.length - 1) - 1);
        setSel(next);
        setOpenId(results[next]?.id ?? null);
      }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const clamped = Math.min(sel, Math.max(0, results.length - 1));
        if (results[clamped]) setOpenId(results[clamped].id);
        else if (query.trim()) setAiOpen(true);
      } else if (e.key === 'Escape') {
        if (query) { setQuery(''); setSel(0); setSugSel(-1); }
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [openId, aiOpen, formOpen, isSearchList, mode, viewType, query, sel, results, suggestions, sugSel, doubleCommandEnabled, closeAll, summonSearch, summonKeyPoints, applySuggestion]);

  // 知识点的增删改：同步到共享 entries，检索/画布即时反映
  const handleCreate = useCallback(async (input: ApiEntryInput): Promise<Entry> => {
    const entry = await createEntry(input);
    deletedEntryIdsRef.current.delete(entry.id);
    setEntries((prev) => [...prev, entry]);
    return entry;
  }, []);
  const handleUpdate = useCallback(async (id: string, input: ApiEntryInput): Promise<Entry> => {
    const entry = await updateEntry(id, input);
    deletedEntryIdsRef.current.delete(entry.id);
    setEntries((prev) => prev.map((e) => (e.id === id ? entry : e)));
    setOpenId((cur) => (cur === id ? null : cur));
    return entry;
  }, []);
  const handleDelete = useCallback(async (id: string) => {
    await deleteEntry(id);
    const deletedEntryIds = new Set([id]);
    deletedEntryIdsRef.current.add(id);
    setEntries((prev) => prev.filter((e) => e.id !== id));
    setAiJobs((prev) => pruneAiJobsResultItems(prev, new Set(), deletedEntryIds));
    setOpenId((cur) => (cur === id ? null : cur));
  }, []);
  const handleReorder = useCallback(async (ids: string[]) => {
    const next = await reorderEntries(ids);
    setEntries(next);
  }, []);
  const handleImported = useCallback((nextEntries: Entry[], nextKbs: KnowledgeBase[], nextFolders: Folder[], nextCategories?: KbCategory[]) => {
    for (const kb of nextKbs) deletedKbIdsRef.current.delete(kb.id);
    for (const folder of nextFolders) deletedFolderIdsRef.current.delete(folder.id);
    for (const entry of nextEntries) deletedEntryIdsRef.current.delete(entry.id);
    setEntries(nextEntries);
    setKbs(nextKbs);
    setFolders(nextFolders);
    if (nextCategories) setKbCategories(nextCategories);
  }, []);
  const handleGeneratedEntry = useCallback((entry: Entry) => {
    deletedEntryIdsRef.current.delete(entry.id);
    setEntries((prev) => [...prev.filter((item) => item.id !== entry.id), entry]);
  }, []);
  const handleStartKnowledgeBaseJob = useCallback(async (domain: string): Promise<void> => {
    const nextDomain = domain.trim();
    if (!nextDomain) {
      toast('请输入要生成的知识库领域', 'info');
      return;
    }
    const job = await startGenerateKnowledgeBaseJob({ domain: nextDomain });
    setAiJobs((prev) => mergeById(prev, [job]).sort((a, b) => b.createdAt - a.createdAt));
    setAiTaskPanelOpen(true);
    toast(`「${nextDomain}」已开始后台生成`, 'success');
  }, []);

  const handleStartFolderInitJob = useCallback(async (input: { kbId: string; parentId?: string | null; domain?: string }): Promise<void> => {
    const job = await startInitKnowledgeBaseFoldersJob(input);
    setAiJobs((prev) => mergeById(prev, [job]).sort((a, b) => b.createdAt - a.createdAt));
    setAiTaskPanelOpen(true);
    toast(`「${input.domain || job.kbName || job.domain}」目录已在后台初始化`, 'success');
  }, []);

  const handleStartFolderEntriesJob = useCallback(async (input: { kbId: string; parentId?: string | null; domain?: string }): Promise<void> => {
    const job = await startGenerateKnowledgePointsFromFoldersJob(input);
    setAiJobs((prev) => mergeById(prev, [job]).sort((a, b) => b.createdAt - a.createdAt));
    setAiTaskPanelOpen(true);
    toast(`「${input.domain || job.kbName || job.domain}」已开始按目录生成知识点`, 'success');
  }, []);

  const handleStartFolderFullJob = useCallback(async (input: { kbId: string; parentId?: string | null; domain?: string }): Promise<void> => {
    const job = await startGenerateFoldersAndKnowledgePointsJob(input);
    setAiJobs((prev) => mergeById(prev, [job]).sort((a, b) => b.createdAt - a.createdAt));
    setAiTaskPanelOpen(true);
    toast(`「${input.domain || job.kbName || job.domain}」已开始一键生成目录和知识点`, 'success');
  }, []);

  const handleStartAnalyzeJob = useCallback(async (kbId: string): Promise<void> => {
    const job = await startAnalyzeJob(kbId);
    setAiJobs((prev) => mergeById(prev, [job]).sort((a, b) => b.createdAt - a.createdAt));
    setAiTaskPanelOpen(true);
    toast('已开始分析当前知识库', 'success');
  }, []);

  const handleStartAnalyzeEntryJob = useCallback(async (entryId: string): Promise<void> => {
    const job = await startAnalyzeEntryJob(entryId);
    setAiJobs((prev) => mergeById(prev, [job]).sort((a, b) => b.createdAt - a.createdAt));
    setAiTaskPanelOpen(true);
    toast('已开始分析当前知识点', 'success');
  }, []);

  const handleStartAgentEditJob = useCallback(async (input: {
    kbId: string;
    instruction: string;
    folderId?: string | null;
    entryId?: string;
  }): Promise<void> => {
    const job = await startAgentEditJob(input);
    setAiJobs((prev) => mergeById(prev, [job]).sort((a, b) => b.createdAt - a.createdAt));
    setAiTaskPanelOpen(true);
    toast('AI 正在生成调整计划', 'success');
  }, []);

  const handleCancelAiJob = useCallback(async (id: string): Promise<void> => {
    const job = await cancelAiJob(id);
    setAiJobs((prev) => mergeById(prev, [job]).sort((a, b) => b.createdAt - a.createdAt));
    toast('已取消 AI 任务', 'info');
  }, []);

  const handleRetryAiJob = useCallback(async (id: string): Promise<void> => {
    const job = await retryAiJob(id);
    setAiJobs((prev) => mergeById(prev, [job]).sort((a, b) => b.createdAt - a.createdAt));
    setAiTaskPanelOpen(true);
    toast(job.resumable ? `已继续生成「${job.domain}」` : `已重新提交「${job.domain}」`, 'success');
  }, []);

  const handleApplyAiJobDraft = useCallback(async (id: string): Promise<void> => {
    const job = await applyAiJobDraft(id);
    setAiJobs((prev) => mergeById(prev, [job]).sort((a, b) => b.createdAt - a.createdAt));
    applyCompletedJobs([job]);
    setAiTaskPanelOpen(true);
    toast('已确认，AI 将开始应用调整', 'success');
  }, [applyCompletedJobs]);

  const handleRevertAiJobApply = useCallback(async (id: string): Promise<void> => {
    const job = await revertAiJobApply(id);
    setAiJobs((prev) => mergeById(prev, [job]).sort((a, b) => b.createdAt - a.createdAt));
    applyCompletedJobs([job]);
    if (job.status === 'failed') toast(`撤销失败：${job.error ?? '请稍后重试'}`, 'error');
    else toast('已撤销本次 AI 调整', 'success');
  }, [applyCompletedJobs]);

  const handleClearAiJobHistory = useCallback(async (): Promise<void> => {
    const jobs = await clearAiJobHistory();
    setAiJobs(jobs);
    toast('已清除 AI 任务历史', 'success');
  }, []);

  const handleClearAiJob = useCallback(async (id: string): Promise<void> => {
    const jobs = await clearAiJob(id);
    setAiJobs(jobs);
    toast('已清理 AI 任务记录', 'success');
  }, []);

  const handleOpenAiJobResult = useCallback((job: AiKnowledgeBaseJob): void => {
    if (!job.result) return;
    applyCompletedJobs([job]);
    setMode('free');
    setFreeKb(job.result.kb.id);
    setFreeFolder(job.result.entries[0]?.folderId ?? job.result.folders[0]?.id ?? job.parentId ?? null);
    setAiTaskPanelOpen(false);
  }, [applyCompletedJobs]);

  // 知识库回调
  const handleCreateKb = useCallback(async (name: string, categoryId?: string | null): Promise<KnowledgeBase> => {
    const kb = await createKb(name, categoryId);
    deletedKbIdsRef.current.delete(kb.id);
    setKbs((prev) => [...prev, kb]);
    return kb;
  }, []);
  const handleRenameKb = useCallback(async (id: string, name: string): Promise<void> => {
    const kb = await renameKb(id, name);
    setKbs((prev) => prev.map((k) => (k.id === id ? kb : k)));
    // entry.cat 是知识库名派生，需同步刷新本地缓存
    setEntries((prev) => prev.map((e) => (e.kbId === id ? { ...e, cat: kb.name } : e)));
  }, []);
  const handleDeleteKb = useCallback(async (id: string): Promise<void> => {
    const { folderIds, entryIds } = await deleteKb(id);
    const deletedFolderIds = new Set(folderIds);
    const deletedEntryIds = new Set(entryIds);
    deletedKbIdsRef.current.add(id);
    for (const folderId of deletedFolderIds) deletedFolderIdsRef.current.add(folderId);
    for (const entryId of deletedEntryIds) deletedEntryIdsRef.current.add(entryId);
    setKbs((prev) => prev.filter((kb) => kb.id !== id));
    setFolders((prev) => prev.filter((folder) => folder.kbId !== id && !deletedFolderIds.has(folder.id)));
    setEntries((prev) => prev.filter((entry) => entry.kbId !== id && !deletedEntryIds.has(entry.id)));
    setAiJobs((prev) => prev.map((job) => job.result?.kb.id === id ? { ...job, result: undefined, resumable: false } : job));
    setOpenId(null);
    setSearchKb((cur) => (cur === id ? null : cur));
    setFreeKb((cur) => (cur === id ? null : cur));
    setFreeFolder(null);
  }, []);

  const handleDeleteKbTag = useCallback(async (kbId: string, tag: string): Promise<void> => {
    const result = await deleteKbTag(kbId, tag);
    const updatedById = new Map(result.entries.map((entry) => [entry.id, entry]));
    setEntries((prev) => prev.map((entry) => updatedById.get(entry.id) ?? entry));
  }, []);

  const handleCreateKbCategory = useCallback(async (input: { name: string; parentId?: string | null }): Promise<KbCategory> => {
    const category = await createKbCategory(input);
    setKbCategories((prev) => [...prev, category]);
    return category;
  }, []);

  const handleRenameKbCategory = useCallback(async (id: string, name: string): Promise<void> => {
    const category = await renameKbCategory(id, name);
    setKbCategories((prev) => prev.map((item) => (item.id === id ? category : item)));
  }, []);

  const handleDeleteKbCategory = useCallback(async (id: string): Promise<void> => {
    const next = await deleteKbCategory(id);
    setKbCategories(next.categories);
    setKbs(next.kbs);
  }, []);

  const handleMoveKbToCategory = useCallback(async (id: string, categoryId?: string | null): Promise<void> => {
    const normalizedCategoryId = categoryId ?? null;
    const previous = kbs.find((item) => item.id === id) ?? null;
    const version = (kbCategoryMoveVersionRef.current.get(id) ?? 0) + 1;
    kbCategoryMoveVersionRef.current.set(id, version);
    if (previous) {
      setKbs((prev) => prev.map((item) => (
        item.id === id ? { ...item, categoryId: normalizedCategoryId, updatedAt: Date.now() } : item
      )));
    }
    try {
      const kb = await moveKbToCategory(id, normalizedCategoryId);
      if (kbCategoryMoveVersionRef.current.get(id) === version) {
        setKbs((prev) => prev.map((item) => (item.id === id ? kb : item)));
      }
    } catch (err) {
      if (previous && kbCategoryMoveVersionRef.current.get(id) === version) {
        setKbs((prev) => prev.map((item) => (item.id === id ? previous : item)));
      }
      throw err;
    }
  }, [kbs]);

  const handleToggleKbFavorite = useCallback(async (id: string, favorite: boolean): Promise<void> => {
    const previous = kbs.find((item) => item.id === id) ?? null;
    const version = (kbFavoriteVersionRef.current.get(id) ?? 0) + 1;
    kbFavoriteVersionRef.current.set(id, version);
    if (previous) {
      setKbs((prev) => prev.map((item) => (
        item.id === id ? { ...item, favorite, updatedAt: Date.now() } : item
      )));
    }
    try {
      const kb = await updateKbFavorite(id, favorite);
      if (kbFavoriteVersionRef.current.get(id) === version) {
        setKbs((prev) => prev.map((item) => (item.id === id ? kb : item)));
      }
    } catch (err) {
      if (previous && kbFavoriteVersionRef.current.get(id) === version) {
        setKbs((prev) => prev.map((item) => (item.id === id ? previous : item)));
      }
      throw err;
    }
  }, [kbs]);

  // 文件夹回调
  const handleCreateFolder = useCallback(async (input: { kbId: string; parentId?: string | null; name: string }): Promise<Folder> => {
    const folder = await createFolder(input);
    deletedFolderIdsRef.current.delete(folder.id);
    setFolders((prev) => [...prev, folder]);
    return folder;
  }, []);
  const handleRenameFolder = useCallback(async (id: string, name: string): Promise<void> => {
    const folder = await renameFolder(id, name);
    setFolders((prev) => prev.map((f) => (f.id === id ? folder : f)));
  }, []);
  const handleDeleteFolder = useCallback(async (id: string): Promise<void> => {
    const { folderIds, entryIds } = await deleteFolder(id);
    const deletedFolderIds = new Set(folderIds);
    const deletedEntryIds = new Set(entryIds);
    for (const folderId of deletedFolderIds) deletedFolderIdsRef.current.add(folderId);
    for (const entryId of deletedEntryIds) deletedEntryIdsRef.current.add(entryId);
    setFolders((prev) => prev.filter((folder) => !deletedFolderIds.has(folder.id)));
    setEntries((prev) => prev.filter((entry) => !deletedEntryIds.has(entry.id)));
    setAiJobs((prev) => pruneAiJobsResultItems(prev, deletedFolderIds, deletedEntryIds));
    setOpenId((cur) => (cur && deletedEntryIds.has(cur) ? null : cur));
    setFreeFolder((cur) => (cur && deletedFolderIds.has(cur) ? null : cur));
  }, []);
  const handleMoveFolder = useCallback(async (id: string, opts: { parentId?: string | null; kbId?: string }): Promise<void> => {
    const next = await moveFolder(id, opts);
    setFolders(next);
  }, []);
  const handleReorderFolders = useCallback(async (ids: string[]): Promise<void> => {
    const next = await reorderFolders(ids);
    setFolders(next);
  }, []);

  // openId 变化时按需获取完整 entry（列表只有摘要，详情需要 doc/intro/nodes）
  useEffect(() => {
    if (!openId) { setFullEntry(null); setEntryLoadingId(null); return; }
    let cancelled = false;
    setEntryLoadingId(openId);
    fetchEntry(openId)
      .then((e) => { if (!cancelled) setFullEntry(e); })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setEntryLoadingId((current) => (current === openId ? null : current));
      });
    return () => { cancelled = true; };
  }, [openId]);

  // 先用列表轻量数据（标题/摘要/标签立即可见），fullEntry 到了替换完整 doc
  const openEntry = openId ? (fullEntry && fullEntry.id === openId ? fullEntry : entries.find((e) => e.id === openId) ?? null) : null;
  // 搜索/画布模式：openEntry 到了以后用完整 doc；列表无选中时回退到当前高亮行
  const selectedSearchEntry = openId
    ? (openEntry ?? results.find((e) => e.id === openId) ?? null)
    : isSearchList
      ? (results[Math.min(sel, Math.max(0, results.length - 1))] ?? null)
      : null;
  const selectedSearchId = selectedSearchEntry?.id ?? openId ?? null;
  const selectedSearchLoading = Boolean(openId && entryLoadingId === openId && selectedSearchId === openId);
  // 搜索列表/画布模式都不弹框（画布有自己的详情面板）
  const modalEntry = (isSearchList || viewType === 'canvas') ? null : openEntry;

  const handleTopModeChange = useCallback((nextMode: AppMode) => {
    setOpenId(null);
    if (nextMode === 'free' && mode === 'free' && freeKb) {
      setFreeKb(null);
      setFreeFolder(null);
      setMode('free');
      return;
    }
    setMode(nextMode);
    if (nextMode === 'search') setTimeout(() => inputRef.current?.focus(), 40);
  }, [freeKb, mode]);

  const handleLogout = useCallback(async (): Promise<void> => {
    await logout().catch(() => {});
    setAuth((prev) => ({ authRequired: prev.authRequired, authenticated: false }));
    setAiJobs([]);
  }, []);

  // 检索框上移到顶栏「知识检索」后面;输入 "/" 选择知识库限定范围
  const searchField = mode === 'search' ? (
    <SearchBox
      query={query}
      onQuery={(v) => { setQuery(v); setSel(0); setOpenId(null); setSugSel(-1); }}
      onClear={clearSearch}
      kbs={kbs}
      categories={kbCategories}
      searchKb={searchKb}
      onScopeKb={(id) => { setSearchKb(id); setSel(0); setOpenId(null); setSugSel(-1); }}
      inputRef={inputRef}
      kpEntries={scopedEntries}
      kpOpen={kpOpen}
      setKpOpen={setKpOpen}
      onPickTag={(tag) => { setQuery(tag); setSel(0); setOpenId(null); setSugSel(-1); setKpOpen(false); }}
      viewType={viewType}
      onViewType={(v) => { setViewType(v); setOpenId(null); }}
      doubleCommandEnabled={doubleCommandEnabled}
    />
  ) : undefined;

  // 列表/画布切换已融合进搜索框,顶栏不再单列工具区
  const searchTools = undefined;

  return (
    <div className={`ik-theme-${theme}`} style={{ ...themeVars(t), height: '100vh', overflow: 'hidden', background: 'var(--app-bg, var(--bg))', color: 'var(--fg)', fontFamily: 'var(--font)', WebkitFontSmoothing: 'antialiased' }}>
      <div style={{ width: '100%', height: '100%', maxWidth: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <TopBar mode={mode} setMode={handleTopModeChange} theme={theme} setTheme={setTheme} searchSlot={searchField} searchTools={searchTools} trailing={
          <>
            <DesktopUpdateButton />
            <ShortcutMenu doubleCommandEnabled={doubleCommandEnabled} onDoubleCommandEnabled={setDoubleCommandShortcut} />
            {auth.authRequired && auth.authenticated && mode === 'free' && (
              <button type="button" className="ik-btn ik-btn-secondary ik-btn-size-sm ik-topbar-logout" onClick={handleLogout}>
                <span className="ik-btn-leading-icon"><LogOut size={15} strokeWidth={2.25} /></span>退出登录
              </button>
            )}
          </>
        } />

        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', padding: '0 clamp(16px, 2.4vw, 44px)' }}>
          {mode === 'search' && (
            <SearchMode
              query={query}
              onInput={(v) => { setQuery(v); setSel(0); setOpenId(null); setSugSel(-1); }}
              results={results}
              suggestions={suggestions}
              sugSel={sugSel}
              onSugHover={(i) => setSugSel(i)}
              onSugActivate={(i) => { if (suggestions[i]) applySuggestion(suggestions[i]); }}
              onSummon={summonSearch}
              sel={sel}
              total={scopedEntries.length}
              searchKb={searchKb}
              onScopeKb={(id) => { setSearchKb(id); setSel(0); setOpenId(null); setSugSel(-1); }}
              viewType={viewType}
              setViewType={(v) => { setViewType(v); setOpenId(null); }}
              theme={t}
              selectedEntry={selectedSearchEntry}
              selectedId={selectedSearchId}
              selectedLoading={selectedSearchLoading}
              onClear={clearSearch}
              onSuggest={(suggestion) => {
                setQuery(suggestion.value);
                setSel(0);
                setOpenId(suggestion.entryId ?? null);
                setTimeout(() => inputRef.current?.focus(), 20);
              }}
              onOpen={(id, index) => { if (typeof index === 'number') setSel(index); setOpenId(id); }}
              onOpenAI={() => setAiOpen(true)}
              kbs={kbs}
              folders={folders}
            />
          )}

          {mode === 'free' && (
            <div className="ik-free-stage">
              {auth.authRequired && !auth.authenticated ? (
                <LoginPanel onLoggedIn={setAuth} />
              ) : (
                <FreeMode
                  entries={entries}
                  kbs={kbs}
                  kbCategories={kbCategories}
                  folders={folders}
                  freeKb={freeKb}
                  freeFolder={freeFolder}
                  libraryCategory={libraryCategory}
                  setFreeKb={setFreeKb}
                  setFreeFolder={setFreeFolder}
                  setLibraryCategory={setLibraryCategory}
                  onNew={() => setFormOpen(true)}
                  onCreate={handleCreate}
                  onUpdate={handleUpdate}
                  onDelete={handleDelete}
                  onReorderEntries={handleReorder}
                  onFetchEntry={fetchEntry}
                  onImported={handleImported}
                  onGeneratedEntry={handleGeneratedEntry}
                  onStartKnowledgeBaseJob={handleStartKnowledgeBaseJob}
                  onStartFolderInitJob={handleStartFolderInitJob}
                  onStartFolderEntriesJob={handleStartFolderEntriesJob}
                  onStartFolderFullJob={handleStartFolderFullJob}
                  onStartAnalyzeJob={handleStartAnalyzeJob}
                  onStartAnalyzeEntryJob={handleStartAnalyzeEntryJob}
                  onStartAgentEditJob={handleStartAgentEditJob}
                  onCreateKb={handleCreateKb}
                  onCreateKbCategory={handleCreateKbCategory}
                  onRenameKbCategory={handleRenameKbCategory}
                  onDeleteKbCategory={handleDeleteKbCategory}
                  onMoveKbToCategory={handleMoveKbToCategory}
                  onToggleKbFavorite={handleToggleKbFavorite}
                  onCreateFolder={handleCreateFolder}
                  onRenameKb={handleRenameKb}
                  onDeleteKb={handleDeleteKb}
                  onDeleteKbTag={handleDeleteKbTag}
                  onRenameFolder={handleRenameFolder}
                  onDeleteFolder={handleDeleteFolder}
                  onMoveFolder={handleMoveFolder}
                  onReorderFolders={handleReorderFolders}
                  aiJobs={aiJobs}
                  aiTaskPanelOpen={aiTaskPanelOpen}
                  onAiTaskPanelOpenChange={setAiTaskPanelOpen}
                  onOpenAiJobResult={handleOpenAiJobResult}
                  onCancelAiJob={handleCancelAiJob}
                  onRetryAiJob={handleRetryAiJob}
                  onApplyAiJobDraft={handleApplyAiJobDraft}
                  onRevertAiJobApply={handleRevertAiJobApply}
                  onClearAiJob={handleClearAiJob}
                  onClearAiJobHistory={handleClearAiJobHistory}
                />
              )}
            </div>
          )}

          {loaded && entries.length === 0 && (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--mut)', fontSize: 13 }}>
              未能从服务端加载数据，请确认后端已启动（{apiBaseLabel}/entries）。
            </div>
          )}
        </div>
      </div>

      {modalEntry && <DetailModal entry={modalEntry} onClose={closeAll} />}
      {aiOpen && <AskModal query={query} onClose={closeAll} />}
      {formOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            zIndex: 50,
            overflow: 'auto',
            padding: '32px 16px',
          }}
          onClick={closeAll}
        >
          <div
            style={{
              maxWidth: 1000,
              margin: '0 auto',
              background: 'var(--bg)',
              border: '1px solid var(--bd)',
              borderRadius: 16,
              padding: '16px 20px 24px',
              boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <EntryEditor
              initial={null}
              kbs={kbs}
              folders={folders}
              defaultKbId={mode === 'free' ? freeKb ?? undefined : undefined}
              defaultFolderId={mode === 'free' ? freeFolder : null}
              onCancel={closeAll}
              onSave={(input) =>
                handleCreate(input).then((entry) => {
                  setFormOpen(false);
                  return entry;
                })
              }
            />
          </div>
        </div>
      )}
      {mode === 'search' && (
        <AiTaskCenter
          jobs={aiJobs}
          open={aiTaskPanelOpen}
          onOpenChange={setAiTaskPanelOpen}
          onOpenResult={handleOpenAiJobResult}
          onCancel={handleCancelAiJob}
          onRetry={handleRetryAiJob}
          onApplyAgentEdit={handleApplyAiJobDraft}
          onRevertAgentEdit={handleRevertAiJobApply}
          onClearJob={handleClearAiJob}
          onClearHistory={handleClearAiJobHistory}
        />
      )}
      <Toaster />
    </div>
  );
}
