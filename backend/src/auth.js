import { fail, sha256, signToken, uid, verifyToken, now } from './util.js';
import { findUser, securityEvent } from './services.js';
import { notifyUser } from './services.js';

export const SESSION_TTL_DAYS = 30;

export function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.length >= 16) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set (min 16 chars) in production.');
  }
  return 'dev-only-insecure-secret-change-me';
}

function deviceKey(userId, info = {}) {
  const fingerprint =
    info.fingerprint ||
    [info.name, info.os, info.browser, info.model].filter(Boolean).join('|') ||
    'unknown-device';
  return sha256(`${userId}|${fingerprint}`);
}

/**
 * Register (or refresh) the device for this login and create a fresh session.
 * Must be called inside a store transaction.
 */
export async function startSession(data, user, { device = {}, ip = null, userAgent = null } = {}) {
  const key = deviceKey(user.id, device);
  const previousDevices = data.devices.filter((d) => d.userId === user.id);

  let record = previousDevices.find((d) => d.key === key);
  const isNewDevice = !record;

  if (!record) {
    record = {
      id: uid('dev'),
      userId: user.id,
      key,
      name: device.name || 'Unknown device',
      model: device.model || '',
      os: device.os || 'Unknown OS',
      browser: device.browser || 'Web',
      platform: device.platform || 'web',
      ip: ip || null,
      location: device.location || null,
      pushToken: null,
      firstLoginAt: now(),
      lastActiveAt: now(),
      revoked: false,
      createdAt: now(),
    };
    data.devices.push(record);
  } else {
    record.lastActiveAt = now();
    record.ip = ip || record.ip;
    record.revoked = false;
    record.name = device.name || record.name;
    record.os = device.os || record.os;
    record.browser = device.browser || record.browser;
  }

  // One active session per device: revoke previous tokens for this device.
  for (const s of data.sessions) {
    if (s.userId === user.id && s.deviceId === record.id && !s.revoked) {
      s.revoked = true;
      s.revokedAt = now();
      s.revokedReason = 'superseded by new login';
    }
  }

  const jti = uid('sess');
  const session = {
    id: jti,
    userId: user.id,
    deviceId: record.id,
    jti,
    ip: ip || null,
    userAgent: userAgent || null,
    createdAt: now(),
    lastActiveAt: now(),
    expiresAt: new Date(Date.now() + SESSION_TTL_DAYS * 86400_000).toISOString(),
    revoked: false,
  };
  data.sessions.push(session);

  user.lastLoginAt = now();
  user.loginCount = (user.loginCount || 0) + 1;

  const token = signToken({ sub: user.id, role: user.role, jti, did: record.id }, jwtSecret(), SESSION_TTL_DAYS * 86400);

  if (isNewDevice && previousDevices.length > 0) {
    securityEvent(data, user, {
      type: 'new_device_login',
      message: `New login from ${record.name} (${record.os})`,
      deviceId: record.id,
      ip,
      userAgent,
    });
    const deviceLabel = [record.os, record.browser].filter(Boolean).join(' · ') || record.name;
    for (const other of previousDevices) {
      if (other.id === record.id) continue;
      const otherSessions = data.sessions.filter((s) => s.deviceId === other.id && !s.revoked);
      if (!otherSessions.length) continue;
      await notifyUser(data, user.id, {
        title: 'New login detected',
        body: `Your account was accessed from a new device (${deviceLabel}${ip ? `, IP ${ip}` : ''}). If this wasn't you, secure your account immediately.`,
        type: 'security',
        clickAction: '/devices',
        dedupeKey: `new-login:${record.id}:${new Date().toISOString().slice(0, 13)}`,
      });
      break;
    }
  } else if (isNewDevice) {
    securityEvent(data, user, {
      type: 'device_registered',
      message: `Device registered: ${record.name} (${record.os})`,
      deviceId: record.id,
      ip,
      userAgent,
    });
  }

  return { token, session, device: record, isNewDevice };
}

export function sessionTokenFromRequest(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

/** Express middleware: verifies JWT + live session, attaches req.user. */
export function authenticate(store, { requireRole = null } = {}) {
  return async (req, res, next) => {
    try {
      const token = sessionTokenFromRequest(req);
      if (!token) fail(401, 'Authentication required.', 'UNAUTHENTICATED');
      const payload = verifyToken(token, jwtSecret());
      if (!payload) fail(401, 'Invalid or expired session.', 'INVALID_TOKEN');

      const data = store.state;
      const session = data.sessions.find((s) => s.jti === payload.jti);
      if (!session || session.revoked) fail(401, 'This session has been revoked.', 'SESSION_REVOKED');
      if (new Date(session.expiresAt).getTime() < Date.now()) fail(401, 'Session expired.', 'SESSION_EXPIRED');

      const user = findUser(data, payload.sub);
      if (!user) fail(401, 'Account not found.', 'USER_NOT_FOUND');
      if (user.banned) fail(403, 'This account has been blocked.', 'ACCOUNT_BLOCKED');
      if (requireRole && user.role !== requireRole) {
        fail(403, 'Administrator privileges required.', 'FORBIDDEN');
      }

      if (Date.now() - new Date(session.lastActiveAt).getTime() > 60_000) {
        await store.tx((d) => {
          const s = d.sessions.find((x) => x.jti === payload.jti);
          if (s) s.lastActiveAt = now();
          const dv = d.devices.find((x) => x.id === session.deviceId);
          if (dv) dv.lastActiveAt = now();
        });
      }

      req.user = user;
      req.session = session;
      req.device = data.devices.find((d) => d.id === session.deviceId) || null;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) return forwarded.split(',')[0].trim();
  return (req.ip || '').replace('::ffff:', '') || null;
}
