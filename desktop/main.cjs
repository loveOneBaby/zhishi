const { app, BrowserWindow, Menu, dialog, globalShortcut, ipcMain, screen, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const rootDir = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '..');
const serverDir = path.join(rootDir, 'server');
const serverDistDir = path.join(serverDir, 'dist');
const webDistDir = path.join(rootDir, 'web', 'dist');
const portStart = Number(process.env.IK_DESKTOP_PORT || 51730);
const releasePageUrl = 'https://github.com/loveOneBaby/zhishi/releases/latest';
const appId = 'com.interviewknowledge.search';
const appDisplayName = '知识检索';

let localServer = null;
let mainWindow = null;
let quickSearchWindow = null;
let isQuitting = false;
let autoUpdaterReady = false;
let manualUpdateCheck = false;
let updateDownloadInProgress = false;
let availableUpdateInfo = null;
let downloadedUpdateInfo = null;
let downloadedUpdateFile = null;
let updateState = {
  status: 'idle',
  currentVersion: app.getVersion(),
  version: null,
  percent: null,
  transferred: null,
  total: null,
  bytesPerSecond: null,
  message: '',
  releaseNotes: '',
  releasePageUrl,
  isPackaged: app.isPackaged,
  canCheck: app.isPackaged,
  canDownload: false,
  canInstall: false,
};

function moduleUrl(filePath) {
  return pathToFileURL(filePath).href;
}

function normalizedUpdateState(state) {
  const next = {
    ...state,
    currentVersion: app.getVersion(),
    releasePageUrl,
    isPackaged: app.isPackaged,
  };
  next.canCheck = app.isPackaged && !['checking', 'downloading', 'installing'].includes(next.status);
  next.canDownload = app.isPackaged && next.status === 'available' && !updateDownloadInProgress;
  next.canInstall = app.isPackaged && next.status === 'downloaded';
  return next;
}

function broadcastUpdateState() {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('ik:update-state', updateState);
    }
  }
}

function setUpdateState(patch) {
  updateState = normalizedUpdateState({ ...updateState, ...patch });
  broadcastUpdateState();
  return updateState;
}

function stableUserDataPath() {
  if (process.platform === 'darwin') {
    return path.join(app.getPath('appData'), appId);
  }
  return app.getPath('userData');
}

function legacyUserDataPaths() {
  if (process.platform !== 'darwin') return [];
  const appData = app.getPath('appData');
  const mojibakeName = Buffer.from(appDisplayName, 'utf8').toString('latin1');
  return [
    path.join(appData, appDisplayName),
    path.join(appData, mojibakeName),
  ];
}

function migrateLegacyDatabase(dataDir) {
  const targetDb = path.join(dataDir, 'knowledge.db');
  if (fs.existsSync(targetDb)) return;

  for (const legacyDir of legacyUserDataPaths()) {
    const legacyDataDir = path.join(legacyDir, 'data');
    const legacyDb = path.join(legacyDataDir, 'knowledge.db');
    if (!fs.existsSync(legacyDb) || path.resolve(legacyDb) === path.resolve(targetDb)) continue;

    fs.mkdirSync(dataDir, { recursive: true });
    for (const filename of ['knowledge.db', 'knowledge.db-wal', 'knowledge.db-shm']) {
      const source = path.join(legacyDataDir, filename);
      if (fs.existsSync(source)) fs.copyFileSync(source, path.join(dataDir, filename));
    }
    console.log(`[desktop] 已迁移本地数据库: ${legacyDb} -> ${targetDb}`);
    return;
  }
}

