const KEY = 'ff_admin_token';

export const getToken = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};
export const setToken = (token) => {
  try {
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
};

export class ApiError extends Error {
  constructor(message, { code = 'ERROR', status = 0, detail = null } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

async function request(path, { method = 'GET', body, token = getToken(), raw = false } = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (raw) {
    if (!res.ok) throw new ApiError('Request failed', { status: res.status });
    return res;
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
      window.dispatchEvent(new CustomEvent('ff:admin-unauthorized'));
    }
    throw new ApiError(payload?.error?.message || `Request failed (${res.status})`, {
      code: payload?.error?.code,
      status: res.status,
      detail: payload?.error?.detail,
    });
  }
  return payload;
}

export const api = (path, options) => request(path, options);

export async function download(path, filename) {
  const res = await request(path, { raw: true });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
