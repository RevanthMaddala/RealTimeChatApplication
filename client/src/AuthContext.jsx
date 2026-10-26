import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as authApi from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', user: null, notice: null });

  useEffect(() => {
    // Restore the session from the refresh cookie on first load.
    authApi
      .refreshSession()
      .then(({ user }) => setState({ status: 'authenticated', user, notice: null }))
      .catch(() => setState({ status: 'anonymous', user: null, notice: null }));

    // If the token is ever cleared (logout here or in another tab, revoked session,
    // failed refresh) drop back to the sign-in screen.
    return authApi.onTokenChange((token) => {
      if (token) return;
      setState((s) =>
        s.status === 'authenticated' ? { status: 'anonymous', user: null, notice: 'Your session ended. Please sign in again.' } : s,
      );
    });
  }, []);

  const login = useCallback(async (username, password) => {
    const { user } = await authApi.login(username, password);
    setState({ status: 'authenticated', user, notice: null });
  }, []);

  const register = useCallback(async (username, password, displayName, email) => {
    const { user } = await authApi.register(username, password, displayName, email);
    setState({ status: 'authenticated', user, notice: null });
  }, []);

  const resetPassword = useCallback(async (token, password) => {
    const { user } = await authApi.resetPassword(token, password);
    setState({ status: 'authenticated', user, notice: null });
  }, []);

  const logout = useCallback(async () => {
    setState({ status: 'anonymous', user: null, notice: null });
    await authApi.logout().catch(() => {});
  }, []);

  const value = useMemo(
    () => ({ ...state, login, register, resetPassword, logout }),
    [state, login, register, resetPassword, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