function installToApplicationsIfNeeded() {
  if (process.platform !== 'darwin' || !app.isPackaged || app.isInApplicationsFolder()) {
    return true;
  }

  try {
    const moved = app.moveToApplicationsFolder({
      conflictHandler: (conflictType) => {
        const running = conflictType === 'existsAndRunning';
        const response = dialog.showMessageBoxSync({
          type: 'question',
          title: '安装知识检索',
          message: running ? 'Applications 中已有正在运行的知识检索' : 'Applications 中已存在知识检索',
          detail: running
            ? '是否切换到已安装的应用？当前从 DMG 打开的应用会退出。'
            : '是否替换旧版本并安装到 Applications？',
          buttons: running ? ['切换', '取消'] : ['替换并安装', '取消'],
          defaultId: 0,
          cancelId: 1,
        });
        return response === 0;
      },
    });

    if (moved) {
      return false;
    }

    const response = dialog.showMessageBoxSync({
      type: 'warning',
      title: '未完成安装',
      message: '知识检索还没有安装到 Applications',
      detail: '从 DMG 直接运行不利于后续自动更新。建议重新打开 DMG 并双击知识检索完成安装。',
      buttons: ['继续运行', '退出'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 1) {
      app.quit();
      return false;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    dialog.showErrorBox('安装失败', message);
  }

  return true;
}

function canUsePort(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.unref();
    probe.once('error', () => resolve(false));
    probe.listen({ host: '127.0.0.1', port }, () => {
      probe.close(() => resolve(true));
    });
  });
}

async function findAvailablePort(start) {
  for (let port = start; port < start + 80; port += 1) {
    if (await canUsePort(port)) return port;
  }
  throw new Error(`未找到可用端口: ${start}-${start + 79}`);
}

function assertBuildReady() {
  const missing = [];
  if (!fs.existsSync(path.join(serverDistDir, 'index.js'))) missing.push('server/dist/index.js');
  if (!fs.existsSync(path.join(webDistDir, 'index.html'))) missing.push('web/dist/index.html');
  if (missing.length > 0) {
    throw new Error(`桌面端启动前需要先构建项目，缺少: ${missing.join(', ')}`);
  }
}

async function startLocalServer() {
  if (localServer) return localServer.url;

  assertBuildReady();

  const port = await findAvailablePort(portStart);
  process.env.PORT = String(port);
  process.env.IK_DESKTOP = 'true';
  process.env.ALLOW_UNAUTHENTICATED_ADMIN ||= 'true';
  if (app.isPackaged && !process.env.DB_PATH && !process.env.TURSO_DATABASE_URL) {
    const dataDir = path.join(app.getPath('userData'), 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    migrateLegacyDatabase(dataDir);
    process.env.DB_PATH = path.join(dataDir, 'knowledge.db');
  }

  process.chdir(serverDir);

  const { loadEnvFile } = await import(moduleUrl(path.join(serverDistDir, 'env.js')));
  loadEnvFile();

  const [
    { createApp },
    {
      initDb,
      listEntrySummaries,
      listFolders,
      listKbCategories,
      listKbs,
      seedBuiltins,
      warmEntriesCache,
    },
    { initAiJobs },
  ] = await Promise.all([
    import(moduleUrl(path.join(serverDistDir, 'app.js'))),
    import(moduleUrl(path.join(serverDistDir, 'db.js'))),
    import(moduleUrl(path.join(serverDistDir, 'services', 'ai-jobs.js'))),
  ]);

  await initDb();
  await seedBuiltins();
  await initAiJobs();
  await listEntrySummaries();
  await listFolders();
  await listKbs();
  await listKbCategories();
  void warmEntriesCache().catch((err) => console.warn('[desktop] 预热知识点详情缓存失败:', err));

  const expressApp = createApp();
  const server = await new Promise((resolve, reject) => {
    const instance = expressApp.listen(port, '127.0.0.1', () => resolve(instance));
    instance.once('error', reject);
  });

  const url = `http://127.0.0.1:${port}`;
  localServer = { server, url };
  console.log(`[desktop] 本地服务已启动: ${url}`);
  return url;
}

function quickSearchUrl(baseUrl, mode = 'search') {
  return `${baseUrl}/#/desktop-quick-search${mode === 'keypoints' ? '?kp=1' : ''}`;
}

function quickSearchBounds() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { x, y, width } = display.workArea;
  const winWidth = Math.min(820, Math.max(680, width - 80));
  const winHeight = 590;
  return {
    width: winWidth,
    height: winHeight,
    x: Math.round(x + (width - winWidth) / 2),
    y: Math.round(y + 30),
  };
}

function dispatchQuickSearchCommand(type, options = {}) {
  if (!quickSearchWindow || quickSearchWindow.isDestroyed()) return;
  const payload = JSON.stringify({ type, ...options });
  void quickSearchWindow.webContents.executeJavaScript(
    `window.dispatchEvent(new CustomEvent('ikDesktopQuickSearchCommand', { detail: ${payload} }))`,
    true,
  ).catch(() => {});
}

async function createQuickSearchWindow(mode = 'search') {
  const baseUrl = await startLocalServer();
  const bounds = quickSearchBounds();
  quickSearchWindow = new BrowserWindow({
    ...bounds,
    title: '知识检索快捷搜索',
    frame: false,
    resizable: false,
    movable: true,
    show: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    transparent: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  quickSearchWindow.setAlwaysOnTop(true, 'floating');
  quickSearchWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  quickSearchWindow.on('blur', () => {
    if (!quickSearchWindow?.isDestroyed()) quickSearchWindow.hide();
  });

  quickSearchWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    quickSearchWindow?.hide();
  });

  quickSearchWindow.on('closed', () => {
    quickSearchWindow = null;
  });

  quickSearchWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'Escape') {
      event.preventDefault();
      quickSearchWindow?.hide();
    }
  });

  quickSearchWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    shell.openExternal(targetUrl);
    return { action: 'deny' };
  });

  await quickSearchWindow.loadURL(quickSearchUrl(baseUrl, mode));
  return quickSearchWindow;
}

