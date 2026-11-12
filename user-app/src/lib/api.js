const TOKEN_KEY = 'ff_user_token';

export const getToken = () => localStorageSafe()?.getItem(TOKEN_KEY) || null;
export const setToken = (token) => {
  const ls = localStorageSafe();
  if (!ls) return;
  if (token) ls.setItem(TOKEN_KEY, token);
  else ls.removeItem(TOKEN_KEY);
};

function localStorageSafe() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export class ApiError extends Error {
  constructor(message, { code = 'ERROR', status = 0, detail = null } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export async function api(path, { method = 'GET', body, token = getToken(), headers = {} } = {}) {
  let res;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new ApiError('Network error — the server may be offline.', { code: 'NETWORK', status: 0 });
  }

  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!res.ok) {
    if (res.status === 401) {
      setToken(null);
      window.dispatchEvent(new CustomEvent('ff:unauthorized'));
    }
    throw new ApiError(payload?.error?.message || `Request failed (${res.status})`, {
      code: payload?.error?.code,
      status: res.status,
      detail: payload?.error?.detail,
    });
  }
  return payload;
}

export async function downloadCsv(path, filename) {
  const res = await fetch(`${BASE}/api${path}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new ApiError('Export failed', { status: res.status });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
