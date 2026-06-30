const API_BASE_STORAGE_KEY = 'ik_api_base';
const API_TOKEN_STORAGE_KEY = 'ik_api_token';
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

function storageGet(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (items) => resolve(items || {}));
  });
}

async function getApiConfig() {
  const items = await storageGet([API_BASE_STORAGE_KEY, API_TOKEN_STORAGE_KEY]);
  const base = normalizeApiBase(items[API_BASE_STORAGE_KEY]) || DEFAULT_EXTENSION_API_BASE;
  const token = String(items[API_TOKEN_STORAGE_KEY] || '').trim();
  return { base, token };
}

async function apiFetch(path) {
  const { base, token } = await getApiConfig();
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  const res = await fetch(`${base}${path}`, { headers, cache: 'no-store' });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const message = data?.error || `请求失败 ${res.status}`;
    throw new Error(message);
  }
  return data;
}

async function sendMessageToTab(tabId, message) {
  if (!tabId) return;
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['quick-search-content.js'],
      });
      await chrome.tabs.sendMessage(tabId, message);
    } catch {
      // chrome://、扩展商店等页面不允许注入 content script，忽略即可。
    }
  }
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'open-quick-search') {
    void sendMessageToTab(tab?.id, { type: 'ikQuickSearchToggle' });
  }
  if (command === 'open-key-points') {
    void sendMessageToTab(tab?.id, { type: 'ikQuickSearchToggleKeyPoints' });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'ikQuickSearchToggleActiveTab') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      void sendMessageToTab(tabs[0]?.id, { type: 'ikQuickSearchToggle' }).finally(() => sendResponse({ ok: true }));
    });
    return true;
  }

  if (message?.type !== 'ikQuickSearchApi') return false;

  (async () => {
    if (message.action === 'config') {
      sendResponse({ ok: true, data: await getApiConfig() });
      return;
    }
    if (message.action === 'health') {
      sendResponse({ ok: true, data: await apiFetch('/health') });
      return;
    }
    if (message.action === 'bootstrap') {
      sendResponse({ ok: true, data: await apiFetch('/bootstrap') });
      return;
    }
    if (message.action === 'search') {
      const q = encodeURIComponent(String(message.q || ''));
      sendResponse({ ok: true, data: await apiFetch(`/search?q=${q}`) });
      return;
    }
    if (message.action === 'entry') {
      const id = encodeURIComponent(String(message.id || ''));
      sendResponse({ ok: true, data: await apiFetch(`/entries/${id}`) });
      return;
    }
    throw new Error('未知操作');
  })().catch((err) => {
    sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
  });

  return true;
});