async function showQuickSearch(mode = 'search') {
  const win = quickSearchWindow && !quickSearchWindow.isDestroyed()
    ? quickSearchWindow
    : await createQuickSearchWindow(mode);

  win.setBounds(quickSearchBounds());
  win.show();
  win.focus();
  dispatchQuickSearchCommand(mode === 'keypoints' ? 'keypoints' : 'search', { open: mode === 'keypoints' });
}

function toggleQuickSearch() {
  if (quickSearchWindow && !quickSearchWindow.isDestroyed() && quickSearchWindow.isVisible()) {
    quickSearchWindow.hide();
    return;
  }
  void showQuickSearch('search').catch((err) => {
    console.error('[desktop] 打开快捷搜索失败:', err);
  });
}

function toggleQuickSearchKeyPoints() {
  if (quickSearchWindow && !quickSearchWindow.isDestroyed() && quickSearchWindow.isVisible()) {
    quickSearchWindow.focus();
    dispatchQuickSearchCommand('keypoints');
    return;
  }
  void showQuickSearch('keypoints').catch((err) => {
    console.error('[desktop] 打开关键点快捷搜索失败:', err);
  });
}

function registerGlobalShortcuts() {
  const shortcuts = [
    ['Alt+K', toggleQuickSearch],
    ['Alt+J', toggleQuickSearchKeyPoints],
  ];

  for (const [accelerator, handler] of shortcuts) {
    const ok = globalShortcut.register(accelerator, handler);
    if (!ok) console.warn(`[desktop] 全局快捷键注册失败: ${accelerator}`);
  }
}

function updateDialogWindow() {
  return BrowserWindow.getFocusedWindow() || mainWindow || undefined;
}

function showMessageBox(options) {
  const owner = updateDialogWindow();
  return owner ? dialog.showMessageBox(owner, options) : dialog.showMessageBox(options);
}

function formatReleaseNotes(notes) {
  if (!notes) return '';
  if (Array.isArray(notes)) {
    return notes
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') return String(item.note || item.version || '');
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return String(notes);
}

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    ...options,
  });
  if (result.status !== 0) {
    const output = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
    throw new Error(`${path.basename(command)} 执行失败: ${output || `exit ${result.status}`}`);
  }
  return result.stdout || '';
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function currentAppBundlePath() {
  let current = app.getPath('exe');
  while (current && current !== path.dirname(current)) {
    if (current.endsWith('.app')) return current;
    current = path.dirname(current);
  }
  return path.join('/Applications', `${app.name}.app`);
}

