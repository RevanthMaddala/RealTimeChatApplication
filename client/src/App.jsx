import { AuthProvider, useAuth } from './AuthContext.jsx';
import { ChatProvider } from './ChatContext.jsx';
import AuthPage from './components/AuthPage.jsx';
import ChatLayout from './components/ChatLayout.jsx';

function Gate() {
  const { status, user } = useAuth();
  if (status === 'loading') {
    return (
      <div className="splash" role="status" aria-live="polite">
        <div className="spinner" />
        <span>Restoring your session…</span>
      </div>
    );
  }
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
