import { useState } from 'react';
import { useAuth } from '../AuthContext.jsx';

/** Landing page for the emailed reset link. On success the user is signed in. */
export default function ResetPasswordPage({ token, onDone }) {
  const { resetPassword } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    if (password !== confirm) return setError("The passwords don't match");
    setError(null);
    setBusy(true);
    try {
      await resetPassword(token, password);
      onDone();
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
        <p className="auth-sub">Choose a new password</p>

        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}

        <form onSubmit={onSubmit} className="auth-form">
          <label>
            New password
            <input
              autoFocus
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              maxLength={128}
              required
            />
          </label>
          <label>
            Confirm new password
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              minLength={8}
              maxLength={128}
              required
            />
          </label>
          <p className="hint">At least 8 characters. You'll be signed out on all other devices.</p>
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Please wait…' : 'Set new password'}
          </button>
        </form>
        <button type="button" className="link-btn auth-back" onClick={onDone}>
          ← Back to sign in
        </button>
      </div>
    </main>
  );
}
