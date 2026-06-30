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

function storageSet(items) {
  return new Promise((resolve) => {
    chrome.storage.local.set(items, resolve);
  });
}

function storageRemove(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.remove(keys, resolve);
  });
}

function setStatus(message, kind = '') {
  const status = document.getElementById('status');
  status.textContent = message;
  status.className = `status ${kind}`.trim();
}

async function loadValue() {
  const items = await storageGet([API_BASE_STORAGE_KEY]);
  document.getElementById('apiBaseInput').value = normalizeApiBase(items[API_BASE_STORAGE_KEY]) || currentApiBase();
}

async function saveValue(event) {
  event.preventDefault();
  const input = document.getElementById('apiBaseInput');
  const normalized = normalizeApiBase(input.value);
  if (!normalized) {
    setStatus('请输入有效的 http 或 https 地址', 'err');
    return;
  }
  localStorage.setItem(API_BASE_STORAGE_KEY, normalized);
  await storageSet({ [API_BASE_STORAGE_KEY]: normalized });
  input.value = normalized;
  setStatus('已保存，刷新已打开的扩展页面后生效', 'ok');
}

async function resetDefault() {
  localStorage.removeItem(API_BASE_STORAGE_KEY);
  await storageRemove([API_BASE_STORAGE_KEY]);
  await loadValue();
  setStatus('已恢复默认本机地址', 'ok');
}

async function testApi() {
  const input = document.getElementById('apiBaseInput');
  const base = normalizeApiBase(input.value);
  if (!base) {
    setStatus('请输入有效的 http 或 https 地址', 'err');
    return;
  }
  setStatus('正在连接...');
  try {
    const res = await fetch(`${base}/health`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setStatus('连接正常', 'ok');
  } catch (err) {
    setStatus(`连接失败：${err instanceof Error ? err.message : String(err)}`, 'err');
  }
}

function openApp() {
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html#/library') });
}

void loadValue();
document.getElementById('settingsForm').addEventListener('submit', saveValue);
document.getElementById('resetDefault').addEventListener('click', resetDefault);
document.getElementById('testApi').addEventListener('click', testApi);
document.getElementById('openApp').addEventListener('click', openApp);
