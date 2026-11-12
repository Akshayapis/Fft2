import express from 'express';
import bcrypt from 'bcryptjs';
import { authenticate, clientIp, startSession } from '../auth.js';
import {
  addTransaction,
  canRegister,
  cancelMatch,
  creditWallet,
  debitWallet,
  distributePrizes,
  findMatch,
  findUser,
  matchParticipant,
  notifyUser,
  presentMatch,
  refreshMatchStatus,
  retryFailedPayout,
  runMaintenance,
  securityEvent,
} from '../services.js';
import { getPushStatus } from '../push.js';
import {
  csvEscape,
  fail,
  now,
  publicUser,
  requireFields,
  toAmount,
  toCsv,
  toInt,
  uid,
} from '../util.js';

const MODES = ['solo', 'duo', 'squad', 'clash'];
const MATCH_STATUSES = [
  'registration_open',
  'paused',
  'registration_closed',
  'live',
  'completed',
  'cancelled',
  'expired',
];

function parseDate(value, field) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) fail(400, `Invalid ${field}.`, 'INVALID_DATE', { field });
  return d.toISOString();
}

function matchPayload(body, { partial = false, existing = null } = {}) {
  const out = {};
  const set = (key, transform) => {
    if (body[key] !== undefined) out[key] = transform(body[key]);
  };

  if (!partial || body.title !== undefined) {
    const title = String(body.title || '').trim();
    if (title.length < 3) fail(400, 'Match title must be at least 3 characters.', 'INVALID_TITLE');
    out.title = title.slice(0, 120);
  }
  if (!partial || body.mode !== undefined) {
    const mode = String(body.mode || 'solo').toLowerCase();
    if (!MODES.includes(mode)) fail(400, `Mode must be one of: ${MODES.join(', ')}`, 'INVALID_MODE');
    out.mode = mode;
  }
  set('map', (v) => String(v || 'Bermuda').slice(0, 40));
  set('rules', (v) => String(v || '').slice(0, 4000));
  set('banner', (v) => String(v || '').slice(0, 500));
  set('roomId', (v) => String(v || '').slice(0, 60));
  set('roomPassword', (v) => String(v || '').slice(0, 60));
  set('entryFee', (v) => {
    const n = toAmount(v);
    if (n === null) fail(400, 'Entry fee must be a positive number.', 'INVALID_ENTRY_FEE');
    return n;
  });
  set('prizePool', (v) => {
    const n = toAmount(v);
    if (n === null) fail(400, 'Prize pool must be a positive number.', 'INVALID_PRIZE_POOL');
    return n;
  });
  set('perKill', (v) => {
    const n = toAmount(v);
    if (n === null) fail(400, 'Per-kill amount is invalid.', 'INVALID_PER_KILL');
    return n;
  });
  set('totalSlots', (v) => {
    const n = toInt(v, 0);
    if (n < 1 || n > 1000) fail(400, 'Total slots must be between 1 and 1000.', 'INVALID_SLOTS');
    return n;
  });
  set('startTime', (v) => parseDate(v, 'start time'));
  set('registrationCloseTime', (v) => parseDate(v, 'registration close time'));
  set('expiryTime', (v) => parseDate(v, 'expiry time'));
  set('refundDeadline', (v) => parseDate(v, 'refund deadline'));
  if (body.autoRefund !== undefined) out.autoRefund = !!body.autoRefund;
  if (body.registrationPaused !== undefined) out.registrationPaused = !!body.registrationPaused;

  const merged = { ...(existing || {}), ...out };
  if (existing && out.totalSlots !== undefined && out.totalSlots < existing.participants.length) {
    fail(400, `Slots cannot be below the ${existing.participants.length} players already registered.`, 'SLOTS_TOO_LOW');
  }
  if (existing && existing.participants.length > 0 && out.entryFee !== undefined && out.entryFee !== existing.entryFee) {
    fail(409, 'Entry fee cannot be changed after players have joined.', 'ENTRY_FEE_LOCKED');
  }
  if (merged.startTime && merged.registrationCloseTime && new Date(merged.registrationCloseTime) > new Date(merged.startTime)) {
    fail(400, 'Registration must close before the match starts.', 'INVALID_TIMES');
  }
  if (merged.startTime && merged.expiryTime && new Date(merged.expiryTime) <= new Date(merged.startTime)) {
    fail(400, 'Expiry time must be after the match start time.', 'INVALID_TIMES');
  }
  if (merged.prizePool !== undefined && merged.entryFee !== undefined && merged.prizePool < 0) {
    fail(400, 'Prize pool is invalid.', 'INVALID_PRIZE_POOL');
  }
  return out;
}

