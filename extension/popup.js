const API_BASE_STORAGE_KEY = 'ik_api_base';
const DEFAULT_EXTENSION_API_BASE = 'http://localhost:5173/api';

function normalizeApiBase(value) {
  const trimmed = String(value || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (trimmed.startsWith('/')) return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    const base = url.toString().replace(/\/+$/, '');
    return url.pathname.replace(/\/+$/, '').endsWith('/api') ? base : `${base}/api`;
  } catch {
    return '';
  }
}

function currentApiBase() {
  return normalizeApiBase(localStorage.getItem(API_BASE_STORAGE_KEY) || '') || DEFAULT_EXTENSION_API_BASE;
}

function storageGet(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (items) => resolve(items || {}));
  });
}

function setStatus(message, kind = '') {
  const status = document.getElementById('status');
  status.textContent = message;
  status.className = `status ${kind}`.trim();
}

async function refreshApiBase() {
  const items = await storageGet([API_BASE_STORAGE_KEY]);
  const base = normalizeApiBase(items[API_BASE_STORAGE_KEY]) || currentApiBase();
  document.getElementById('apiBase').textContent = `API: ${base}`;
}

async function openQuickSearch() {
  try {
    await chrome.runtime.sendMessage({ type: 'ikQuickSearchToggleActiveTab' });
    window.close();
  } catch (err) {
    setStatus(err instanceof Error ? err.message : '无法在当前页面打开搜索框', 'err');
  }
}

async function openSidePanel() {
  try {
    if (!chrome.sidePanel?.open) throw new Error('当前浏览器不支持侧边栏 API');
    const win = await chrome.windows.getCurrent();
    await chrome.sidePanel.open({ windowId: win.id });
    window.close();
  } catch (err) {
    setStatus(err instanceof Error ? err.message : '无法打开侧边栏', 'err');
  }
}

function openTab() {
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html#/library') });
  window.close();
}

function openOptions() {
  chrome.runtime.openOptionsPage();
  window.close();
}

async function testApi() {
  const base = currentApiBase();
  setStatus('正在连接...');
  try {
    const res = await fetch(`${base}/health`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setStatus('连接正常', 'ok');
  } catch (err) {
    setStatus(`连接失败：${err instanceof Error ? err.message : String(err)}`, 'err');
  }
}

void refreshApiBase();
document.getElementById('openQuickSearch').addEventListener('click', openQuickSearch);
document.getElementById('openSidePanel').addEventListener('click', openSidePanel);
document.getElementById('openTab').addEventListener('click', openTab);
document.getElementById('openOptions').addEventListener('click', openOptions);
document.getElementById('testApi').addEventListener('click', testApi);
