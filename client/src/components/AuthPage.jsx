import { useState } from 'react';
import { useAuth } from '../AuthContext.jsx';

export default function AuthPage() {
  const { login, register, notice } = useAuth();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ username: '', password: '', displayName: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  const isRegister = mode === 'register';

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (isRegister) await register(form.username.trim(), form.password, form.displayName.trim());
      else await login(form.username.trim(), form.password);
    } catch (err) {
      setError(err.message || 'Something went wrong');
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <div className="auth-card">
        <div className="brand brand-lg">
          <span className="brand-mark" aria-hidden="true">
            R
          </span>
          Relay
        </div>
        <p className="auth-sub">Real-time chat for teams. {isRegister ? 'Create an account to get started.' : 'Welcome back.'}</p>

        <div className="segmented" role="tablist">
          {['login', 'register'].map((m) => (
            <button
              key={m}
              role="tab"
              type="button"
              aria-selected={mode === m}
              className={mode === m ? 'active' : ''}
              onClick={() => {
                setMode(m);
                setError(null);
              }}
            >
              {m === 'login' ? 'Sign in' : 'Create account'}
            </button>
          ))}
        </div>

        {notice && !error && <div className="alert alert-info">{notice}</div>}
        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}

        <form onSubmit={onSubmit} className="auth-form">
          <label>
            Username
            <input
              autoFocus
              autoComplete="username"
              value={form.username}
              onChange={update('username')}
              pattern="[A-Za-z0-9_]{3,20}"
              title="3-20 letters, numbers or underscores"
              required
            />
          </label>
          {isRegister && (
            <label>
              Display name <span className="muted">(optional)</span>
              <input autoComplete="name" value={form.displayName} onChange={update('displayName')} maxLength={40} />
            </label>
          )}
          <label>
            Password
            <input
              type="password"
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              value={form.password}
              onChange={update('password')}
              minLength={isRegister ? 8 : undefined}
              maxLength={128}
              required
            />
          </label>
          {isRegister && <p className="hint">At least 8 characters.</p>}
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Please wait…' : isRegister ? 'Create account' : 'Sign in'}
          </button>
        </form>
      </div>
    </main>
  );
}
