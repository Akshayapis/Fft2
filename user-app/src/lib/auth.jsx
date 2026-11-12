import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken } from './api.js';
import { getDeviceInfo } from './device.js';

const AuthContext = createContext(null);

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
        /* keep null; UI degrades gracefully */
      }
      const token = getToken();
      if (!token) {
        if (alive) setLoading(false);
        return;
      }
      try {
        const me = await api('/api/auth/me');
        if (alive) setUser(me.user);
      } catch {
        setToken(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    const onUnauthorized = () => setUser(null);
    window.addEventListener('ff:unauthorized', onUnauthorized);
    return () => {
      alive = false;
      window.removeEventListener('ff:unauthorized', onUnauthorized);
    };
  }, []);

  const login = useCallback(async (email, password) => {
    const res = await api('/api/auth/login', {
      method: 'POST',
      token: null,
      body: { email, password, device: getDeviceInfo() },
    });
    setToken(res.token);
    setUser(res.user);
    return res;
  }, []);

  const register = useCallback(async (payload) => {
    const res = await api('/api/auth/register', {
      method: 'POST',
      token: null,
      body: { ...payload, device: getDeviceInfo() },
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

  const refresh = useCallback(async () => {
    try {
      const me = await api('/api/auth/me');
      setUser(me.user);
      return me.user;
    } catch {
      return null;
    }
  }, []);

  const refreshConfig = useCallback(async () => {
    try {
      const cfg = await api('/api/config', { token: null });
      setConfig(cfg);
      return cfg;
    } catch {
      return null;
    }
  }, []);

  const value = useMemo(
    () => ({ user, setUser, loading, login, register, logout, refresh, config, refreshConfig }),
    [user, loading, login, register, logout, refresh, config, refreshConfig],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
