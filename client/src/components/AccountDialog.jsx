import { useEffect, useState } from 'react';
import { getAccount, updateEmail } from '../api.js';

/** Lets a signed-in user set the recovery email used for password resets. */
export default function AccountDialog({ onClose }) {
  const [current, setCurrent] = useState(undefined); // undefined = loading, null = none set
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getAccount()
      .then((data) => {
        setCurrent(data.email);
        setEmail(data.email ?? '');
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      const data = await updateEmail(email.trim(), password);
      setCurrent(data.email);
      setEmail(data.email);
      setPassword('');
      setSaved(true);
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="account-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="account-title">Account</h2>
        <p className="muted small">
          {current === null && "You haven't added a recovery email, so you can't reset your password if you forget it."}
          {current && 'Password reset links are sent to this address.'}
        </p>
        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}
        {saved && (
          <div className="alert alert-info" role="status">
            Recovery email saved.
          </div>
        )}
        <form className="auth-form" onSubmit={onSubmit}>
          <label>
            Recovery email
            <input autoFocus type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} required />
          </label>
          <label>
            Current password
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={128} required />
          </label>
          <div className="dialog-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Close
            </button>
            <button className="btn btn-primary" disabled={busy || current === undefined}>
              {busy ? 'Saving…' : 'Save email'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
