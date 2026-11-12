import express from 'express';
import bcrypt from 'bcryptjs';
import { authenticate, clientIp, startSession } from '../auth.js';
import {
  addTransaction,
  findUser,
  notifyUser,
  securityEvent,
} from '../services.js';
import {
  createRateLimiter,
  fail,
  isEmail,
  now,
  publicUser,
  requireFields,
  uid,
} from '../util.js';

const loginLimiter = createRateLimiter({ windowMs: 60_000, max: 20 });
const registerLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });

const DEVICE_FALLBACK = { name: 'Web browser', os: 'Unknown OS', browser: 'Web' };

function parseDevice(value) {
  if (!value || typeof value !== 'object') return DEVICE_FALLBACK;
  const clean = (v, max = 60) => (typeof v === 'string' ? v.slice(0, max) : undefined);
  return {
    name: clean(value.name) || DEVICE_FALLBACK.name,
    model: clean(value.model) || '',
    os: clean(value.os) || DEVICE_FALLBACK.os,
    browser: clean(value.browser) || DEVICE_FALLBACK.browser,
    platform: clean(value.platform) || 'web',
    fingerprint: clean(value.fingerprint, 128) || '',
    location: clean(value.location) || null,
  };
}

function startNode(req, res, next) {
  res.locals.node = req.body?.node || null;
  next();
}

