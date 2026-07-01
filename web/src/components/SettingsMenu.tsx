import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Settings, Server, Database, Plug, LoaderCircle, RotateCcw, AlertCircle, CheckCircle2 } from 'lucide-react';
import {
  API_BASE_STORAGE_KEY,
  API_TOKEN_STORAGE_KEY,
  BASE,
  normalizeApiBase,
  usingCustomBase,
} from '../api/client';
import { getServerConfig, setDbConfig, type DbInfo } from '../api/config';
import type { AuthStatus } from '../api/auth';

interface Props {
  auth: AuthStatus;
  onDbSwitched: () => void;
}

const sourceLabel: Record<DbInfo['source'], string> = {
  user: '用户配置',
  env: '环境变量',
  default: '默认',
};

export default function SettingsMenu({ auth, onDbSwitched }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutside = (event: PointerEvent): void => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const canManageDb = !auth.authRequired || auth.authenticated;

  return (
    <div ref={ref} className="ik-settings">
      <button
        type="button"
        className={`ik-settings-trigger ${open ? 'is-open' : ''}`}
        aria-label="设置"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="设置"
        onClick={() => setOpen((next) => !next)}
      >
        <Settings size={15} strokeWidth={2.1} />
      </button>
      {open && (
        <div className="ik-settings-menu" role="dialog" aria-label="连接设置">
          {canManageDb ? (
            <ServerDbSection onSwitched={onDbSwitched} />
          ) : (
            <p className="ik-settings-hint">数据库配置需管理员登录后操作。</p>
          )}
          <FrontendBaseSection />
        </div>
      )}
    </div>
  );
}

