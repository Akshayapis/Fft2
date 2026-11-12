import crypto from 'node:crypto';

export const now = () => new Date().toISOString();
export const uid = (prefix) => `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
export const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

export function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

export function signToken(payload, secret, ttlSeconds = 60 * 60 * 24 * 30) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const iat = Math.floor(Date.now() / 1000);
  const body = b64url(JSON.stringify({ ...payload, iat, exp: iat + ttlSeconds }));
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

export function verifyToken(token, secret) {
  if (typeof token !== 'string' || token.split('.').length !== 3) return null;
  const [header, body, signature] = token.split('.');
  const expected = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export class HttpError extends Error {
  constructor(status, message, code = 'ERROR', detail = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export const fail = (status, message, code, detail) => {
  throw new HttpError(status, message, code, detail);
};

export const toInt = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : fallback;
};

export const toAmount = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
};

export function requireFields(body, fields) {
  const missing = fields.filter((f) => body?.[f] === undefined || body?.[f] === null || body?.[f] === '');
  if (missing.length) fail(400, `Missing required field(s): ${missing.join(', ')}`, 'VALIDATION_ERROR', { missing });
}

export const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || ''));

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    role: user.role,
    gameUid: user.gameUid || '',
    phone: user.phone || '',
    avatar: user.avatar || '',
    bio: user.bio || '',
    banned: !!user.banned,
    createdAt: user.createdAt,
    wallet: { ...user.wallet },
    stats: { ...user.stats },
    prefs: { ...user.prefs },
  };
}

export function maskEmail(email) {
  const [name, domain] = String(email || '').split('@');
  if (!domain) return '***';
  return `${name.slice(0, 2)}***@${domain}`;
}

/** Simple sliding-window in-memory rate limiter (per key). */
export function createRateLimiter({ windowMs = 60_000, max = 30 } = {}) {
  const hits = new Map();
  return function limit(key) {
    const nowMs = Date.now();
    const bucket = hits.get(key)?.filter((t) => nowMs - t < windowMs) || [];
    bucket.push(nowMs);
    hits.set(key, bucket);
    if (bucket.length > max) fail(429, 'Too many requests, please slow down.', 'RATE_LIMITED');
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (!v.some((t) => nowMs - t < windowMs)) hits.delete(k);
    }
  };
}

export const csvEscape = (value) => {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const toCsv = (rows, columns) => {
  const head = columns.map((c) => csvEscape(c.label)).join(',');
  const body = rows.map((row) => columns.map((c) => csvEscape(c.get(row))).join(',')).join('\n');
  return `${head}\n${body}\n`;
};
