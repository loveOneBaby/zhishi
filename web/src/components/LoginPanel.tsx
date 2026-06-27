import { useState, type FormEvent } from 'react';
import { Lock } from 'lucide-react';
import Button from './Button';
import { login, type AuthStatus } from '../api/auth';

interface Props {
  onLoggedIn: (status: AuthStatus) => void;
}

// 管理登录:知识库管理(增删改 / AI 生成 / 导入导出)需要令牌,检索页仍公开。
// 令牌交服务端校验后下发 httpOnly cookie,后续同源请求自动携带。
export default function LoginPanel({ onLoggedIn }: Props) {
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    const value = token.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    try {
      const status = await login(value);
      if (status.authenticated) onLoggedIn(status);
      else setError('令牌无效');
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <form
        onSubmit={submit}
        style={{
          width: '100%', maxWidth: 380, padding: '28px 26px 30px',
          background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 16,
          boxShadow: '0 20px 60px rgba(0,0,0,0.12)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span style={{ display: 'inline-flex', color: 'var(--mut)' }}><Lock size={18} strokeWidth={2} /></span>
          <span style={{ fontSize: 15, fontWeight: 700 }}>管理登录</span>
        </div>
        <p style={{ fontSize: 12.5, color: 'var(--mut)', lineHeight: 1.7, margin: '0 0 18px' }}>
          知识库管理需要登录。请输入服务端 <code style={{ fontFamily: 'ui-monospace, Menlo, monospace', background: 'var(--sel)', padding: '1px 5px', borderRadius: 5 }}>AUTH_TOKEN</code> 令牌。
        </p>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="输入管理令牌"
          autoFocus
          style={{
            width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: 13,
            fontFamily: 'inherit', color: 'var(--fg)', background: 'var(--bg)',
            border: '1px solid var(--bd)', borderRadius: 9, outline: 'none',
          }}
        />
        {error && <div style={{ marginTop: 10, fontSize: 12.5, color: '#dc2626' }}>{error}</div>}
        <Button type="submit" style={{ width: '100%', marginTop: 16, justifyContent: 'center' }} disabled={busy || !token.trim()}>
          {busy ? '登录中…' : '登录'}
        </Button>
      </form>
    </div>
  );
}