// ───────────── Section A：服务器实际使用的数据库（管理员） ─────────────
function ServerDbSection({ onSwitched }: { onSwitched: () => void }): ReactNode {
  const [info, setInfo] = useState<DbInfo | null>(null);
  const [mode, setMode] = useState<'local' | 'remote'>('remote');
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [dbPath, setDbPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    let cancelled = false;
    getServerConfig()
      .then((cfg) => {
        if (cancelled) return;
        setInfo(cfg.db);
        setMode(cfg.db.mode);
      })
      .catch(() => { /* 静默：未登录或本地无配置都不阻塞表单 */ });
    return () => { cancelled = true; };
  }, []);

  async function save(): Promise<void> {
    setError(''); setStatus(''); setBusy(true);
    try {
      const body = mode === 'remote'
        ? { mode, url: url.trim(), token: token.trim() }
        : { mode, dbPath: dbPath.trim() };
      await setDbConfig(body);
      setStatus('已切换，正在刷新…');
      onSwitched();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function reset(): Promise<void> {
    setError(''); setStatus(''); setBusy(true);
    try {
      await setDbConfig({ clear: true });
      setStatus('已恢复默认，正在刷新…');
      onSwitched();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ik-settings-section">
      <div className="ik-settings-head">
        <span><Server size={14} strokeWidth={2.2} />服务器数据库</span>
        {info && <b>{modeLabel(info.mode)} · {sourceLabel[info.source]}</b>}
      </div>
      {info && (
        <p className="ik-settings-current">当前：{info.label}</p>
      )}
      <div className="ik-settings-seg">
        <button type="button" style={seg2(mode === 'remote')} onClick={() => setMode('remote')}>远程 libSQL</button>
        <button type="button" style={seg2(mode === 'local')} onClick={() => setMode('local')}>本地文件</button>
      </div>
      {mode === 'remote' ? (
        <>
          <label className="ik-settings-field">
            <span>地址</span>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="libsql://<db>.turso.io"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="ik-settings-field">
            <span>Token</span>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="留空表示不更新 token"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        </>
      ) : (
        <label className="ik-settings-field">
          <span>文件路径</span>
          <input
            type="text"
            value={dbPath}
            onChange={(e) => setDbPath(e.target.value)}
            placeholder="/绝对/或相对/server 的路径/knowledge.db"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      )}
      <div className="ik-settings-actions">
        <button type="button" className="ik-btn ik-btn-default ik-btn-size-sm" onClick={save} disabled={busy}>
          {busy ? <LoaderCircle size={13} className="ik-update-spin" /> : <Database size={13} />}保存并切换
        </button>
        <button type="button" className="ik-btn ik-btn-ghost ik-btn-size-sm" onClick={reset} disabled={busy}>
          <RotateCcw size={13} />恢复默认
        </button>
      </div>
      <StatusLine error={error} status={status} />
    </section>
  );
}

// ───────────── Section B：前端连接的后端地址 ─────────────
function FrontendBaseSection(): ReactNode {
  const [base, setBase] = useState(BASE);
  const [token, setToken] = useState(() => readToken());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const custom = usingCustomBase();

  function save(): void {
    setError(''); setStatus('');
    const normalized = normalizeApiBase(base);
    if (!normalized) {
      setError('请输入有效的 http 或 https 地址');
      return;
    }
    setBusy(true);
    try {
      window.localStorage.setItem(API_BASE_STORAGE_KEY, normalized);
      const t = token.trim();
      if (t) window.localStorage.setItem(API_TOKEN_STORAGE_KEY, t);
      else window.localStorage.removeItem(API_TOKEN_STORAGE_KEY);
      setStatus('已保存，正在刷新…');
      window.location.reload();
    } finally {
      setBusy(false);
    }
  }

  function reset(): void {
    window.localStorage.removeItem(API_BASE_STORAGE_KEY);
    window.localStorage.removeItem(API_TOKEN_STORAGE_KEY);
    window.location.reload();
  }

  async function test(): Promise<void> {
    setError(''); setStatus('测试中…');
    const normalized = normalizeApiBase(base) || BASE;
    try {
      const res = await fetch(`${normalized}/health`, { cache: 'no-store' });
      if (res.ok) setStatus('连接正常');
      else setStatus(`连接失败：HTTP ${res.status}`);
    } catch (e) {
      setStatus(`连接失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <section className="ik-settings-section">
      <div className="ik-settings-head">
        <span><Plug size={14} strokeWidth={2.2} />前端数据源</span>
        {custom ? <b className="is-custom">自定义</b> : <b>同源</b>}
      </div>
      <p className="ik-settings-current">当前：{BASE || '/api'}</p>
      <label className="ik-settings-field">
        <span>后端 API 地址</span>
        <input
          type="text"
          value={base}
          onChange={(e) => setBase(e.target.value)}
          placeholder="留空使用同源 /api；远程填 https://host/api"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <label className="ik-settings-field">
        <span>登录 Token</span>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="远程后端需登录时填写"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <div className="ik-settings-actions">
        <button type="button" className="ik-btn ik-btn-default ik-btn-size-sm" onClick={save} disabled={busy}>
          {busy ? <LoaderCircle size={13} className="ik-update-spin" /> : <Plug size={13} />}保存
        </button>
        <button type="button" className="ik-btn ik-btn-ghost ik-btn-size-sm" onClick={test} disabled={busy}>
          测试连接
        </button>
        {custom && (
          <button type="button" className="ik-btn ik-btn-ghost ik-btn-size-sm" onClick={reset} disabled={busy}>
            <RotateCcw size={13} />恢复默认
          </button>
        )}
      </div>
      <p className="ik-settings-note">
        设置后前端将直连该后端取数据，本服务的数据库配置不再影响显示。远程后端需目标服务启用 CORS（本服务设 <code>IK_ALLOW_REMOTE_API=true</code>）。
      </p>
      <StatusLine error={error} status={status} />
    </section>
  );
}

function StatusLine({ error, status }: { error: string; status: string }): ReactNode {
  if (error) return <p className="ik-settings-status is-error"><AlertCircle size={12} />{error}</p>;
  if (status) return <p className="ik-settings-status is-ok"><CheckCircle2 size={12} />{status}</p>;
  return null;
}

function modeLabel(mode: DbInfo['mode']): string {
  return mode === 'local' ? '本地文件' : '远程 libSQL';
}

function readToken(): string {
  try { return window.localStorage.getItem(API_TOKEN_STORAGE_KEY) ?? ''; } catch { return ''; }
}

// seg2 复用 ui.ts 同款内联样式（保持文件自洽，避免为单处引用而改导出）。
function seg2(active: boolean): CSSProperties {
  return {
    padding: '5px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12,
    fontFamily: 'inherit', fontWeight: active ? 600 : 400, transition: 'all .12s',
    background: active ? 'var(--fg)' : 'transparent', color: active ? 'var(--bg)' : 'var(--mut)',
  };
}
