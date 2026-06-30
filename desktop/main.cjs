const { app, BrowserWindow, Menu, dialog, globalShortcut, screen, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const rootDir = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '..');
const serverDir = path.join(rootDir, 'server');
const serverDistDir = path.join(serverDir, 'dist');
const webDistDir = path.join(rootDir, 'web', 'dist');
const portStart = Number(process.env.IK_DESKTOP_PORT || 51730);

let localServer = null;
let mainWindow = null;
let quickSearchWindow = null;
let isQuitting = false;
let autoUpdaterReady = false;
let manualUpdateCheck = false;
let updateDownloadInProgress = false;

function moduleUrl(filePath) {
  return pathToFileURL(filePath).href;
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

function showUpdaterError(err) {
  const message = err instanceof Error ? err.message : String(err);
  if (!manualUpdateCheck && !updateDownloadInProgress) {
    console.warn(`[desktop] 自动更新检查未完成: ${message}`);
    return;
  }
  console.error('[desktop] 更新失败:', err);
  void showMessageBox({
    type: 'error',
    title: '更新失败',
    message: '检查或下载更新失败',
    detail: message,
    buttons: ['知道了'],
  });
  manualUpdateCheck = false;
  updateDownloadInProgress = false;
}

function setupAutoUpdater() {
  if (autoUpdaterReady) return;
  autoUpdaterReady = true;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = console;

  autoUpdater.on('update-available', async (info) => {
    manualUpdateCheck = false;
    const notes = formatReleaseNotes(info.releaseNotes).trim();
    const result = await showMessageBox({
      type: 'info',
      title: '发现新版本',
      message: `发现新版本 ${info.version || ''}`.trim(),
      detail: notes ? `是否现在下载并更新？\n\n${notes}` : '是否现在下载并更新？',
      buttons: ['更新', '稍后'],
      defaultId: 0,
      cancelId: 1,
    });
    if (result.response !== 0) return;
    updateDownloadInProgress = true;
    autoUpdater.downloadUpdate().catch(() => {});
  });

  autoUpdater.on('update-not-available', () => {
    if (!manualUpdateCheck) return;
    manualUpdateCheck = false;
    void showMessageBox({
      type: 'info',
      title: '已是最新版本',
      message: `当前已是最新版本 ${app.getVersion()}`,
      buttons: ['知道了'],
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    const percent = Number(progress.percent || 0).toFixed(1);
    console.log(`[desktop] 更新下载中: ${percent}%`);
  });

  autoUpdater.on('update-downloaded', async (info) => {
    updateDownloadInProgress = false;
    const result = await showMessageBox({
      type: 'info',
      title: '更新已下载',
      message: `新版本 ${info.version || ''} 已下载完成`.trim(),
      detail: '点击“立即安装”后应用会退出并完成更新。',
      buttons: ['立即安装', '稍后'],
      defaultId: 0,
      cancelId: 1,
    });
    if (result.response !== 0) return;
    isQuitting = true;
    autoUpdater.quitAndInstall(false, true);
  });

  autoUpdater.on('error', showUpdaterError);
}

function checkForUpdates(manual = false) {
  if (!app.isPackaged) {
    if (manual) {
      void showMessageBox({
        type: 'info',
        title: '开发模式',
        message: '开发模式不会检查线上更新，请使用打包后的应用验证更新。',
        buttons: ['知道了'],
      });
    }
    return;
  }
  if (updateDownloadInProgress) {
    if (manual) {
      void showMessageBox({
        type: 'info',
        title: '正在下载更新',
        message: '更新正在下载中，请稍后。',
        buttons: ['知道了'],
      });
    }
    return;
  }
  setupAutoUpdater();
  manualUpdateCheck = manual;
  autoUpdater.checkForUpdates().catch(() => {});
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

app.setName('知识检索');

app.whenReady().then(async () => {
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