function findAppBundle(dir) {
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory() && entry.name.endsWith('.app')) return fullPath;
      if (entry.isDirectory() && !entry.name.startsWith('.') && stack.length < 50) stack.push(fullPath);
    }
  }
  return null;
}

function readBundleIdentifier(appBundlePath) {
  return runChecked('/usr/libexec/PlistBuddy', [
    '-c',
    'Print :CFBundleIdentifier',
    path.join(appBundlePath, 'Contents', 'Info.plist'),
  ]).trim();
}

function prepareManualMacUpdate(zipPath) {
  if (!zipPath || !fs.existsSync(zipPath)) {
    throw new Error('没有找到已下载的更新文件，请重新下载更新。');
  }

  const stageRoot = fs.mkdtempSync(path.join(app.getPath('userData'), 'pending-update-'));
  const unpackDir = path.join(stageRoot, 'unpacked');
  fs.mkdirSync(unpackDir, { recursive: true });

  runChecked('/usr/bin/ditto', ['-x', '-k', zipPath, unpackDir]);
  const newAppPath = findAppBundle(unpackDir);
  if (!newAppPath) {
    throw new Error('更新包里没有找到 app。');
  }

  const bundleId = readBundleIdentifier(newAppPath);
  if (bundleId !== 'com.interviewknowledge.search') {
    throw new Error(`更新包应用标识不匹配: ${bundleId}`);
  }

  runChecked('/usr/bin/codesign', ['--verify', '--deep', '--strict', newAppPath]);

  const targetAppPath = currentAppBundlePath();
  const scriptPath = path.join(stageRoot, 'install-update.sh');
  const logPath = path.join(app.getPath('userData'), 'last-update-install.log');
  const backupPath = `${targetAppPath}.previous`;
  const executablePath = path.join(targetAppPath, 'Contents', 'MacOS', app.name);
  const script = `#!/bin/zsh
set -euo pipefail
exec >> ${shellQuote(logPath)} 2>&1
echo "[$(/bin/date)] install update start"
target=${shellQuote(targetAppPath)}
new_app=${shellQuote(newAppPath)}
backup=${shellQuote(backupPath)}
stage=${shellQuote(stageRoot)}
executable=${shellQuote(executablePath)}

for i in {1..90}; do
  if ! /usr/bin/pgrep -f "$executable" >/dev/null 2>&1; then
    break
  fi
  /bin/sleep 1
done

if /usr/bin/pgrep -f "$executable" >/dev/null 2>&1; then
  echo "app still running, abort"
  exit 1
fi

/bin/rm -rf "$backup"
if [ -d "$target" ]; then
  /bin/mv "$target" "$backup"
fi

if /usr/bin/ditto "$new_app" "$target"; then
  /usr/bin/xattr -dr com.apple.quarantine "$target" >/dev/null 2>&1 || true
  /usr/bin/open "$target"
  /bin/rm -rf "$backup" "$stage"
  echo "[$(/bin/date)] install update done"
else
  echo "copy failed, restoring previous app"
  /bin/rm -rf "$target"
  if [ -d "$backup" ]; then
    /bin/mv "$backup" "$target"
    /usr/bin/open "$target"
  fi
  exit 1
fi
`;
  fs.writeFileSync(scriptPath, script, { mode: 0o755 });
  return { scriptPath, targetAppPath };
}

