import bcrypt from 'bcryptjs';
import { createStoreFromEnv } from './store.js';
import {
  distributePrizes,
  findUser,
  notifyUser,
  runMaintenance,
  securityEvent,
  addTransaction,
  cancelMatch,
} from './services.js';
import { now, uid } from './util.js';

const iso = (msFromNow) => new Date(Date.now() + msFromNow).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const PASSWORD_HASH = bcrypt.hashSync('Player@12345', 10);
const ADMIN_HASH = bcrypt.hashSync('Admin@12345', 10);

function makeUser({ email, username, gameUid, balance = 0, winning = 0, role = 'user', passwordHash, phone = '+91 90000 00000' }) {
  return {
    id: uid('usr'),
    email,
    passwordHash,
    username,
    role,
    gameUid,
    phone,
    avatar: '',
    bio: '',
    banned: false,
    createdAt: iso(-3 * DAY),
    lastLoginAt: iso(-HOUR),
    loginCount: 4,
    wallet: {
      balance,
      winning,
      totalDeposited: balance,
      totalWithdrawn: 0,
      totalWon: winning,
    },
    stats: { matchesPlayed: 0, wins: 0, kills: 0, prizeWon: 0 },
    prefs: { pushEnabled: true, emailNotifications: true, privateProfile: false },
  };
}

function participant(user, match, extra = {}) {
  return {
    userId: user.id,
    username: user.username,
    registrationId: uid('reg'),
    joinedAt: iso(-2 * HOUR),
    teamName: '',
    ingameName: user.username,
    gameUid: user.gameUid,
    entryFeePaid: match.entryFee,
    rank: null,
    prize: 0,
    payoutStatus: 'none',
    refunded: false,
    ...extra,
  };
}

function baseMatch({ title, mode, map, start, regClose, expiry, slots, entryFee, prizePool, perKill = 0, roomId = '', roomPassword = '', status = 'registration_open', autoRefund = true }) {
  return {
    id: uid('mat'),
    title,
    mode,
    map,
    banner: '',
    entryFee,
    prizePool,
    perKill,
    totalSlots: slots,
    startTime: start,
    registrationCloseTime: regClose,
    expiryTime: expiry,
    refundDeadline: expiry,
    rules: 'No emulators. No teaming. Record your gameplay. Room ID and password are private and only visible to registered players.',
    roomId,
    roomPassword,
    autoRefund,
    status,
    registrationPaused: false,
    registrationClosed: false,
    resultsPublished: false,
    prizesDistributed: false,
    participants: [],
    activity: [{ at: iso(-DAY), actorId: null, action: 'created', detail: 'Seeded match' }],
    createdBy: null,
    createdAt: iso(-DAY),
  };
}

