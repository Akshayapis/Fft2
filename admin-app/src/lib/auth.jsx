import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken } from './api.js';

const AuthContext = createContext(null);

const device = () => ({
  name: 'Admin Console',
  os: navigator.platform || 'Web',
  browser: 'Admin Console',
  platform: 'desktop',
  fingerprint: localStorage.getItem('ff_admin_fp') || (() => {
    const fp = `admin-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    try {
      localStorage.setItem('ff_admin_fp', fp);
    } catch {
      /* ignore */
    }
    return fp;
  })(),
});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const cfg = await api('/api/config', { token: null });
        if (alive) setConfig(cfg);
      } catch {
        /* ignore */
      }
      if (!getToken()) {
        if (alive) setLoading(false);
        return;
      }
      try {
        const me = await api('/api/auth/me');
        if (me.user.role !== 'admin') {
          setToken(null);
          if (alive) setUser(null);
        } else if (alive) {
          setUser(me.user);
        }
      } catch {
        setToken(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    const onUnauthorized = () => setUser(null);
    window.addEventListener('ff:admin-unauthorized', onUnauthorized);
    return () => {
      alive = false;
      window.removeEventListener('ff:admin-unauthorized', onUnauthorized);
    };
  }, []);

  const login = useCallback(async (email, password) => {
    const res = await api('/api/admin/auth/login', {
      method: 'POST',
      token: null,
      body: { email, password, device: device() },
    });
    setToken(res.token);
    setUser(res.user);
    return res;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      /* ignore */
    }
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, setUser, loading, login, logout, config, setConfig }),
    [user, loading, login, logout, config],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