function showUpdaterError(err) {
  const message = err instanceof Error ? err.message : String(err);
  const releaseAccessFailed = /404|not found|releases\.atom|latest-mac\.yml/i.test(message);
  setUpdateState({
    status: 'error',
    message: releaseAccessFailed ? '无法访问更新文件' : message,
    percent: null,
    transferred: null,
    total: null,
    bytesPerSecond: null,
  });
  if (!manualUpdateCheck && !updateDownloadInProgress) {
    console.warn(`[desktop] 自动更新检查未完成: ${message}`);
    return;
  }
  console.error('[desktop] 更新失败:', err);
  void showMessageBox({
    type: 'error',
    title: releaseAccessFailed ? '无法访问更新文件' : '更新失败',
    message: releaseAccessFailed ? '自动更新文件当前不可访问' : '检查或下载更新失败',
    detail: releaseAccessFailed
      ? `如果 GitHub 仓库是私有的，桌面应用无法读取 Release 更新文件，因此不会自动弹出新版本提示。\n\n${message}`
      : message,
    buttons: releaseAccessFailed ? ['打开下载页', '知道了'] : ['知道了'],
    defaultId: 0,
    cancelId: releaseAccessFailed ? 1 : 0,
  }).then((result) => {
    if (releaseAccessFailed && result.response === 0) {
      void shell.openExternal(releasePageUrl);
    }
  });
  manualUpdateCheck = false;
  updateDownloadInProgress = false;
  downloadedUpdateFile = null;
  setUpdateState({});
}