export default function authRoutes(store) {
  const router = express.Router();
  const auth = authenticate(store);

  router.post('/register', startNode, async (req, res, next) => {
    try {
      registerLimiter(clientIp(req) || 'unknown');
      const { email, password, username, gameUid, phone, device } = req.body || {};
      requireFields(req.body || {}, ['email', 'password', 'username']);
      if (!isEmail(email)) fail(400, 'Enter a valid email address.', 'INVALID_EMAIL');
      if (String(password).length < 8) fail(400, 'Password must be at least 8 characters.', 'WEAK_PASSWORD');
      if (!/^[a-zA-Z0-9_. ]{3,24}$/.test(String(username).trim())) {
        fail(400, 'Username must be 3-24 characters (letters, numbers, spaces, . or _).', 'INVALID_USERNAME');
      }
      if (!store.state.config.allowRegistration) fail(403, 'Registrations are temporarily closed.', 'REGISTRATION_CLOSED');

      const result = await store.tx(async (data) => {
        const lower = String(email).trim().toLowerCase();
        if (data.users.some((u) => u.email === lower)) fail(409, 'An account with this email already exists.', 'EMAIL_TAKEN');
        if (data.users.some((u) => u.username.toLowerCase() === String(username).trim().toLowerCase())) {
          fail(409, 'That username is already taken.', 'USERNAME_TAKEN');
        }

        const user = {
          id: uid('usr'),
          email: lower,
          passwordHash: bcrypt.hashSync(String(password), 10),
          username: String(username).trim(),
          role: 'user',
          gameUid: String(gameUid || '').slice(0, 32),
          phone: String(phone || '').slice(0, 20),
          avatar: '',
          bio: '',
          banned: false,
          createdAt: now(),
          wallet: { balance: 0, winning: 0, totalDeposited: 0, totalWithdrawn: 0, totalWon: 0 },
          stats: { matchesPlayed: 0, wins: 0, kills: 0, prizeWon: 0 },
          prefs: { pushEnabled: true, emailNotifications: true, privateProfile: false },
        };
        data.users.push(user);

        const bonus = Number(data.config.registrationBonus) || 0;
        if (bonus > 0) {
          user.wallet.balance = bonus;
          addTransaction(data, {
            userId: user.id,
            type: 'bonus',
            direction: 'credit',
            bucket: 'balance',
            amount: bonus,
            description: 'Welcome registration bonus',
          });
        }

        const session = await startSession(data, user, {
          device: parseDevice(device),
          ip: clientIp(req),
          userAgent: req.headers['user-agent'] || null,
        });

        const notification = await notifyUser(data, user.id, {
          title: 'Welcome to the arena! 🔥',
          body: `Welcome to ${data.config.appName}! Your account has been successfully created. Start exploring tournaments!`,
          type: 'welcome',
          clickAction: '/matches',
          dedupeKey: `welcome:${user.id}`,
        });

        securityEvent(data, user, {
          type: 'account_created',
          message: `Account created and signed in from ${session.device.name}`,
          deviceId: session.device.id,
          ip: clientIp(req),
          userAgent: req.headers['user-agent'] || null,
        });

        return { token: session.token, user, notification };
      });

      res.status(201).json({
        token: result.token,
        user: publicUser(result.user),
        welcomeNotification: result.notification,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/login', startNode, async (req, res, next) => {
    try {
      const { email, password, device, expectedRole } = req.body || {};
      requireFields(req.body || {}, ['email', 'password']);
      loginLimiter(`${clientIp(req)}:${String(email).toLowerCase()}`);

      const result = await store.tx(async (data) => {
        const lower = String(email).trim().toLowerCase();
        const user = data.users.find((u) => u.email === lower);
        if (!user || !bcrypt.compareSync(String(password), user.passwordHash)) {
          fail(401, 'Incorrect email or password.', 'INVALID_CREDENTIALS');
        }
        if (user.banned) fail(403, 'This account has been blocked. Contact support.', 'ACCOUNT_BLOCKED');
        if (expectedRole === 'admin' && user.role !== 'admin') {
          fail(403, 'This account does not have admin access.', 'FORBIDDEN');
        }
        const session = await startSession(data, user, {
          device: parseDevice(device),
          ip: clientIp(req),
          userAgent: req.headers['user-agent'] || null,
        });
        return { token: session.token, user, isNewDevice: session.isNewDevice };
      });

      res.json({ token: result.token, user: publicUser(result.user), newDevice: result.isNewDevice });
    } catch (error) {
      next(error);
    }
  });

  router.post('/logout', auth, async (req, res, next) => {
    try {
      await store.tx((data) => {
        const session = data.sessions.find((s) => s.jti === req.session.jti);
        if (session) {
          session.revoked = true;
          session.revokedAt = now();
          session.revokedReason = 'user logout';
        }
      });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.post('/password', auth, async (req, res, next) => {
    try {
      requireFields(req.body || {}, ['currentPassword', 'newPassword']);
      if (String(req.body.newPassword).length < 8) fail(400, 'New password must be at least 8 characters.', 'WEAK_PASSWORD');
      await store.tx(async (data) => {
        const user = findUser(data, req.user.id);
        if (!bcrypt.compareSync(String(req.body.currentPassword), user.passwordHash)) {
          fail(401, 'Current password is incorrect.', 'INVALID_PASSWORD');
        }
        user.passwordHash = bcrypt.hashSync(String(req.body.newPassword), 10);
        for (const s of data.sessions) {
          if (s.userId === user.id && s.jti !== req.session.jti && !s.revoked) {
            s.revoked = true;
            s.revokedAt = now();
            s.revokedReason = 'password changed';
          }
        }
        securityEvent(data, user, {
          type: 'password_changed',
          message: 'Password changed. Other sessions were signed out.',
          deviceId: req.session.deviceId,
          ip: clientIp(req),
        });
        await notifyUser(data, user.id, {
          title: 'Password updated',
          body: 'Your password was changed successfully. All other devices have been signed out.',
          type: 'security',
          clickAction: '/devices',
          dedupeKey: `password:${user.id}:${Date.now()}`,
        });
      });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.get('/me', auth, async (req, res) => {
    res.json({
      user: publicUser(req.user),
      session: { id: req.session.id, deviceId: req.session.deviceId, createdAt: req.session.createdAt },
      device: req.device
        ? {
            id: req.device.id,
            name: req.device.name,
            os: req.device.os,
            browser: req.device.browser,
            current: true,
          }
        : null,
    });
  });

  return router;
}