export default function adminRoutes(store) {
  const router = express.Router();
  const adminOnly = authenticate(store, { requireRole: 'admin' });

  /* ------------------------------- Auth ---------------------------------- */

  router.post('/auth/login', async (req, res, next) => {
    try {
      requireFields(req.body || {}, ['email', 'password']);
      const result = await store.tx(async (data) => {
        const user = data.users.find((u) => u.email === String(req.body.email).trim().toLowerCase());
        if (!user || !bcrypt.compareSync(String(req.body.password), user.passwordHash)) {
          fail(401, 'Incorrect email or password.', 'INVALID_CREDENTIALS');
        }
        if (user.role !== 'admin') fail(403, 'This account does not have admin access.', 'FORBIDDEN');
        if (user.banned) fail(403, 'This admin account is blocked.', 'ACCOUNT_BLOCKED');
        const session = await startSession(data, user, {
          device: req.body.device,
          ip: clientIp(req),
          userAgent: req.headers['user-agent'] || null,
        });
        securityEvent(data, user, {
          type: 'admin_login',
          message: `Admin signed in from ${session.device.name}`,
          deviceId: session.device.id,
          ip: clientIp(req),
        });
        return { token: session.token, user };
      });
      res.json({ token: result.token, user: publicUser(result.user) });
    } catch (error) {
      next(error);
    }
  });

  /* ------------------------------ Overview -------------------------------- */

  function financeSummary(data) {
    const approvedDeposits = data.deposits.filter((d) => d.status === 'approved').reduce((s, d) => s + d.amount, 0);
    const paidWithdrawals = data.withdrawals.filter((w) => w.status === 'paid').reduce((s, w) => s + w.amount, 0);
    const entryFees = data.transactions
      .filter((t) => t.type === 'entry_fee' && t.status === 'completed')
      .reduce((s, t) => s + t.amount, 0);
    const refunds = data.transactions.filter((t) => t.type === 'refund').reduce((s, t) => s + t.amount, 0);
    const prizes = data.transactions.filter((t) => t.type === 'prize').reduce((s, t) => s + t.amount, 0);
    const bonuses = data.transactions.filter((t) => t.type === 'bonus').reduce((s, t) => s + t.amount, 0);
    return {
      approvedDeposits,
      paidWithdrawals,
      entryFees,
      refunds,
      prizes,
      bonuses,
      revenue: Math.round((entryFees - refunds - prizes + bonuses * 0) * 100) / 100,
      pendingDeposits: data.deposits.filter((d) => d.status === 'pending').length,
      pendingWithdrawals: data.withdrawals.filter((w) => w.status === 'pending').length,
      pendingDepositAmount: data.deposits.filter((d) => d.status === 'pending').reduce((s, d) => s + d.amount, 0),
      pendingWithdrawalAmount: data.withdrawals.filter((w) => w.status === 'pending').reduce((s, w) => s + w.amount, 0),
    };
  }

  router.get('/overview', adminOnly, async (req, res, next) => {
    try {
      const data = store.state;
      const push = await getPushStatus();
      const users = data.users.filter((u) => u.role === 'user');
      const days = [...Array(7)].map((_, i) => {
        const day = new Date(Date.now() - (6 - i) * 86400_000).toISOString().slice(0, 10);
        return {
          date: day,
          signups: users.filter((u) => u.createdAt.slice(0, 10) === day).length,
          deposits: data.deposits
            .filter((d) => d.status === 'approved' && d.createdAt.slice(0, 10) === day)
            .reduce((s, d) => s + d.amount, 0),
          matches: data.matches.filter((m) => m.createdAt.slice(0, 10) === day).length,
        };
      });
      res.json({
        totals: {
          users: users.length,
          activeUsers7d: users.filter((u) => new Date(u.lastLoginAt || 0) > Date.now() - 7 * 86400_000).length,
          bannedUsers: users.filter((u) => u.banned).length,
          matches: data.matches.filter((m) => !m.deletedAt).length,
          liveMatches: data.matches.filter((m) => m.status === 'live').length,
          completedMatches: data.matches.filter((m) => m.status === 'completed').length,
          openTickets: data.supportTickets.filter((t) => t.status !== 'closed').length,
          activeDevices: data.devices.filter((d) => !d.revoked).length,
          activeSessions: data.sessions.filter((s) => !s.revoked && new Date(s.expiresAt) > Date.now()).length,
        },
        finance: financeSummary(data),
        push,
        charts: days,
        recent: {
          users: [...users].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5)
            .map((u) => ({ id: u.id, username: u.username, email: u.email, createdAt: u.createdAt, banned: u.banned })),
          matches: data.matches
            .filter((m) => !m.deletedAt)
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, 5)
            .map((m) => ({ id: m.id, title: m.title, status: m.status, startTime: m.startTime, filled: m.participants.length, slots: m.totalSlots })),
          deposits: data.deposits.filter((d) => d.status === 'pending').slice(0, 5),
          withdrawals: data.withdrawals.filter((w) => w.status === 'pending').slice(0, 5),
        },
      });
    } catch (error) {
      next(error);
    }
  });

  /* -------------------------------- Users --------------------------------- */

  router.get('/users', adminOnly, (req, res) => {
    const data = store.state;
    const q = String(req.query.q || '').toLowerCase();
    const rows = data.users
      .filter((u) => {
        if (req.query.role && u.role !== req.query.role) return false;
        if (!q) return true;
        return u.email.includes(q) || u.username.toLowerCase().includes(q) || (u.gameUid || '').includes(q);
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((u) => ({
        ...publicUser(u),
        lastLoginAt: u.lastLoginAt || null,
        loginCount: u.loginCount || 0,
        devices: data.devices.filter((d) => d.userId === u.id && !d.revoked).length,
        matchesJoined: data.matches.filter((m) => matchParticipant(m, u.id)).length,
      }));
    res.json({ users: rows });
  });

  router.get('/users/:id', adminOnly, (req, res, next) => {
    try {
      const data = store.state;
      const user = findUser(data, req.params.id);
      if (!user) fail(404, 'User not found.', 'NOT_FOUND');
      res.json({
        user: publicUser(user),
        devices: data.devices.filter((d) => d.userId === user.id),
        sessions: data.sessions.filter((s) => s.userId === user.id),
        transactions: data.transactions.filter((t) => t.userId === user.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
        deposits: data.deposits.filter((d) => d.userId === user.id),
        withdrawals: data.withdrawals.filter((w) => w.userId === user.id),
        matches: data.matches.filter((m) => matchParticipant(m, user.id)).map((m) => {
          const p = matchParticipant(m, user.id);
          return { matchId: m.id, title: m.title, status: m.status, rank: p.rank, prize: p.prize, refunded: p.refunded };
        }),
        securityEvents: data.securityEvents.filter((e) => e.userId === user.id).slice(-50),
      });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/users/:id', adminOnly, async (req, res, next) => {
    try {
      const { banned, note } = req.body || {};
      const updated = await store.tx(async (data) => {
        const user = findUser(data, req.params.id);
        if (!user) fail(404, 'User not found.', 'NOT_FOUND');
        if (user.role === 'admin' && user.id === req.user.id && banned) {
          fail(400, 'You cannot block your own admin account.', 'FORBIDDEN');
        }
        if (typeof banned === 'boolean') {
          user.banned = banned;
          user.bannedAt = banned ? now() : null;
          user.bannedReason = banned ? String(note || '').slice(0, 200) : null;
          if (banned) {
            for (const s of data.sessions) {
              if (s.userId === user.id && !s.revoked) {
                s.revoked = true;
                s.revokedAt = now();
                s.revokedReason = 'account blocked by admin';
              }
            }
          }
          securityEvent(data, user, {
            type: banned ? 'account_blocked' : 'account_unblocked',
            message: banned ? `Account blocked: ${note || 'policy violation'}` : 'Account unblocked by admin',
            ip: clientIp(req),
          });
        }
        if (note !== undefined) user.adminNote = String(note).slice(0, 500);
        user.updatedAt = now();
        return user;
      });
      res.json({ user: publicUser(updated) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/users/:id/adjust', adminOnly, async (req, res, next) => {
    try {
      requireFields(req.body || {}, ['amount', 'reason']);
      const amount = toAmount(req.body.amount);
      if (!amount || amount <= 0) fail(400, 'Enter a valid amount.', 'INVALID_AMOUNT');
      const direction = req.body.direction === 'debit' ? 'debit' : 'credit';
      const bucket = req.body.bucket === 'winning' ? 'winning' : 'balance';
      const result = await store.tx(async (data) => {
        const user = findUser(data, req.params.id);
        if (!user) fail(404, 'User not found.', 'NOT_FOUND');
        const tx = direction === 'credit'
          ? creditWallet(data, user, bucket, amount, {
              type: 'admin_adjust',
              description: `Admin adjustment: ${req.body.reason}`,
              adminId: req.user.id,
            })
          : debitWallet(data, user, bucket, amount, {
              type: 'admin_adjust',
              description: `Admin adjustment: ${req.body.reason}`,
              adminId: req.user.id,
            });
        await notifyUser(data, user.id, {
          title: direction === 'credit' ? 'Wallet credited' : 'Wallet adjusted',
          body: `An admin ${direction === 'credit' ? `credited ₹${amount}` : `debited ₹${amount}`} to your wallet. Reason: ${req.body.reason}`,
          type: 'wallet',
          clickAction: '/wallet',
          dedupeKey: `adjust:${tx.id}`,
        });
        return { user, tx };
      });
      res.json({ user: publicUser(result.user), transaction: result.tx });
    } catch (error) {
      next(error);
    }
  });

  /* ------------------------------- Matches -------------------------------- */

  router.get('/matches', adminOnly, (req, res) => {
    const data = store.state;
    const includeDeleted = req.query.includeDeleted === 'true';
    const rows = data.matches
      .filter((m) => (includeDeleted ? true : !m.deletedAt))
      .map((m) => refreshMatchStatus(m))
      .filter((m) => !req.query.status || m.status === req.query.status)
      .sort((a, b) => new Date(b.startTime || 0) - new Date(a.startTime || 0))
      .map((m) => ({
        ...presentMatch(m, req.user),
        roomId: m.roomId,
        roomPassword: m.roomPassword,
        deletedAt: m.deletedAt || null,
        autoRefund: m.autoRefund !== false,
        refundSummary: m.refundSummary || null,
        distributionIds: m.distributionIds || [],
      }));
    res.json({ matches: rows });
  });

  router.post('/matches', adminOnly, async (req, res, next) => {
    try {
      requireFields(req.body || {}, ['title', 'startTime', 'totalSlots', 'entryFee', 'prizePool']);
      const payload = matchPayload(req.body);
      const match = await store.tx((data) => {
        const record = {
          id: uid('mat'),
          ...payload,
          mode: payload.mode || 'solo',
          map: payload.map || 'Bermuda',
          perKill: payload.perKill || 0,
          rules: payload.rules || '',
          banner: payload.banner || '',
          roomId: payload.roomId || '',
          roomPassword: payload.roomPassword || '',
          registrationCloseTime: payload.registrationCloseTime || payload.startTime,
          expiryTime: payload.expiryTime || new Date(new Date(payload.startTime).getTime() + 3 * 3600_000).toISOString(),
          refundDeadline: payload.refundDeadline || null,
          autoRefund: payload.autoRefund !== false,
          status: 'registration_open',
          registrationPaused: false,
          registrationClosed: false,
          resultsPublished: false,
          prizesDistributed: false,
          participants: [],
          activity: [{ at: now(), actorId: req.user.id, action: 'created', detail: 'Match created' }],
          createdBy: req.user.id,
          createdAt: now(),
        };
        data.matches.push(record);
        return record;
      });
      res.status(201).json({ match: match });
    } catch (error) {
      next(error);
    }
  });

  router.get('/matches/:id', adminOnly, (req, res, next) => {
    try {
      const match = findMatch(store.state, req.params.id);
      if (!match) fail(404, 'Match not found.', 'NOT_FOUND');
      refreshMatchStatus(match);
      res.json({
        match: {
          ...presentMatch(match, req.user),
          roomId: match.roomId,
          roomPassword: match.roomPassword,
          participants: match.participants,
          activity: match.activity,
          refundSummary: match.refundSummary || null,
          distributions: store.state.distributions.filter((d) => d.matchId === match.id),
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/matches/:id', adminOnly, async (req, res, next) => {
    try {
      const result = await store.tx(async (data) => {
        const match = findMatch(data, req.params.id);
        if (!match) fail(404, 'Match not found.', 'NOT_FOUND');
        const payload = matchPayload(req.body, { partial: true, existing: match });
        const changes = {};
        for (const [key, value] of Object.entries(payload)) {
          if (match[key] !== value) changes[key] = { from: match[key], to: value };
        }
        Object.assign(match, payload);
        if (typeof req.body.registrationPaused === 'boolean') {
          match.registrationPaused = req.body.registrationPaused;
          match.status = req.body.registrationPaused ? 'paused' : 'registration_open';
        }
        const meaningful = ['roomId', 'roomPassword', 'startTime', 'map', 'title', 'rules'].filter((k) => changes[k]);
        if (Object.keys(changes).length) {
          match.updateHistory = match.updateHistory || [];
          match.updateHistory.push({ at: now(), actorId: req.user.id, changes });
          match.activity.push({
            at: now(),
            actorId: req.user.id,
            action: 'updated',
            detail: `Updated: ${Object.keys(changes).join(', ')}`,
          });
        }
        if (meaningful.length && match.participants.length) {
          for (const participant of match.participants) {
            await notifyUser(data, participant.userId, {
              title: 'Match room updated',
              body: `Your tournament "${match.title}" details have changed. Open My Matches to view the latest information.`,
              type: 'match',
              matchId: match.id,
              clickAction: '/my-matches',
              dedupeKey: `match-update:${match.id}:${Date.now()}`,
            });
          }
        }
        refreshMatchStatus(match);
        return match;
      });
      res.json({ match: result });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/matches/:id', adminOnly, async (req, res, next) => {
    try {
      const result = await store.tx((data) => {
        const match = findMatch(data, req.params.id);
        if (!match) fail(404, 'Match not found.', 'NOT_FOUND');
        const hasFinancials =
          match.participants.length > 0 ||
          data.transactions.some((t) => t.matchId === match.id) ||
          data.distributions.some((d) => d.matchId === match.id);
        if (hasFinancials) {
          match.deletedAt = now();
          match.deletedBy = req.user.id;
          match.status = match.status === 'live' ? 'cancelled' : match.status;
          match.activity.push({ at: now(), actorId: req.user.id, action: 'soft_deleted', detail: 'Soft deleted; financial records preserved' });
          return { softDeleted: true, matchId: match.id };
        }
        data.matches = data.matches.filter((m) => m.id !== match.id);
        return { softDeleted: false, matchId: match.id };
      });
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  router.post('/matches/:id/duplicate', adminOnly, async (req, res, next) => {
    try {
      const copy = await store.tx((data) => {
        const match = findMatch(data, req.params.id);
        if (!match) fail(404, 'Match not found.', 'NOT_FOUND');
        const start = req.body?.startTime ? parseDate(req.body.startTime, 'start time') : new Date(Date.now() + 86400_000).toISOString();
        const record = {
          ...JSON.parse(JSON.stringify(match)),
          id: uid('mat'),
          title: `${match.title} (Copy)`,
          startTime: start,
          registrationCloseTime: new Date(new Date(start).getTime() - 15 * 60_000).toISOString(),
          expiryTime: new Date(new Date(start).getTime() + 3 * 3600_000).toISOString(),
          status: 'registration_open',
          registrationPaused: false,
          registrationClosed: false,
          resultsPublished: false,
          prizesDistributed: false,
          participants: [],
          distributionIds: [],
          refundSummary: null,
          refundDeadline: null,
          roomId: '',
          roomPassword: '',
          createdBy: req.user.id,
          createdAt: now(),
          activity: [{ at: now(), actorId: req.user.id, action: 'duplicated', detail: `Duplicated from ${match.id}` }],
        };
        delete record.deletedAt;
        data.matches.push(record);
        return record;
      });
      res.status(201).json({ match: copy });
    } catch (error) {
      next(error);
    }
  });

  router.post('/matches/:id/pause', adminOnly, async (req, res, next) => {
    try {
      const match = await store.tx((data) => {
        const m = findMatch(data, req.params.id);
        if (!m) fail(404, 'Match not found.', 'NOT_FOUND');
        if (!['registration_open', 'paused', 'upcoming'].includes(m.status)) fail(409, 'Registrations cannot be paused now.', 'INVALID_STATE');
        m.registrationPaused = true;
        m.status = 'paused';
        m.activity.push({ at: now(), actorId: req.user.id, action: 'registration_paused', detail: 'Registrations paused' });
        return m;
      });
      res.json({ match: presentMatch(match, req.user) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/matches/:id/resume', adminOnly, async (req, res, next) => {
    try {
      const match = await store.tx((data) => {
        const m = findMatch(data, req.params.id);
        if (!m) fail(404, 'Match not found.', 'NOT_FOUND');
        m.registrationPaused = false;
        m.registrationClosed = false;
        m.status = 'registration_open';
        m.activity.push({ at: now(), actorId: req.user.id, action: 'registration_resumed', detail: 'Registrations resumed' });
        return m;
      });
      res.json({ match: presentMatch(match, req.user) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/matches/:id/close-registration', adminOnly, async (req, res, next) => {
    try {
      const match = await store.tx((data) => {
        const m = findMatch(data, req.params.id);
        if (!m) fail(404, 'Match not found.', 'NOT_FOUND');
        m.registrationClosed = true;
        m.status = 'registration_closed';
        m.activity.push({ at: now(), actorId: req.user.id, action: 'registration_closed', detail: 'Registration manually closed' });
        return m;
      });
      res.json({ match: presentMatch(match, req.user) });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/matches/:id/slots', adminOnly, async (req, res, next) => {
    try {
      const slots = toInt(req.body?.totalSlots, 0);
      if (slots < 1 || slots > 1000) fail(400, 'Slots must be between 1 and 1000.', 'INVALID_SLOTS');
      const match = await store.tx((data) => {
        const m = findMatch(data, req.params.id);
        if (!m) fail(404, 'Match not found.', 'NOT_FOUND');
        if (slots < m.participants.length) {
          fail(400, `Slots cannot be below the ${m.participants.length} registered players.`, 'SLOTS_TOO_LOW');
        }
        const from = m.totalSlots;
        m.totalSlots = slots;
        m.activity.push({ at: now(), actorId: req.user.id, action: 'slots_updated', detail: `Slots ${from} → ${slots}` });
        return m;
      });
      res.json({ match: presentMatch(match, req.user) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/matches/:id/cancel', adminOnly, async (req, res, next) => {
    try {
      const result = await store.tx((data) => {
        const m = findMatch(data, req.params.id);
        if (!m) fail(404, 'Match not found.', 'NOT_FOUND');
        return cancelMatch(data, m, {
          reason: String(req.body?.reason || 'Match cancelled by admin').slice(0, 200),
          adminId: req.user.id,
        }).then((r) => ({ ...r, matchId: m.id }));
      });
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  router.get('/matches/:id/participants', adminOnly, (req, res, next) => {
    try {
      const data = store.state;
      const m = findMatch(data, req.params.id);
      if (!m) fail(404, 'Match not found.', 'NOT_FOUND');
      res.json({
        participants: m.participants.map((p) => {
          const user = findUser(data, p.userId);
          return {
            ...p,
            username: user?.username || p.username,
            email: user?.email || null,
            avatar: user?.avatar || '',
            wallet: user?.wallet || null,
            prizeTransactions: data.transactions
              .filter((t) => t.matchId === m.id && t.userId === p.userId && t.type === 'prize')
              .map((t) => ({ id: t.id, amount: t.amount, status: t.status, createdAt: t.createdAt })),
          };
        }),
        match: {
          id: m.id,
          title: m.title,
          entryFee: m.entryFee,
          prizePool: m.prizePool,
          status: m.status,
          totalSlots: m.totalSlots,
          resultsPublished: m.resultsPublished,
          prizesDistributed: m.prizesDistributed,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/matches/:id/participants.csv', adminOnly, (req, res, next) => {
    try {
      const data = store.state;
      const m = findMatch(data, req.params.id);
      if (!m) fail(404, 'Match not found.', 'NOT_FOUND');
      const csv = toCsv(m.participants, [
        { label: 'Registration ID', get: (p) => p.registrationId },
        { label: 'Username', get: (p) => findUser(data, p.userId)?.username || p.username },
        { label: 'In-game name', get: (p) => p.ingameName },
        { label: 'Game UID', get: (p) => p.gameUid },
        { label: 'Team', get: (p) => p.teamName },
        { label: 'Entry fee', get: (p) => p.entryFeePaid },
        { label: 'Rank', get: (p) => p.rank ?? '' },
        { label: 'Prize', get: (p) => p.prize || 0 },
        { label: 'Payout status', get: (p) => p.payoutStatus },
        { label: 'Refunded', get: (p) => (p.refunded ? 'yes' : 'no') },
        { label: 'Joined at', get: (p) => p.joinedAt },
      ]);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${csvEscape(m.id)}-participants.csv"`);
      res.send(csv);
    } catch (error) {
      next(error);
    }
  });

  router.get('/matches/:id/activity', adminOnly, (req, res, next) => {
    try {
      const m = findMatch(store.state, req.params.id);
      if (!m) fail(404, 'Match not found.', 'NOT_FOUND');
      res.json({ activity: m.activity || [], updateHistory: m.updateHistory || [] });
    } catch (error) {
      next(error);
    }
  });

  router.post('/matches/:id/results', adminOnly, async (req, res, next) => {
    try {
      const results = Array.isArray(req.body?.results) ? req.body.results : null;
      if (!results || !results.length) fail(400, 'Provide a results array.', 'INVALID_RESULTS');
      const match = await store.tx((data) => {
        const m = findMatch(data, req.params.id);
        if (!m) fail(404, 'Match not found.', 'NOT_FOUND');
        if (['cancelled', 'expired'].includes(m.status)) fail(409, 'Match is closed.', 'MATCH_CLOSED');
        for (const row of results) {
          const participant = m.participants.find((p) => p.userId === row.userId || p.registrationId === row.registrationId);
          if (!participant) fail(400, 'Result row does not match a registered player.', 'NOT_PARTICIPANT');
          participant.rank = row.rank === undefined || row.rank === '' ? participant.rank : Number(row.rank);
          if (row.kills !== undefined) participant.kills = Math.max(0, toInt(row.kills, 0));
        }
        m.resultsPublished = true;
        m.status = 'completed';
        m.publishedAt = now();
        m.activity.push({ at: now(), actorId: req.user.id, action: 'results_published', detail: `${results.length} result rows published` });
        for (const p of m.participants) {
          const user = findUser(data, p.userId);
          if (!user) continue;
          if (p.rank && p.rank <= 3) user.stats.wins = (user.stats.wins || 0) + (m.resultsCounted ? 0 : 1);
        }
        m.resultsCounted = true;
        return m;
      });
      res.json({ match: presentMatch(match, req.user) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/matches/:id/distribute-prizes', adminOnly, async (req, res, next) => {
    try {
      const winners = Array.isArray(req.body?.winners) ? req.body.winners : null;
      if (!winners || !winners.length) fail(400, 'Select at least one winner.', 'NO_WINNERS');
      const distribution = await store.tx((data) => {
        const m = findMatch(data, req.params.id);
        if (!m) fail(404, 'Match not found.', 'NOT_FOUND');
        return distributePrizes(data, m, winners, req.user.id);
      });
      res.status(201).json({ distribution });
    } catch (error) {
      next(error);
    }
  });

  router.post('/matches/:id/distributions/:distributionId/retry', adminOnly, async (req, res, next) => {
    try {
      requireFields(req.body || {}, ['userId']);
      const result = await store.tx((data) => {
        const m = findMatch(data, req.params.id);
        if (!m) fail(404, 'Match not found.', 'NOT_FOUND');
        const distribution = data.distributions.find((d) => d.id === req.params.distributionId);
        if (!distribution) fail(404, 'Distribution not found.', 'NOT_FOUND');
        if (distribution.matchId !== m.id) fail(400, 'Distribution does not belong to this match.', 'MISMATCH');
        return retryFailedPayout(data, m, distribution, req.body.userId, req.user.id);
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get('/distributions', adminOnly, (req, res) => {
    const rows = store.state.distributions
      .filter((d) => !req.query.matchId || d.matchId === req.query.matchId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ distributions: rows });
  });

  /* -------------------------- Deposits / withdrawals ---------------------- */

  router.get('/deposits', adminOnly, (req, res) => {
    const data = store.state;
    const rows = data.deposits
      .filter((d) => !req.query.status || d.status === req.query.status)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((d) => ({ ...d, user: publicUser(findUser(data, d.userId)) }));
    res.json({ deposits: rows });
  });

  router.post('/deposits/:id/approve', adminOnly, async (req, res, next) => {
    try {
      const result = await store.tx(async (data) => {
        const deposit = data.deposits.find((d) => d.id === req.params.id);
        if (!deposit) fail(404, 'Deposit not found.', 'NOT_FOUND');
        if (deposit.status !== 'pending') fail(409, `Deposit already ${deposit.status}.`, 'INVALID_STATE');
        const user = findUser(data, deposit.userId);
        if (!user) fail(404, 'User not found.', 'NOT_FOUND');
        creditWallet(data, user, 'balance', deposit.amount, {
          type: 'deposit',
          description: `Deposit approved (${deposit.method}${deposit.reference ? ` · ${deposit.reference}` : ''})`,
          reference: deposit.id,
          adminId: req.user.id,
        });
        user.wallet.totalDeposited = Math.round((user.wallet.totalDeposited + deposit.amount) * 100) / 100;
        deposit.status = 'approved';
        deposit.reviewedAt = now();
        deposit.reviewedBy = req.user.id;
        const pendingTx = data.transactions.find((t) => t.type === 'deposit_request' && t.reference === deposit.id);
        if (pendingTx) {
          pendingTx.status = 'approved';
          pendingTx.reviewedAt = now();
        }
        await notifyUser(data, user.id, {
          title: 'Deposit approved ₹' + deposit.amount,
          body: `Your deposit of ₹${deposit.amount} has been approved and credited to your wallet.`,
          type: 'wallet',
          clickAction: '/wallet',
          dedupeKey: `deposit-approved:${deposit.id}`,
        });
        return { deposit, user };
      });
      res.json({ deposit: result.deposit, wallet: result.user.wallet });
    } catch (error) {
      next(error);
    }
  });

  router.post('/deposits/:id/reject', adminOnly, async (req, res, next) => {
    try {
      const deposit = await store.tx(async (data) => {
        const record = data.deposits.find((d) => d.id === req.params.id);
        if (!record) fail(404, 'Deposit not found.', 'NOT_FOUND');
        if (record.status !== 'pending') fail(409, `Deposit already ${record.status}.`, 'INVALID_STATE');
        record.status = 'rejected';
        record.reviewedAt = now();
        record.reviewedBy = req.user.id;
        record.rejectReason = String(req.body?.reason || 'Payment could not be verified').slice(0, 250);
        const pendingTx = data.transactions.find((t) => t.type === 'deposit_request' && t.reference === record.id);
        if (pendingTx) {
          pendingTx.status = 'rejected';
          pendingTx.reviewedAt = now();
        }
        await notifyUser(data, record.userId, {
          title: 'Deposit rejected',
          body: `Your deposit of ₹${record.amount} was rejected. Reason: ${record.rejectReason}`,
          type: 'wallet',
          clickAction: '/wallet',
          dedupeKey: `deposit-rejected:${record.id}`,
        });
        return record;
      });
      res.json({ deposit: deposit });
    } catch (error) {
      next(error);
    }
  });

  router.get('/withdrawals', adminOnly, (req, res) => {
    const data = store.state;
    const rows = data.withdrawals
      .filter((w) => !req.query.status || w.status === req.query.status)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((w) => ({ ...w, user: publicUser(findUser(data, w.userId)) }));
    res.json({ withdrawals: rows });
  });

  router.post('/withdrawals/:id/approve', adminOnly, async (req, res, next) => {
    try {
      const result = await store.tx(async (data) => {
        const record = data.withdrawals.find((w) => w.id === req.params.id);
        if (!record) fail(404, 'Withdrawal not found.', 'NOT_FOUND');
        if (record.status !== 'pending') fail(409, `Withdrawal already ${record.status}.`, 'INVALID_STATE');
        const user = findUser(data, record.userId);
        if (!user) fail(404, 'User not found.', 'NOT_FOUND');
        record.status = 'paid';
        record.reviewedAt = now();
        record.reviewedBy = req.user.id;
        record.utr = String(req.body?.utr || '').slice(0, 60);
        user.wallet.totalWithdrawn = Math.round((user.wallet.totalWithdrawn + record.amount) * 100) / 100;
        addTransaction(data, {
          userId: user.id,
          type: 'withdrawal',
          direction: 'debit',
          amount: record.amount,
          status: 'completed',
          description: `Withdrawal paid to ${record.upiId}`,
          reference: record.id,
          adminId: req.user.id,
        });
        await notifyUser(data, user.id, {
          title: 'Withdrawal paid ₹' + record.amount,
          body: `Your withdrawal of ₹${record.amount} has been paid to ${record.upiId}.`,
          type: 'wallet',
          clickAction: '/wallet',
          dedupeKey: `withdrawal-paid:${record.id}`,
        });
        return { record, wallet: user.wallet };
      });
      res.json({ withdrawal: result.record, wallet: result.wallet });
    } catch (error) {
      next(error);
    }
  });

  router.post('/withdrawals/:id/reject', adminOnly, async (req, res, next) => {
    try {
      const result = await store.tx(async (data) => {
        const record = data.withdrawals.find((w) => w.id === req.params.id);
        if (!record) fail(404, 'Withdrawal not found.', 'NOT_FOUND');
        if (record.status !== 'pending') fail(409, `Withdrawal already ${record.status}.`, 'INVALID_STATE');
        const user = findUser(data, record.userId);
        if (!user) fail(404, 'User not found.', 'NOT_FOUND');
        record.status = 'rejected';
        record.reviewedAt = now();
        record.reviewedBy = req.user.id;
        record.rejectReason = String(req.body?.reason || 'Rejected by admin').slice(0, 250);

        const breakdown = record.breakdown || { winning: 0, balance: record.amount };
        if (breakdown.winning > 0) {
          creditWallet(data, user, 'winning', breakdown.winning, {
            type: 'withdrawal_reversal',
            description: 'Withdrawal rejected — amount returned',
            reference: record.id,
            adminId: req.user.id,
          });
        }
        if (breakdown.balance > 0) {
          creditWallet(data, user, 'balance', breakdown.balance, {
            type: 'withdrawal_reversal',
            description: 'Withdrawal rejected — amount returned',
            reference: record.id,
            adminId: req.user.id,
          });
        }
        await notifyUser(data, user.id, {
          title: 'Withdrawal rejected',
          body: `Your withdrawal of ₹${record.amount} was rejected and returned to your wallet. Reason: ${record.rejectReason}`,
          type: 'wallet',
          clickAction: '/wallet',
          dedupeKey: `withdrawal-rejected:${record.id}`,
        });
        return { record, wallet: user.wallet };
      });
      res.json({ withdrawal: result.record, wallet: result.wallet });
    } catch (error) {
      next(error);
    }
  });

  /* --------------------------- Notifications ----------------------------- */

  const AUDIENCES = [
    'all',
    'user',
    'users',
    'match',
    'pending_deposits',
    'pending_withdrawals',
    'winners',
    'top_players',
  ];

  function resolveAudience(data, audience, payload) {
    const userIds = new Set();
    const users = data.users.filter((u) => u.role === 'user' && !u.banned);
    switch (audience) {
      case 'all':
        users.forEach((u) => userIds.add(u.id));
        break;
      case 'user':
        if (!payload.userId) fail(400, 'userId is required for a single-user notification.', 'VALIDATION_ERROR');
        userIds.add(payload.userId);
        break;
      case 'users':
        if (!Array.isArray(payload.userIds) || !payload.userIds.length) {
          fail(400, 'userIds array is required.', 'VALIDATION_ERROR');
        }
        payload.userIds.forEach((id) => userIds.add(id));
        break;
      case 'match': {
        const match = findMatch(data, payload.matchId);
        if (!match) fail(404, 'Match not found.', 'NOT_FOUND');
        match.participants.forEach((p) => userIds.add(p.userId));
        break;
      }
      case 'pending_deposits':
        data.deposits.filter((d) => d.status === 'pending').forEach((d) => userIds.add(d.userId));
        break;
      case 'pending_withdrawals':
        data.withdrawals.filter((w) => w.status === 'pending').forEach((w) => userIds.add(w.userId));
        break;
      case 'winners':
        data.matches
          .filter((m) => matchParticipant(m, payload.userId))
          .forEach((m) => {
            if (m.participants.some((p) => p.userId === payload.userId && p.prize > 0)) userIds.add(payload.userId);
          });
        break;
      case 'top_players':
        [...users]
          .sort((a, b) => (b.wallet.totalWon || 0) - (a.wallet.totalWon || 0))
          .slice(0, 20)
          .forEach((u) => userIds.add(u.id));
        break;
      default:
        fail(400, `Unknown audience. Use: ${AUDIENCES.join(', ')}`, 'INVALID_AUDIENCE');
    }
    return [...userIds];
  }

  router.post('/notifications', adminOnly, async (req, res, next) => {
    try {
      const { title, body, audience = 'all', userId, userIds, matchId, image, type = 'announcement', clickAction } = req.body || {};
      requireFields(req.body || {}, ['title', 'body']);
      const result = await store.tx(async (data) => {
        const targets = resolveAudience(data, audience, { userId, userIds, matchId });
        if (!targets.length) fail(400, 'No users matched this audience.', 'NO_RECIPIENTS');
        const created = [];
        for (const target of targets) {
          if (!findUser(data, target)) continue;
          const notification = await notifyUser(data, target, {
            title: String(title).slice(0, 120),
            body: String(body).slice(0, 600),
            image: image ? String(image).slice(0, 500) : null,
            type: String(type).slice(0, 30),
            matchId: matchId || null,
            clickAction: clickAction ? String(clickAction).slice(0, 200) : '/notifications',
            createdBy: req.user.id,
            dedupeKey: req.body.dedupeKey ? `${req.body.dedupeKey}:${target}` : null,
          });
          if (notification) created.push(notification);
        }
        return { count: created.length, notifications: created.slice(0, 20) };
      });
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get('/notifications', adminOnly, (req, res) => {
    const data = store.state;
    const items = [...data.notifications]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, toInt(req.query.limit, 100))
      .map((n) => ({
        ...n,
        user: findUser(data, n.userId)?.username || 'Deleted user',
      }));
    const delivered = data.notifications.filter((n) => n.delivery?.status === 'sent').length;
    res.json({
      notifications: items,
      stats: {
        total: data.notifications.length,
        delivered,
        inAppOnly: data.notifications.filter((n) => n.delivery?.status === 'in_app_only').length,
        notConfigured: data.notifications.filter((n) => n.delivery?.status === 'not_configured').length,
      },
    });
  });

  /* ------------------------- Devices and sessions ------------------------ */

  router.get('/devices', adminOnly, (req, res) => {
    const data = store.state;
    const devices = data.devices
      .map((d) => {
        const user = findUser(data, d.userId);
        const sessions = data.sessions.filter((s) => s.deviceId === d.id);
        return {
          ...d,
          pushToken: undefined,
          username: user?.username || 'Deleted user',
          email: user?.email || null,
          active: sessions.some((s) => !s.revoked && new Date(s.expiresAt) > Date.now()),
          sessionCount: sessions.filter((s) => !s.revoked).length,
        };
      })
      .sort((a, b) => new Date(b.lastActiveAt) - new Date(a.lastActiveAt));
    res.json({ devices });
  });

  router.post('/devices/:id/revoke', adminOnly, async (req, res, next) => {
    try {
      const result = await store.tx((data) => {
        const device = data.devices.find((d) => d.id === req.params.id);
        if (!device) fail(404, 'Device not found.', 'NOT_FOUND');
        let sessions = 0;
        for (const s of data.sessions) {
          if (s.deviceId === device.id && !s.revoked) {
            s.revoked = true;
            s.revokedAt = now();
            s.revokedReason = `revoked by admin ${req.user.email}`;
            sessions += 1;
          }
        }
        device.revoked = true;
        device.pushToken = null;
        const user = findUser(data, device.userId);
        if (user) {
          securityEvent(data, user, {
            type: 'admin_device_revoked',
            message: `Device ${device.name} was revoked by an administrator`,
            deviceId: device.id,
          });
        }
        return { sessions, deviceId: device.id };
      });
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  router.get('/sessions', adminOnly, (req, res) => {
    const data = store.state;
    res.json({
      sessions: data.sessions
        .filter((s) => !req.query.active || (!s.revoked && new Date(s.expiresAt) > Date.now()))
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 300)
        .map((s) => ({
          id: s.id,
          userId: s.userId,
          username: findUser(data, s.userId)?.username || 'Deleted user',
          deviceId: s.deviceId,
          device: data.devices.find((d) => d.id === s.deviceId)?.name || 'Unknown',
          ip: s.ip,
          createdAt: s.createdAt,
          lastActiveAt: s.lastActiveAt,
          expiresAt: s.expiresAt,
          revoked: s.revoked,
          revokedReason: s.revokedReason || null,
        })),
    });
  });

  router.post('/sessions/:id/revoke', adminOnly, async (req, res, next) => {
    try {
      const session = await store.tx((data) => {
        const s = data.sessions.find((x) => x.id === req.params.id);
        if (!s) fail(404, 'Session not found.', 'NOT_FOUND');
        if (!s.revoked) {
          s.revoked = true;
          s.revokedAt = now();
          s.revokedReason = `revoked by admin ${req.user.email}`;
        }
        return s;
      });
      res.json({ ok: true, sessionId: session.id, revoked: true });
    } catch (error) {
      next(error);
    }
  });

  router.get('/security', adminOnly, (req, res) => {
    const data = store.state;
    res.json({
      events: [...data.securityEvents]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, toInt(req.query.limit, 100))
        .map((e) => ({ ...e, username: findUser(data, e.userId)?.username || 'Deleted user' })),
    });
  });

  /* -------------------------------- Support ------------------------------ */

  router.get('/support', adminOnly, (req, res) => {
    const tickets = [...store.state.supportTickets]
      .filter((t) => !req.query.status || t.status === req.query.status)
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    res.json({ tickets });
  });

  router.post('/support/:id/reply', adminOnly, async (req, res, next) => {
    try {
      requireFields(req.body || {}, ['message']);
      const result = await store.tx(async (data) => {
        const ticket = data.supportTickets.find((t) => t.id === req.params.id);
        if (!ticket) fail(404, 'Ticket not found.', 'NOT_FOUND');
        ticket.replies.push({ by: 'admin', message: String(req.body.message).slice(0, 2000), at: now(), adminId: req.user.id });
        ticket.status = 'answered';
        ticket.updatedAt = now();
        await notifyUser(data, ticket.userId, {
          title: 'Support replied',
          body: `Support has replied to "${ticket.subject}". Open Support to read the response.`,
          type: 'support',
          clickAction: '/support',
          dedupeKey: `support-reply:${ticket.id}:${ticket.replies.length}`,
        });
        return ticket;
      });
      res.status(201).json({ ticket: result });
    } catch (error) {
      next(error);
    }
  });

  router.post('/support/:id/close', adminOnly, async (req, res, next) => {
    try {
      const ticket = await store.tx((data) => {
        const t = data.supportTickets.find((x) => x.id === req.params.id);
        if (!t) fail(404, 'Ticket not found.', 'NOT_FOUND');
        t.status = 'closed';
        t.updatedAt = now();
        return t;
      });
      res.json({ ticket });
    } catch (error) {
      next(error);
    }
  });

  /* -------------------------------- Reports ------------------------------ */

  router.get('/reports/financial', adminOnly, (req, res) => {
    const data = store.state;
    const from = req.query.from ? new Date(req.query.from).getTime() : 0;
    const to = req.query.to ? new Date(`${req.query.to}T23:59:59.999Z`).getTime() : Date.now() + 86400_000;
    const inRange = (iso) => {
      const t = new Date(iso).getTime();
      return t >= from && t <= to;
    };
    const tx = data.transactions.filter((t) => inRange(t.createdAt));
    const summary = {
      deposits: tx.filter((t) => t.type === 'deposit').reduce((s, t) => s + t.amount, 0),
      withdrawals: tx.filter((t) => t.type === 'withdrawal').reduce((s, t) => s + t.amount, 0),
      entryFees: tx.filter((t) => t.type === 'entry_fee').reduce((s, t) => s + t.amount, 0),
      refunds: tx.filter((t) => t.type === 'refund').reduce((s, t) => s + t.amount, 0),
      prizes: tx.filter((t) => t.type === 'prize').reduce((s, t) => s + t.amount, 0),
      bonuses: tx.filter((t) => t.type === 'bonus').reduce((s, t) => s + t.amount, 0),
      adjustments: tx.filter((t) => t.type === 'admin_adjust').reduce((s, t) => s + (t.direction === 'credit' ? t.amount : -t.amount), 0),
    };
    summary.grossRevenue = Math.round((summary.entryFees - summary.refunds - summary.prizes) * 100) / 100;
    summary.netCashFlow = Math.round((summary.deposits - summary.withdrawals - summary.bonuses + summary.adjustments) * 100) / 100;
    res.json({
      range: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
      summary,
      transactions: tx.slice(-500).reverse(),
      pending: {
        deposits: data.deposits.filter((d) => d.status === 'pending'),
        withdrawals: data.withdrawals.filter((w) => w.status === 'pending'),
      },
    });
  });

  router.get('/reports/transactions.csv', adminOnly, (req, res) => {
    const data = store.state;
    const csv = toCsv(data.transactions, [
      { label: 'Transaction ID', get: (t) => t.id },
      { label: 'Date', get: (t) => t.createdAt },
      { label: 'User', get: (t) => findUser(data, t.userId)?.email || t.userId },
      { label: 'Type', get: (t) => t.type },
      { label: 'Direction', get: (t) => t.direction },
      { label: 'Bucket', get: (t) => t.bucket || '' },
      { label: 'Amount', get: (t) => t.amount },
      { label: 'Status', get: (t) => t.status },
      { label: 'Match', get: (t) => t.matchId || '' },
      { label: 'Reference', get: (t) => t.reference || '' },
      { label: 'Description', get: (t) => t.description },
    ]);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="transactions.csv"');
    res.send(csv);
  });

  /* ------------------------------- Config / jobs -------------------------- */

  router.get('/config', adminOnly, (req, res) => {
    res.json({ config: store.state.config });
  });

  router.put('/config', adminOnly, async (req, res, next) => {
    try {
      const allowed = [
        'appName',
        'tagline',
        'currency',
        'minDeposit',
        'maxDeposit',
        'minWithdrawal',
        'maxWithdrawal',
        'registrationBonus',
        'upiId',
        'supportEmail',
        'supportWhatsapp',
        'maintenanceMode',
        'allowRegistration',
      ];
      const config = await store.tx((data) => {
        for (const key of allowed) {
          if (req.body?.[key] === undefined) continue;
          const value = req.body[key];
          if (['minDeposit', 'maxDeposit', 'minWithdrawal', 'maxWithdrawal', 'registrationBonus'].includes(key)) {
            const n = toAmount(value);
            if (n === null) fail(400, `${key} must be a valid amount.`, 'INVALID_CONFIG');
            data.config[key] = n;
          } else if (['maintenanceMode', 'allowRegistration'].includes(key)) {
            data.config[key] = !!value;
          } else {
            data.config[key] = String(value).slice(0, 200);
          }
        }
        if (data.config.minDeposit > data.config.maxDeposit) fail(400, 'minDeposit cannot exceed maxDeposit.', 'INVALID_CONFIG');
        if (data.config.minWithdrawal > data.config.maxWithdrawal) fail(400, 'minWithdrawal cannot exceed maxWithdrawal.', 'INVALID_CONFIG');
        data.config.updatedAt = now();
        data.config.updatedBy = req.user.id;
        return data.config;
      });
      res.json({ config });
    } catch (error) {
      next(error);
    }
  });

  router.post('/jobs/expire-matches', adminOnly, async (req, res, next) => {
    try {
      const result = await store.tx((data) =>
        runMaintenance(data, { reason: 'manual', actorId: req.user.id }),
      );
      res.json({ run: result });
    } catch (error) {
      next(error);
    }
  });

  router.get('/jobs/runs', adminOnly, (req, res) => {
    res.json({ runs: [...store.state.jobRuns].reverse().slice(0, 50) });
  });

  return router;
}