function setupAutoUpdater() {
  if (autoUpdaterReady) return;
  autoUpdaterReady = true;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.autoRunAppAfterInstall = true;
  autoUpdater.logger = console;

  autoUpdater.on('update-available', (info) => {
    availableUpdateInfo = info;
    downloadedUpdateInfo = null;
    downloadedUpdateFile = null;
    manualUpdateCheck = false;
    const notes = formatReleaseNotes(info.releaseNotes).trim();
    setUpdateState({
      status: 'available',
      version: info.version || null,
      percent: null,
      transferred: null,
      total: null,
      bytesPerSecond: null,
      message: `发现新版本 ${info.version || ''}`.trim(),
      releaseNotes: notes,
    });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  autoUpdater.on('update-not-available', () => {
    availableUpdateInfo = null;
    downloadedUpdateInfo = null;
    downloadedUpdateFile = null;
    setUpdateState({
      status: 'not-available',
      version: null,
      percent: null,
      transferred: null,
      total: null,
      bytesPerSecond: null,
      message: `当前已是最新版本 ${app.getVersion()}`,
      releaseNotes: '',
    });
    manualUpdateCheck = false;
  });

  autoUpdater.on('download-progress', (progress) => {
    const percent = Number(progress.percent || 0);
    console.log(`[desktop] 更新下载中: ${percent.toFixed(1)}%`);
    setUpdateState({
      status: 'downloading',
      percent,
      transferred: Number.isFinite(progress.transferred) ? progress.transferred : null,
      total: Number.isFinite(progress.total) ? progress.total : null,
      bytesPerSecond: Number.isFinite(progress.bytesPerSecond) ? progress.bytesPerSecond : null,
      message: `正在下载 ${percent.toFixed(1)}%`,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    downloadedUpdateInfo = info;
    downloadedUpdateFile = info.downloadedFile || null;
    updateDownloadInProgress = false;
    setUpdateState({
      status: 'downloaded',
      version: info.version || availableUpdateInfo?.version || null,
      percent: 100,
      transferred: null,
      total: null,
      bytesPerSecond: null,
      message: `新版本 ${info.version || ''} 已下载完成`.trim(),
    });
  });

  autoUpdater.on('error', showUpdaterError);
}

function checkForUpdates(manual = false) {
  if (!app.isPackaged) {
    return setUpdateState({
      status: 'dev',
      message: '开发模式不会检查线上更新，请使用打包后的应用验证更新。',
      percent: null,
    });
  }
  if (updateDownloadInProgress) {
    return setUpdateState({
      status: 'downloading',
      message: updateState.message || '更新正在下载中，请稍后。',
    });
  }
  setupAutoUpdater();
  manualUpdateCheck = manual;
  setUpdateState({
    status: 'checking',
    message: '正在检查更新...',
    percent: null,
    transferred: null,
    total: null,
    bytesPerSecond: null,
  });
  return autoUpdater.checkForUpdates().catch((err) => {
    showUpdaterError(err);
    return null;
  });
}

function downloadUpdateFromUi() {
  if (!app.isPackaged) {
    return Promise.resolve(checkForUpdates(true));
  }
  setupAutoUpdater();
  if (updateDownloadInProgress) return Promise.resolve(updateState);
  if (!availableUpdateInfo && updateState.status !== 'available') {
    return Promise.resolve(checkForUpdates(true));
  }

  updateDownloadInProgress = true;
  setUpdateState({
    status: 'downloading',
    percent: 0,
    transferred: null,
    total: null,
    bytesPerSecond: null,
    message: '准备下载更新...',
  });

  return autoUpdater.downloadUpdate().catch((err) => {
    showUpdaterError(err);
    return null;
  });
}

async function installDownloadedUpdateFromUi() {
  if (updateState.status !== 'downloaded' && !downloadedUpdateInfo) return updateState;
  const result = await showMessageBox({
    type: 'question',
    title: '安装更新',
    message: `安装新版本 ${updateState.version || ''} 需要退出应用`.trim(),
    detail: '确认后应用会退出，在后台完成安装。安装完成后会自动重新打开。',
    buttons: ['退出并后台安装', '取消'],
    defaultId: 0,
    cancelId: 1,
  });
  if (result.response !== 0) return updateState;

  setUpdateState({
    status: 'installing',
    message: '正在退出并后台安装更新...',
  });

  try {
    if (process.platform === 'darwin') {
      const { scriptPath } = prepareManualMacUpdate(downloadedUpdateFile);
      const child = spawn('/bin/zsh', [scriptPath], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      isQuitting = true;
      app.quit();
    } else {
      isQuitting = true;
      autoUpdater.quitAndInstall();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setUpdateState({
      status: 'error',
      message: `安装更新失败：${message}`,
    });
    void showMessageBox({
      type: 'error',
      title: '安装更新失败',
      message: '无法自动安装更新',
      detail: `${message}\n\n可以先手动下载最新 DMG 安装。`,
      buttons: ['打开下载页', '知道了'],
      defaultId: 0,
      cancelId: 1,
    }).then((installResult) => {
      if (installResult.response === 0) void shell.openExternal(releasePageUrl);
    });
  }
  return updateState;
}

function setupUpdateIpc() {
  ipcMain.handle('ik:update-get-state', () => updateState);
  ipcMain.handle('ik:update-check', async () => {
    await checkForUpdates(true);
    return updateState;
  });
  ipcMain.handle('ik:update-download', async () => {
    await downloadUpdateFromUi();
    return updateState;
  });
  ipcMain.handle('ik:update-install', async () => installDownloadedUpdateFromUi());
}

function createApplicationMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{
      label: app.name,
      submenu: [
        { role: 'about', label: `关于 ${app.name}` },
        { label: '检查更新...', click: () => checkForUpdates(true) },
        { type: 'separator' },
        { role: 'hide', label: '隐藏' },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '显示全部' },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    }] : []),
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'close', label: '关闭窗口' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        { label: '检查更新...', click: () => checkForUpdates(true) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow() {
  const url = await startLocalServer();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    title: '知识检索',
    backgroundColor: '#fbfbfa',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    shell.openExternal(targetUrl);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (targetUrl.startsWith(url)) return;
    event.preventDefault();
    void shell.openExternal(targetUrl);
  });

  await mainWindow.loadURL(url);
}

app.setName(appDisplayName);
if (process.platform === 'darwin') {
  app.setPath('userData', stableUserDataPath());
}

app.whenReady().then(async () => {
  if (!installToApplicationsIfNeeded()) return;

  setupUpdateIpc();
  createApplicationMenu();
  try {
    await createWindow();
    registerGlobalShortcuts();
    setupAutoUpdater();
    setTimeout(() => checkForUpdates(false), 3000);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    dialog.showErrorBox('知识检索启动失败', message);
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
  globalShortcut.unregisterAll();
  if (quickSearchWindow && !quickSearchWindow.isDestroyed()) {
    quickSearchWindow.destroy();
    quickSearchWindow = null;
  }
  if (localServer) {
    localServer.server.close();
    localServer = null;
  }
});
