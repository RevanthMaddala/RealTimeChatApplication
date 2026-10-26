import { useState } from 'react';
import { useAuth } from '../AuthContext.jsx';
import { requestPasswordReset } from '../api.js';

function Brand() {
  return (
    <div className="brand brand-lg">
      <span className="brand-mark" aria-hidden="true">
        R
      </span>
      Relay
    </div>
  );
}

function ForgotPasswordForm({ initialEmail, onBack }) {
  const [email, setEmail] = useState(initialEmail);
  const [sentTo, setSentTo] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await requestPasswordReset(email.trim());
      setSentTo(email.trim());
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="auth-sub">Reset your password</p>
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      {sentTo ? (
        <div className="alert alert-info" role="status">
          If an account uses <strong>{sentTo}</strong>, we've sent it a link to reset the password. The link expires in 30 minutes.
        </div>
      ) : (
        <form onSubmit={onSubmit} className="auth-form">
          <label>
            Email
            <input autoFocus type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} required />
          </label>
          <p className="hint">We'll email you a link to choose a new password.</p>
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Please wait…' : 'Send reset link'}
          </button>
        </form>
      )}
      <button type="button" className="link-btn auth-back" onClick={onBack}>
        ← Back to sign in
      </button>
    </>
  );
}

export default function AuthPage() {
  const { login, register, notice } = useAuth();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ username: '', email: '', password: '', displayName: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  const isRegister = mode === 'register';

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (isRegister) await register(form.username.trim(), form.password, form.displayName.trim(), form.email.trim());
      else await login(form.username.trim(), form.password);
    } catch (err) {
      setError(err.message || 'Something went wrong');
      setBusy(false);
    }
  }

  if (mode === 'forgot') {
    return (
      <main className="auth">
        <div className="auth-card">
          <Brand />
          <ForgotPasswordForm initialEmail={form.email} onBack={() => setMode('login')} />
        </div>
      </main>
    );
  }

  return (
    <main className="auth">
      <div className="auth-card">
        <Brand />
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
            <>
              <label>
                Email
                <input type="email" autoComplete="email" value={form.email} onChange={update('email')} maxLength={254} required />
              </label>
              <label>
                Display name <span className="muted">(optional)</span>
                <input autoComplete="name" value={form.displayName} onChange={update('displayName')} maxLength={40} />
              </label>
            </>
          )}
          <label>
            <span className="label-row">
              Password
              {!isRegister && (
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    setMode('forgot');
                    setError(null);
                  }}
                >
                  Forgot password?
                </button>
              )}
            </span>
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
          {isRegister && <p className="hint">At least 8 characters. Your email is only used to reset your password.</p>}
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Please wait…' : isRegister ? 'Create account' : 'Sign in'}
          </button>
        </form>
      </div>
    </main>
  );
}
