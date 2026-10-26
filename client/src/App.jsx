import { useState } from 'react';
import { AuthProvider, useAuth } from './AuthContext.jsx';
import { ChatProvider } from './ChatContext.jsx';
import AuthPage from './components/AuthPage.jsx';
import ChatLayout from './components/ChatLayout.jsx';
import ResetPasswordPage from './components/ResetPasswordPage.jsx';

/**
 * Picks the token out of an emailed /reset-password#token=… link, then strips it from
 * the address bar so it doesn't linger in history or get copied along with the URL.
 * Runs once at module load: it mutates the URL, so it can't be a (StrictMode
 * double-invoked) state initialiser.
 */
function takeResetToken() {
  if (window.location.pathname !== '/reset-password') return null;
  const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
  window.history.replaceState(null, '', '/');
  return token;
}
const initialResetToken = takeResetToken();

function Gate() {
  const { status, user } = useAuth();
  const [resetToken, setResetToken] = useState(initialResetToken);
  if (status === 'loading') {
    return (
      <div className="splash" role="status" aria-live="polite">
        <div className="spinner" />
        <span>Restoring your session…</span>
      </div>
    );
  }
  if (resetToken) return <ResetPasswordPage token={resetToken} onDone={() => setResetToken(null)} />;
  if (status !== 'authenticated') return <AuthPage />;
  return (
    // Keyed by user so switching accounts always starts from a clean socket + state.
    <ChatProvider key={user.id}>
      <ChatLayout />
    </ChatProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