export async function seed(store, { force = false } = {}) {
  if (store.state.users.length > 0 && !force) return { skipped: true };

  const result = await store.tx(async (data) => {
    if (force) {
      data.users = [];
      data.sessions = [];
      data.devices = [];
      data.matches = [];
      data.transactions = [];
      data.deposits = [];
      data.withdrawals = [];
      data.notifications = [];
      data.supportTickets = [];
      data.securityEvents = [];
      data.distributions = [];
      data.jobRuns = [];
    }

    const admin = makeUser({
      email: 'admin@firearena.gg',
      username: 'ArenaAdmin',
      gameUid: 'ADMIN-01',
      balance: 0,
      role: 'admin',
      passwordHash: ADMIN_HASH,
      phone: '+91 99999 00001',
    });
    const player = makeUser({
      email: 'player@firearena.gg',
      username: 'AkshayX',
      gameUid: '1234567890',
      balance: 520,
      passwordHash: PASSWORD_HASH,
    });
    const others = [
      makeUser({ email: 'shadow@firearena.gg', username: 'ShadowBlaze', gameUid: '7890123456', balance: 380, passwordHash: PASSWORD_HASH }),
      makeUser({ email: 'nova@firearena.gg', username: 'NovaKing', gameUid: '5566778899', balance: 410, passwordHash: PASSWORD_HASH }),
      makeUser({ email: 'ghost@firearena.gg', username: 'GhostOP', gameUid: '4455667788', balance: 290, passwordHash: PASSWORD_HASH }),
      makeUser({ email: 'ravi@firearena.gg', username: 'RaviYT', gameUid: '3322114455', balance: 260, passwordHash: PASSWORD_HASH }),
      makeUser({ email: 'sniper@firearena.gg', username: 'SniperRaja', gameUid: '9988776655', balance: 330, passwordHash: PASSWORD_HASH }),
      makeUser({ email: 'alpha@firearena.gg', username: 'TeamAlpha', gameUid: '1122334455', balance: 300, passwordHash: PASSWORD_HASH }),
      makeUser({ email: 'iron@firearena.gg', username: 'IronWolf', gameUid: '6677889900', balance: 275, passwordHash: PASSWORD_HASH }),
    ];
    data.users.push(admin, player, ...others);

    for (const user of [player, ...others]) {
      if (user.wallet.balance > 0) {
        addTransaction(data, {
          userId: user.id,
          type: 'deposit',
          direction: 'credit',
          bucket: 'balance',
          amount: user.wallet.balance,
          description: 'Demo seed deposit',
          status: 'completed',
        });
      }
    }

    /* -------------------------- matches -------------------------- */

    const live = baseMatch({
      title: 'Friday Solo Showdown',
      mode: 'solo',
      map: 'Bermuda',
      start: iso(-25 * MIN),
      regClose: iso(-45 * MIN),
      expiry: iso(2 * HOUR),
      slots: 48,
      entryFee: 20,
      prizePool: 800,
      perKill: 5,
      roomId: '84512397',
      roomPassword: 'arena786',
      status: 'live',
    });

    const upcoming = baseMatch({
      title: 'Squad Rush — Bermuda',
      mode: 'squad',
      map: 'Bermuda',
      start: iso(3 * HOUR),
      regClose: iso(2 * HOUR + 45 * MIN),
      expiry: iso(6 * HOUR),
      slots: 48,
      entryFee: 40,
      prizePool: 1500,
      perKill: 10,
    });

    const duo = baseMatch({
      title: 'Duo Clash Night',
      mode: 'duo',
      map: 'Purgatory',
      start: iso(27 * HOUR),
      regClose: iso(26 * HOUR),
      expiry: iso(30 * HOUR),
      slots: 24,
      entryFee: 15,
      prizePool: 400,
      perKill: 4,
    });

    const completed = baseMatch({
      title: 'Clash Squad Cup',
      mode: 'clash',
      map: 'Kalahari',
      start: iso(-27 * HOUR),
      regClose: iso(-28 * HOUR),
      expiry: iso(-24 * HOUR),
      slots: 8,
      entryFee: 10,
      prizePool: 300,
      status: 'completed',
    });
    completed.resultsPublished = true;
    completed.prizesDistributed = true;
    completed.resultsCounted = true;

    const cancelled = baseMatch({
      title: 'Midnight Solo Cup',
      mode: 'solo',
      map: 'Alpine',
      start: iso(-5 * HOUR),
      regClose: iso(-6 * HOUR),
      expiry: iso(-2 * HOUR),
      slots: 24,
      entryFee: 15,
      prizePool: 300,
      status: 'upcoming',
    });

    const expiring = baseMatch({
      title: 'Expired Solo Test',
      mode: 'solo',
      map: 'Bermuda',
      start: iso(-2 * HOUR),
      regClose: iso(-3 * HOUR),
      expiry: iso(-30 * MIN),
      slots: 24,
      entryFee: 30,
      prizePool: 500,
    });

    data.matches.push(live, upcoming, duo, completed, cancelled, expiring);

    const join = (match, user, extra = {}) => {
      match.participants.push(participant(user, match, extra));
      user.stats.matchesPlayed += 1;
      addTransaction(data, {
        userId: user.id,
        type: 'entry_fee',
        direction: 'debit',
        bucket: 'balance',
        amount: match.entryFee,
        description: `Entry fee for ${match.title}`,
        matchId: match.id,
        status: 'completed',
      });
      // Seed users are given balances that already account for these debits.
    };

    join(live, player, { ingameName: 'AkshayX' });
    join(live, others[0], { ingameName: 'ShadowOP' });
    join(live, others[1], { ingameName: 'Nova' });
    join(live, others[2], { ingameName: 'Ghosty' });
    join(live, others[3], { ingameName: 'RaviLive' });
    join(live, others[4], { ingameName: 'SniperX' });

    join(upcoming, player, { teamName: 'Team Inferno' });
    join(upcoming, others[5], { teamName: 'Alpha Squad' });
    join(upcoming, others[6], { teamName: 'Iron Legion' });
    join(upcoming, others[0], { teamName: 'Shadow Clan' });

    join(duo, player, { teamName: 'Duo Demons' });
    join(duo, others[1], { teamName: 'Nova Duo' });

    join(completed, player, { rank: 1 });
    join(completed, others[1], { rank: 2 });
    join(completed, others[2], { rank: 3 });
    join(completed, others[3], { rank: 4 });

    join(cancelled, player);
    join(cancelled, others[3]);
    join(cancelled, others[4]);

    join(expiring, player);
    join(expiring, others[2]);
    join(expiring, others[5]);

    /* ------------------ completed match payouts ------------------ */

    const winners = [
      { userId: player.id, amount: 38, rank: 1 },
      { userId: others[1].id, amount: 38, rank: 2 },
      { userId: others[2].id, amount: 24, rank: 3 },
    ];
    const distribution = await distributePrizes(data, completed, winners, admin.id);
    for (const winner of distribution.winners) {
      const user = findUser(data, winner.userId);
      if (user && winner.status === 'paid') {
        user.stats.wins += winner.rank && winner.rank <= 3 ? 1 : 0;
        user.stats.prizeWon = (user.stats.prizeWon || 0) + winner.amount;
      }
    }
    completed.status = 'completed';

    await cancelMatch(data, cancelled, { reason: 'Not enough players', adminId: admin.id });
    cancelled.activity.push({ at: now(), actorId: admin.id, action: 'seeded_cancel', detail: 'Demo cancelled match' });

    /* ------------------- refund the expired match ---------------- */

    const maintenance = await runMaintenance(data, { reason: 'seed' });

    /* ------------------- deposits / withdrawals ------------------ */

    const pendingDeposit = {
      id: uid('dep'),
      userId: player.id,
      username: player.username,
      amount: 200,
      method: 'upi',
      reference: 'UTR9988776655',
      note: 'Paid via GPay',
      status: 'pending',
      createdAt: iso(-2 * HOUR),
    };
    data.deposits.push(pendingDeposit);
    addTransaction(data, {
      userId: player.id,
      type: 'deposit_request',
      direction: 'credit',
      amount: 200,
      status: 'pending',
      description: 'Deposit request via upi',
      reference: pendingDeposit.id,
    });

    const approvedDeposit = {
      id: uid('dep'),
      userId: others[0].id,
      username: others[0].username,
      amount: 100,
      method: 'upi',
      reference: 'UTR1122334455',
      status: 'approved',
      createdAt: iso(-DAY),
      reviewedAt: iso(-23 * HOUR),
      reviewedBy: admin.id,
    };
    data.deposits.push(approvedDeposit);

    const pendingWithdrawal = {
      id: uid('wdr'),
      userId: player.id,
      username: player.username,
      amount: 150,
      upiId: 'akshay@upi',
      status: 'pending',
      createdAt: iso(-90 * MIN),
      breakdown: { winning: 0, balance: 150 },
    };
    data.withdrawals.push(pendingWithdrawal);
    player.wallet.balance = Math.round((player.wallet.balance - pendingWithdrawal.amount) * 100) / 100;
    addTransaction(data, {
      userId: player.id,
      type: 'withdrawal_hold',
      direction: 'debit',
      bucket: 'balance',
      amount: 150,
      status: 'completed',
      description: 'Withdrawal request (hold)',
      reference: pendingWithdrawal.id,
    });

    /* -------------------------- support ------------------------- */

    data.supportTickets.push(
      {
        id: uid('tkt'),
        userId: others[2].id,
        username: others[2].username,
        subject: 'Room ID not visible',
        category: 'match',
        status: 'open',
        replies: [{ by: 'user', message: 'I joined Friday Solo Showdown but cannot see the room ID.', at: iso(-50 * MIN) }],
        createdAt: iso(-50 * MIN),
        updatedAt: iso(-50 * MIN),
      },
      {
        id: uid('tkt'),
        userId: others[3].id,
        username: others[3].username,
        subject: 'Withdrawal delay',
        category: 'wallet',
        status: 'answered',
        replies: [
          { by: 'user', message: 'My withdrawal has been pending for a day.', at: iso(-2 * DAY) },
          { by: 'admin', message: 'It has been processed. Please check your UPI app.', at: iso(-1.5 * DAY), adminId: admin.id },
        ],
        createdAt: iso(-2 * DAY),
        updatedAt: iso(-1.5 * DAY),
      },
    );

    /* ------------------------ notifications --------------------- */

    for (const user of [player, ...others]) {
      await notifyUser(data, user.id, {
        title: 'Welcome to the arena! 🔥',
        body: `Welcome to ${data.config.appName}! Your account has been successfully created. Start exploring tournaments!`,
        type: 'welcome',
        clickAction: '/matches',
        dedupeKey: `welcome:${user.id}`,
      });
    }
    for (const user of [player, ...others]) {
      await notifyUser(data, user.id, {
        title: 'Weekend Mega Tournament',
        body: '₹10,000 prize pool this weekend. Registrations open tonight — do not miss it!',
        type: 'announcement',
        clickAction: '/matches',
        dedupeKey: `weekend:${user.id}`,
      });
    }

    securityEvent(data, player, {
      type: 'device_registered',
      message: 'Device registered: seeded browser session',
    });

    return {
      admin: admin.email,
      player: player.email,
      users: data.users.length,
      matches: data.matches.length,
      expired: maintenance.expired.length,
      refunds: maintenance.refunds,
    };
  });

  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const store = createStoreFromEnv();
  const { passwordHash, ...rest } = await seed(store, { force: process.argv.includes('--force') });
  console.log('[seed] done', rest);
  await store.flush();
}
