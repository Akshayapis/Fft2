import express from 'express';
import { authenticate, clientIp } from '../auth.js';
import {
  addTransaction,
  canRegister,
  creditWallet,
  debitWallet,
  findMatch,
  findUser,
  matchParticipant,
  notifyUser,
  presentMatch,
  refreshMatchStatus,
  securityEvent,
} from '../services.js';
import { getPushStatus } from '../push.js';
import {
  fail,
  now,
  publicUser,
  requireFields,
  toAmount,
  toInt,
  uid,
} from '../util.js';

export default function userRoutes(store) {
  const router = express.Router();
  const auth = authenticate(store);

  /* ----------------------------- Public config ---------------------------- */

  router.get('/config', async (req, res, next) => {
    try {
      const data = store.state;
      const c = data.config;
      const push = await getPushStatus();
      res.json({
        appName: c.appName,
        tagline: c.tagline,
        currency: c.currency,
        minDeposit: c.minDeposit,
        maxDeposit: c.maxDeposit,
        minWithdrawal: c.minWithdrawal,
        maxWithdrawal: c.maxWithdrawal,
        registrationBonus: c.registrationBonus,
        upiId: c.upiId,
        supportEmail: c.supportEmail,
        supportWhatsapp: c.supportWhatsapp,
        maintenanceMode: !!c.maintenanceMode,
        allowRegistration: c.allowRegistration !== false,
        push,
        firebase: process.env.FIREBASE_WEB_CONFIG ? JSON.parse(process.env.FIREBASE_WEB_CONFIG) : null,
        serverTime: now(),
      });
    } catch (error) {
      next(error);
    }
  });

  /* -------------------------------- Profile ------------------------------- */

  router.get('/profile', auth, (req, res) => {
    res.json({
      user: publicUser(req.user),
      activeDevices: store.state.devices.filter((d) => d.userId === req.user.id && !d.revoked).length,
    });
  });

  router.put('/profile', auth, async (req, res, next) => {
    try {
      const { username, gameUid, phone, avatar, bio, prefs } = req.body || {};
      const updated = await store.tx((data) => {
        const user = findUser(data, req.user.id);
        if (username !== undefined) {
          const value = String(username).trim();
          if (!/^[a-zA-Z0-9_. ]{3,24}$/.test(value)) fail(400, 'Invalid username.', 'INVALID_USERNAME');
          if (data.users.some((u) => u.id !== user.id && u.username.toLowerCase() === value.toLowerCase())) {
            fail(409, 'That username is already taken.', 'USERNAME_TAKEN');
          }
          user.username = value;
        }
        if (gameUid !== undefined) user.gameUid = String(gameUid).slice(0, 32);
        if (phone !== undefined) user.phone = String(phone).slice(0, 20);
        if (avatar !== undefined) {
          if (avatar && !/^(https?:\/\/|data:image\/)/.test(String(avatar))) {
            fail(400, 'Avatar must be an image URL.', 'INVALID_AVATAR');
          }
          user.avatar = avatar ? String(avatar).slice(0, 300_000) : '';
        }
        if (bio !== undefined) user.bio = String(bio).slice(0, 200);
        if (prefs && typeof prefs === 'object') {
          user.prefs = {
            ...user.prefs,
            ...(typeof prefs.pushEnabled === 'boolean' ? { pushEnabled: prefs.pushEnabled } : {}),
            ...(typeof prefs.emailNotifications === 'boolean' ? { emailNotifications: prefs.emailNotifications } : {}),
            ...(typeof prefs.privateProfile === 'boolean' ? { privateProfile: prefs.privateProfile } : {}),
          };
        }
        return user;
      });
      res.json({ user: publicUser(updated) });
    } catch (error) {
      next(error);
    }
  });

  /* -------------------------------- Devices ------------------------------- */

  function deviceView(device, currentDeviceId, sessions) {
    const deviceSessions = sessions.filter((s) => s.deviceId === device.id);
    const active = deviceSessions.some((s) => !s.revoked && new Date(s.expiresAt).getTime() > Date.now());
    return {
      id: device.id,
      name: device.name,
      model: device.model,
      os: device.os,
      browser: device.browser,
      platform: device.platform,
      ip: device.ip,
      location: device.location,
      firstLoginAt: device.firstLoginAt,
      lastActiveAt: device.lastActiveAt,
      revoked: device.revoked,
      active,
      current: device.id === currentDeviceId,
      pushEnabled: !!device.pushToken,
      sessionCount: deviceSessions.filter((s) => !s.revoked).length,
    };
  }

  router.get('/devices', auth, (req, res) => {
    const data = store.state;
    const devices = data.devices
      .filter((d) => d.userId === req.user.id)
      .sort((a, b) => new Date(b.lastActiveAt) - new Date(a.lastActiveAt))
      .map((d) => deviceView(d, req.session.deviceId, data.sessions));
    res.json({ devices, currentDeviceId: req.session.deviceId });
  });

  router.post('/devices/token', auth, async (req, res, next) => {
    try {
      const { token, platform } = req.body || {};
      if (token !== null && (typeof token !== 'string' || token.length < 10)) {
        fail(400, 'Invalid push token.', 'INVALID_TOKEN');
      }
      await store.tx((data) => {
        const device = data.devices.find((d) => d.id === req.session.deviceId);
        if (!device) fail(404, 'Device not found.', 'NOT_FOUND');
        // Tokens are unique across devices.
        if (token) for (const d of data.devices) if (d.pushToken === token && d.id !== device.id) d.pushToken = null;
        device.pushToken = token || null;
        device.platform = platform || device.platform;
        device.tokenUpdatedAt = now();
      });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.post('/devices/logout-others', auth, async (req, res, next) => {
    try {
      const revoked = await store.tx((data) => {
        let count = 0;
        for (const s of data.sessions) {
          if (s.userId === req.user.id && s.jti !== req.session.jti && !s.revoked) {
            s.revoked = true;
            s.revokedAt = now();
            s.revokedReason = 'logout from all other devices';
            count += 1;
          }
        }
        const otherDevices = data.devices.filter((d) => d.userId === req.user.id && d.id !== req.session.deviceId);
        for (const d of otherDevices) {
          d.revoked = true;
          d.pushToken = null;
        }
        securityEvent(data, req.user, {
          type: 'logout_others',
          message: `Signed out from ${count} other session(s)`,
          deviceId: req.session.deviceId,
          ip: clientIp(req),
        });
        return count;
      });
      res.json({ ok: true, revokedSessions: revoked });
    } catch (error) {
      next(error);
    }
  });

  router.post('/devices/:id/revoke', auth, async (req, res, next) => {
    try {
      const result = await store.tx((data) => {
        const device = data.devices.find((d) => d.id === req.params.id);
        if (!device) fail(404, 'Device not found.', 'NOT_FOUND');
        if (device.userId !== req.user.id) fail(403, 'You can only manage your own devices.', 'FORBIDDEN');
        let revoked = 0;
        for (const s of data.sessions) {
          if (s.deviceId === device.id && !s.revoked) {
            s.revoked = true;
            s.revokedAt = now();
            s.revokedReason = 'device removed by user';
            revoked += 1;
          }
        }
        device.revoked = true;
        device.pushToken = null;
        securityEvent(data, req.user, {
          type: 'device_revoked',
          message: `Removed device ${device.name} (${device.os})`,
          deviceId: device.id,
          ip: clientIp(req),
        });
        return { revoked, current: device.id === req.session.deviceId };
      });
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/devices/:id', auth, async (req, res, next) => {
    try {
      const result = await store.tx((data) => {
        const device = data.devices.find((d) => d.id === req.params.id);
        if (!device) fail(404, 'Device not found.', 'NOT_FOUND');
        if (device.userId !== req.user.id) fail(403, 'You can only manage your own devices.', 'FORBIDDEN');
        for (const s of data.sessions) {
          if (s.deviceId === device.id && !s.revoked) {
            s.revoked = true;
            s.revokedAt = now();
            s.revokedReason = 'device deleted by user';
          }
        }
        device.revoked = true;
        device.pushToken = null;
        device.deletedAt = now();
        return { current: device.id === req.session.deviceId };
      });
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  router.get('/security/activity', auth, (req, res) => {
    const events = store.state.securityEvents
      .filter((e) => e.userId === req.user.id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 50);
    res.json({ events });
  });

  /* ----------------------------- Notifications ---------------------------- */

  router.get('/notifications', auth, (req, res) => {
    const data = store.state;
    const unreadOnly = req.query.unread === 'true';
    let items = data.notifications.filter((n) => n.userId === req.user.id && (!unreadOnly || !n.read));
    items = items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, toInt(req.query.limit, 100));
    res.json({
      notifications: items,
      unreadCount: data.notifications.filter((n) => n.userId === req.user.id && !n.read).length,
    });
  });

  router.post('/notifications/:id/read', auth, async (req, res, next) => {
    try {
      await store.tx((data) => {
        const item = data.notifications.find((n) => n.id === req.params.id);
        if (!item) fail(404, 'Notification not found.', 'NOT_FOUND');
        if (item.userId !== req.user.id) fail(403, 'Forbidden.', 'FORBIDDEN');
        item.read = true;
        item.readAt = now();
      });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.post('/notifications/read-all', auth, async (req, res, next) => {
    try {
      const count = await store.tx((data) => {
        let n = 0;
        for (const item of data.notifications) {
          if (item.userId === req.user.id && !item.read) {
            item.read = true;
            item.readAt = now();
            n += 1;
          }
        }
        return n;
      });
      res.json({ ok: true, marked: count });
    } catch (error) {
      next(error);
    }
  });

  /* -------------------------------- Wallet -------------------------------- */

  router.get('/wallet', auth, (req, res) => {
    const data = store.state;
    const transactions = data.transactions
      .filter((t) => t.userId === req.user.id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 50);
    res.json({
      wallet: req.user.wallet,
      transactions,
      pendingDeposits: data.deposits.filter((d) => d.userId === req.user.id && d.status === 'pending').length,
      pendingWithdrawals: data.withdrawals.filter((w) => w.userId === req.user.id && w.status === 'pending').length,
      limits: {
        minDeposit: data.config.minDeposit,
        maxDeposit: data.config.maxDeposit,
        minWithdrawal: data.config.minWithdrawal,
        maxWithdrawal: data.config.maxWithdrawal,
      },
    });
  });

  router.get('/wallet/transactions', auth, (req, res) => {
    const type = req.query.type;
    const items = store.state.transactions
      .filter((t) => t.userId === req.user.id && (!type || t.type === type))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, toInt(req.query.limit, 200));
    res.json({ transactions: items });
  });

  router.get('/wallet/deposits', auth, (req, res) => {
    res.json({
      deposits: store.state.deposits
        .filter((d) => d.userId === req.user.id)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    });
  });

  router.get('/wallet/withdrawals', auth, (req, res) => {
    res.json({
      withdrawals: store.state.withdrawals
        .filter((w) => w.userId === req.user.id)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    });
  });

  router.post('/wallet/deposit', auth, async (req, res, next) => {
    try {
      requireFields(req.body || {}, ['amount', 'reference']);
      const amount = toAmount(req.body.amount);
      const data = store.state;
      if (amount === null || amount < data.config.minDeposit) {
        fail(400, `Minimum deposit is ₹${data.config.minDeposit}.`, 'MIN_DEPOSIT');
      }
      if (amount > data.config.maxDeposit) fail(400, `Maximum deposit is ₹${data.config.maxDeposit}.`, 'MAX_DEPOSIT');
      const deposit = await store.tx(async (d) => {
        const pending = d.deposits.filter((x) => x.userId === req.user.id && x.status === 'pending');
        if (pending.length >= 5) fail(429, 'You already have 5 pending deposits. Wait for approval.', 'TOO_MANY_PENDING');
        const record = {
          id: uid('dep'),
          userId: req.user.id,
          username: req.user.username,
          amount,
          method: String(req.body.method || 'upi').slice(0, 20),
          reference: String(req.body.reference).slice(0, 80),
          note: String(req.body.note || '').slice(0, 200),
          status: 'pending',
          createdAt: now(),
        };
        d.deposits.push(record);
        addTransaction(d, {
          userId: req.user.id,
          type: 'deposit_request',
          direction: 'credit',
          amount,
          status: 'pending',
          description: `Deposit request via ${record.method}`,
          reference: record.id,
        });
        return record;
      });
      res.status(201).json({ deposit });
    } catch (error) {
      next(error);
    }
  });

  router.post('/wallet/withdraw', auth, async (req, res, next) => {
    try {
      requireFields(req.body || {}, ['amount', 'upiId']);
      const amount = toAmount(req.body.amount);
      const data = store.state;
      if (amount === null || amount < data.config.minWithdrawal) {
        fail(400, `Minimum withdrawal is ₹${data.config.minWithdrawal}.`, 'MIN_WITHDRAWAL');
      }
      if (amount > data.config.maxWithdrawal) fail(400, `Maximum withdrawal is ₹${data.config.maxWithdrawal}.`, 'MAX_WITHDRAWAL');
      if (!/^[\w.\-]{2,}@[\w.\-]{2,}$/.test(String(req.body.upiId).trim())) {
        fail(400, 'Enter a valid UPI ID (e.g. name@bank).', 'INVALID_UPI');
      }

      const withdrawal = await store.tx((d) => {
        const user = findUser(d, req.user.id);
        if (user.wallet.winning + user.wallet.balance < amount) {
          fail(400, 'Insufficient wallet balance for this withdrawal.', 'INSUFFICIENT_BALANCE');
        }
        const pending = d.withdrawals.filter((w) => w.userId === user.id && w.status === 'pending');
        if (pending.length >= 3) fail(429, 'You already have 3 pending withdrawals.', 'TOO_MANY_PENDING');

        const record = {
          id: uid('wdr'),
          userId: user.id,
          username: user.username,
          amount,
          upiId: String(req.body.upiId).trim(),
          status: 'pending',
          createdAt: now(),
        };
        d.withdrawals.push(record);

        let remaining = amount;
        const fromWinning = Math.min(user.wallet.winning, remaining);
        if (fromWinning > 0) {
          debitWallet(d, user, 'winning', fromWinning, {
            type: 'withdrawal_hold',
            description: 'Withdrawal request (hold)',
            reference: record.id,
          });
          remaining -= fromWinning;
        }
        if (remaining > 0) {
          debitWallet(d, user, 'balance', remaining, {
            type: 'withdrawal_hold',
            description: 'Withdrawal request (hold)',
            reference: record.id,
          });
        }
        record.breakdown = { winning: fromWinning, balance: Math.round(remaining * 100) / 100 };
        return record;
      });
      res.status(201).json({ withdrawal });
    } catch (error) {
      next(error);
    }
  });

  router.post('/wallet/transfer-winnings', auth, async (req, res, next) => {
    try {
      requireFields(req.body || {}, ['amount']);
      const amount = toAmount(req.body.amount);
      if (!amount || amount <= 0) fail(400, 'Enter a valid amount.', 'INVALID_AMOUNT');
      const result = await store.tx((data) => {
        const user = findUser(data, req.user.id);
        debitWallet(data, user, 'winning', amount, {
          type: 'transfer_out',
          description: 'Winnings moved to wallet balance',
        });
        creditWallet(data, user, 'balance', amount, {
          type: 'transfer_in',
          description: 'Winnings moved from winning balance',
        });
        return user.wallet;
      });
      res.json({ wallet: result });
    } catch (error) {
      next(error);
    }
  });

  /* -------------------------------- Matches ------------------------------- */

  function listMatches(data, viewer, filter) {
    const items = data.matches
      .filter((m) => !m.deletedAt)
      .map((m) => refreshMatchStatus(m))
      .filter((m) => {
        if (filter === 'mine') return viewer && matchParticipant(m, viewer.id);
        if (filter === 'live') return m.status === 'live';
        if (filter === 'completed') return ['completed', 'settled'].includes(m.status);
        if (filter === 'upcoming') {
          return ['registration_open', 'paused', 'registration_closed', 'upcoming'].includes(m.status);
        }
        return !['cancelled', 'expired'].includes(m.status) || m.participants.some((p) => p.userId === viewer?.id);
      })
      .sort((a, b) => new Date(a.startTime || 0) - new Date(b.startTime || 0));
    return items.map((m) => presentMatch(m, viewer));
  }

  router.get('/matches', auth, (req, res) => {
    const filter = req.query.status || 'all';
    res.json({ matches: listMatches(store.state, req.user, filter) });
  });

  router.get('/matches/:id', auth, (req, res, next) => {
    try {
      const match = findMatch(store.state, req.params.id);
      if (!match) fail(404, 'Match not found.', 'NOT_FOUND');
      refreshMatchStatus(match);
      const base = presentMatch(match, req.user);
      if (matchParticipant(match, req.user.id)) {
        base.participants = match.participants.map((p) => ({
          username: p.ingameName || 'Player',
          rank: p.rank,
          prize: p.prize || 0,
          payoutStatus: p.payoutStatus,
        }));
        base.myRegistration = matchParticipant(match, req.user.id);
      }
      res.json({ match: base });
    } catch (error) {
      next(error);
    }
  });

  router.post('/matches/:id/join', auth, async (req, res, next) => {
    try {
      const { teamName, ingameName, gameUid, useWinnings } = req.body || {};
      const result = await store.tx(async (data) => {
        const match = findMatch(data, req.params.id);
        if (!match) fail(404, 'Match not found.', 'NOT_FOUND');
        refreshMatchStatus(match);
        const allowed = canRegister(match);
        if (!allowed.ok) fail(409, allowed.reason, 'REGISTRATION_CLOSED');
        const user = findUser(data, req.user.id);
        if (matchParticipant(match, user.id)) fail(409, 'You have already joined this match.', 'ALREADY_JOINED');
        if (user.banned) fail(403, 'Your account is blocked.', 'ACCOUNT_BLOCKED');

        const fee = Number(match.entryFee) || 0;
        const fromBalance = Math.min(user.wallet.balance, fee);
        const remaining = Math.round((fee - fromBalance) * 100) / 100;
        if (remaining > 0) {
          if (!useWinnings) {
            fail(400, `Insufficient wallet balance. Add ₹${remaining} or pay using winnings.`, 'INSUFFICIENT_BALANCE', {
              required: remaining,
              available: user.wallet.balance,
              winnings: user.wallet.winning,
            });
          }
          if (user.wallet.winning < remaining) {
            fail(400, 'Insufficient wallet and winning balance for this entry fee.', 'INSUFFICIENT_BALANCE');
          }
        }

        if (fromBalance > 0) {
          debitWallet(data, user, 'balance', fromBalance, {
            type: 'entry_fee',
            description: `Entry fee for ${match.title}`,
            matchId: match.id,
          });
        }
        if (remaining > 0) {
          debitWallet(data, user, 'winning', remaining, {
            type: 'entry_fee',
            description: `Entry fee for ${match.title} (winnings)`,
            matchId: match.id,
          });
        }

        const participant = {
          userId: user.id,
          username: user.username,
          registrationId: uid('reg'),
          joinedAt: now(),
          teamName: String(teamName || '').slice(0, 30),
          ingameName: String(ingameName || user.username).slice(0, 30),
          gameUid: String(gameUid || user.gameUid || '').slice(0, 32),
          entryFeePaid: fee,
          rank: null,
          prize: 0,
          payoutStatus: 'none',
          refunded: false,
        };
        match.participants.push(participant);
        match.activity.push({ at: now(), actorId: user.id, action: 'joined', detail: `${user.username} joined` });
        user.stats.matchesPlayed = (user.stats.matchesPlayed || 0) + 1;

        await notifyUser(data, user.id, {
          title: 'Match registration confirmed ✅',
          body: `You joined "${match.title}". Room details will appear in My Matches before the match starts.`,
          type: 'match',
          matchId: match.id,
          clickAction: '/my-matches',
          dedupeKey: `joined:${match.id}:${user.id}`,
        });

        return { participant, wallet: user.wallet, match: presentMatch(match, user) };
      });
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get('/me/matches', auth, (req, res) => {
    const matches = store.state.matches
      .filter((m) => !m.deletedAt && matchParticipant(m, req.user.id))
      .map((m) => refreshMatchStatus(m))
      .sort((a, b) => new Date(b.startTime || 0) - new Date(a.startTime || 0))
      .map((m) => presentMatch(m, req.user));
    res.json({ matches });
  });

  router.get('/me/results', auth, (req, res) => {
    const items = store.state.matches
      .filter((m) => !m.deletedAt && m.resultsPublished && matchParticipant(m, req.user.id))
      .map((m) => {
        const p = matchParticipant(m, req.user.id);
        return {
          matchId: m.id,
          title: m.title,
          mode: m.mode,
          startTime: m.startTime,
          rank: p.rank,
          prize: p.prize || 0,
          payoutStatus: p.payoutStatus,
          entryFee: m.entryFee,
        };
      })
      .sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
    res.json({ results: items });
  });

  router.get('/me/wins', auth, (req, res) => {
    const items = store.state.matches
      .filter((m) => !m.deletedAt && matchParticipant(m, req.user.id)?.prize > 0)
      .map((m) => {
        const p = matchParticipant(m, req.user.id);
        return {
          matchId: m.id,
          title: m.title,
          mode: m.mode,
          startTime: m.startTime,
          rank: p.rank,
          prize: p.prize,
          transactionId: p.payoutTransactionId || null,
        };
      })
      .sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
    const totalWon = items.reduce((sum, i) => sum + i.prize, 0);
    res.json({ wins: items, totalWon, winCount: items.length });
  });

  router.get('/leaderboard', auth, (req, res) => {
    const players = store.state.users
      .filter((u) => u.role === 'user')
      .map((u) => ({
        id: u.id,
        username: u.username,
        avatar: u.avatar,
        wins: u.stats.wins || 0,
        matchesPlayed: u.stats.matchesPlayed || 0,
        totalWon: u.wallet.totalWon || 0,
      }))
      .sort((a, b) => b.totalWon - a.totalWon || b.wins - a.wins)
      .slice(0, 50)
      .map((p, i) => ({ ...p, position: i + 1 }));
    const me = players.find((p) => p.id === req.user.id) || null;
    res.json({ leaderboard: players, me });
  });

  /* -------------------------------- Support ------------------------------- */

  router.get('/support', auth, (req, res) => {
    res.json({
      tickets: store.state.supportTickets
        .filter((t) => t.userId === req.user.id)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    });
  });

  router.post('/support', auth, async (req, res, next) => {
    try {
      requireFields(req.body || {}, ['subject', 'message']);
      const ticket = await store.tx((data) => {
        const record = {
          id: uid('tkt'),
          userId: req.user.id,
          username: req.user.username,
          subject: String(req.body.subject).slice(0, 120),
          category: String(req.body.category || 'general').slice(0, 30),
          status: 'open',
          replies: [{ by: 'user', message: String(req.body.message).slice(0, 2000), at: now() }],
          createdAt: now(),
          updatedAt: now(),
        };
        data.supportTickets.push(record);
        return record;
      });
      res.status(201).json({ ticket });
    } catch (error) {
      next(error);
    }
  });

  router.post('/support/:id/reply', auth, async (req, res, next) => {
    try {
      requireFields(req.body || {}, ['message']);
      const ticket = await store.tx((data) => {
        const t = data.supportTickets.find((x) => x.id === req.params.id);
        if (!t) fail(404, 'Ticket not found.', 'NOT_FOUND');
        if (t.userId !== req.user.id) fail(403, 'Forbidden.', 'FORBIDDEN');
        if (t.status === 'closed') fail(409, 'This ticket is closed.', 'TICKET_CLOSED');
        t.replies.push({ by: 'user', message: String(req.body.message).slice(0, 2000), at: now() });
        t.status = 'open';
        t.updatedAt = now();
        return t;
      });
      res.status(201).json({ ticket });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
