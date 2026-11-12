import { sendPush } from './push.js';
import { now, uid, fail, toAmount } from './util.js';

/* ------------------------------------------------------------------ */
/* Lookups                                                             */
/* ------------------------------------------------------------------ */

export const findUser = (data, id) => data.users.find((u) => u.id === id);
export const findMatch = (data, id) => data.matches.find((m) => m.id === id && !m.deletedAt);
export const findDevice = (data, id) => data.devices.find((d) => d.id === id);

export function matchParticipant(match, userId) {
  return match.participants.find((p) => p.userId === userId) || null;
}

export function userHasMatch(match, userId) {
  return !!matchParticipant(match, userId);
}

/* ------------------------------------------------------------------ */
/* Ledger                                                              */
/* ------------------------------------------------------------------ */

/**
 * Append an immutable ledger entry. Never mutate or delete existing entries:
 * the audit trail is append-only by convention across the whole backend.
 */
export function addTransaction(data, payload) {
  const tx = {
    id: uid('tx'),
    userId: payload.userId,
    type: payload.type,
    direction: payload.direction,
    bucket: payload.bucket || null,
    amount: Math.round(Number(payload.amount) * 100) / 100,
    status: payload.status || 'completed',
    description: payload.description || '',
    matchId: payload.matchId || null,
    reference: payload.reference || null,
    adminId: payload.adminId || null,
    error: payload.error || null,
    createdAt: now(),
    meta: payload.meta || {},
  };
  data.transactions.push(tx);
  return tx;
}

export function creditWallet(data, user, bucket, amount, payload = {}) {
  const value = toAmount(amount);
  if (value === null || value <= 0) fail(400, 'Credit amount must be greater than zero.', 'INVALID_AMOUNT');
  if (!['balance', 'winning'].includes(bucket)) fail(400, 'Invalid wallet bucket.', 'INVALID_BUCKET');
  user.wallet[bucket] = Math.round((user.wallet[bucket] + value) * 100) / 100;
  if (bucket === 'winning') user.wallet.totalWon = Math.round((user.wallet.totalWon + value) * 100) / 100;
  return addTransaction(data, {
    userId: user.id,
    type: payload.type || 'credit',
    direction: 'credit',
    bucket,
    amount: value,
    description: payload.description,
    matchId: payload.matchId,
    reference: payload.reference,
    adminId: payload.adminId,
    meta: payload.meta,
  });
}

export function debitWallet(data, user, bucket, amount, payload = {}) {
  const value = toAmount(amount);
  if (value === null || value <= 0) fail(400, 'Debit amount must be greater than zero.', 'INVALID_AMOUNT');
  if (!['balance', 'winning'].includes(bucket)) fail(400, 'Invalid wallet bucket.', 'INVALID_BUCKET');
  if (user.wallet[bucket] < value) {
    fail(400, `Insufficient ${bucket === 'winning' ? 'winnings' : 'wallet'} balance.`, 'INSUFFICIENT_BALANCE', {
      required: value,
      available: user.wallet[bucket],
    });
  }
  user.wallet[bucket] = Math.round((user.wallet[bucket] - value) * 100) / 100;
  return addTransaction(data, {
    userId: user.id,
    type: payload.type || 'debit',
    direction: 'debit',
    bucket,
    amount: value,
    description: payload.description,
    matchId: payload.matchId,
    reference: payload.reference,
    meta: payload.meta,
  });
}

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

export function activeTokens(data, userId) {
  return data.devices
    .filter((d) => d.userId === userId && !d.revoked && d.pushToken)
    .map((d) => d.pushToken);
}

/**
 * Create an in-app notification (always) and attempt a push (when possible).
 * `dedupeKey` guarantees at-most-once creation for things like welcome messages.
 */
export async function notifyUser(data, userId, payload) {
  const user = findUser(data, userId);
  if (!user) return null;

  if (payload.dedupeKey) {
    const existing = data.notifications.find(
      (n) => n.userId === userId && n.dedupeKey === payload.dedupeKey,
    );
    if (existing) return existing;
  }

  const notification = {
    id: uid('ntf'),
    userId,
    title: payload.title,
    body: payload.body,
    image: payload.image || null,
    type: payload.type || 'general',
    matchId: payload.matchId || null,
    clickAction: payload.clickAction || '/notifications',
    dedupeKey: payload.dedupeKey || null,
    read: false,
    createdAt: now(),
    createdBy: payload.createdBy || 'system',
    delivery: {
      status: user.prefs?.pushEnabled === false ? 'in_app_only' : 'pending',
      provider: 'none',
      targetCount: 0,
      successCount: 0,
      failureCount: 0,
      errors: [],
    },
  };
  data.notifications.push(notification);

  if (user.prefs?.pushEnabled !== false) {
    const tokens = activeTokens(data, userId);
    const report = await sendPush({
      tokens,
      title: notification.title,
      body: notification.body,
      image: notification.image,
      data: {
        notificationId: notification.id,
        type: notification.type,
        matchId: notification.matchId || '',
        clickAction: notification.clickAction,
      },
    });
    notification.delivery = {
      status: report.status,
      provider: report.provider,
      targetCount: report.targetCount,
      successCount: report.successCount,
      failureCount: report.failureCount,
      errors: report.errors || [],
    };
    for (const token of report.invalidTokens || []) {
      for (const device of data.devices) if (device.pushToken === token) device.pushToken = null;
    }
  }

  return notification;
}

export function securityEvent(data, user, payload) {
  const event = {
    id: uid('sec'),
    userId: user.id,
    type: payload.type,
    message: payload.message,
    deviceId: payload.deviceId || null,
    ip: payload.ip || null,
    userAgent: payload.userAgent || null,
    location: payload.location || null,
    createdAt: now(),
    meta: payload.meta || {},
  };
  data.securityEvents.push(event);
  return event;
}

/* ------------------------------------------------------------------ */
/* Matches                                                             */
/* ------------------------------------------------------------------ */

export function refreshMatchStatus(match, at = Date.now()) {
  if (!match || ['completed', 'cancelled', 'expired', 'settled'].includes(match.status)) return match;
  const start = match.startTime ? new Date(match.startTime).getTime() : null;
  const regClose = match.registrationCloseTime ? new Date(match.registrationCloseTime).getTime() : null;
  const expiry = match.expiryTime ? new Date(match.expiryTime).getTime() : null;

  if (expiry && at >= expiry) {
    // Expiration itself is handled by the scheduled job (refunds happen there).
    match.status = 'expired';
    return match;
  }
  if (start && at >= start) {
    match.status = 'live';
    return match;
  }
  if (regClose && at >= regClose) {
    match.status = 'registration_closed';
    return match;
  }
  if (match.status === 'paused') return match;
  if (match.status === 'upcoming' || match.status === 'registration_open') {
    match.status = match.registrationPaused ? 'paused' : 'registration_open';
  }
  return match;
}

export function canRegister(match) {
  if (!match) return { ok: false, reason: 'Match not found.' };
  if (match.status === 'expired' || match.status === 'cancelled') return { ok: false, reason: 'Match is closed.' };
  if (match.status === 'completed' || match.status === 'settled') return { ok: false, reason: 'Match has finished.' };
  if (match.registrationPaused) return { ok: false, reason: 'Registrations are paused for this match.' };
  if (match.registrationClosed) return { ok: false, reason: 'Registrations are closed for this match.' };
  if (match.status === 'live') return { ok: false, reason: 'Match has already started.' };
  if (match.registrationCloseTime && Date.now() > new Date(match.registrationCloseTime).getTime()) {
    return { ok: false, reason: 'Registration window has closed.' };
  }
  if (match.participants.length >= match.totalSlots) return { ok: false, reason: 'Match is full.' };
  return { ok: true };
}

/** Strip secrets: room credentials only for registered participants of a live match. */
export function presentMatch(match, viewer) {
  const isAdmin = viewer?.role === 'admin';
  const joined = viewer ? userHasMatch(match, viewer.id) : false;
  const credentialsVisible =
    (isAdmin || joined) &&
    !['cancelled', 'expired', 'completed', 'settled'].includes(match.status) &&
    !!match.roomId;

  return {
    id: match.id,
    title: match.title,
    mode: match.mode,
    map: match.map,
    banner: match.banner || null,
    entryFee: match.entryFee,
    prizePool: match.prizePool,
    perKill: match.perKill,
    totalSlots: match.totalSlots,
    filledSlots: match.participants.length,
    startTime: match.startTime,
    registrationCloseTime: match.registrationCloseTime,
    expiryTime: match.expiryTime,
    refundDeadline: match.refundDeadline,
    status: match.status,
    registrationPaused: !!match.registrationPaused,
    registrationClosed: !!match.registrationClosed,
    rules: match.rules || '',
    resultsPublished: !!match.resultsPublished,
    prizesDistributed: !!match.prizesDistributed,
    joined,
    joinedDetails: joined ? matchParticipant(match, viewer.id) : null,
    roomId: credentialsVisible ? match.roomId : null,
    roomPassword: credentialsVisible ? match.roomPassword : null,
    credentialsNote: joined && !credentialsVisible
      ? 'Room credentials are hidden because this match is not active.'
      : null,
    participantCount: match.participants.length,
    createdAt: match.createdAt,
  };
}

/* ------------------------------------------------------------------ */
/* Refunds / cancellation / expiration                                 */
/* ------------------------------------------------------------------ */

export async function refundParticipant(data, match, participant, reason) {
  const user = findUser(data, participant.userId);
  if (!user) return { userId: participant.userId, status: 'failed', error: 'User no longer exists' };
  if (participant.refunded) return { userId: participant.userId, status: 'already_refunded' };

  const already = data.transactions.find(
    (t) => t.matchId === match.id && t.userId === participant.userId && t.type === 'refund',
  );
  if (already) {
    participant.refunded = true;
    participant.refundTransactionId = already.id;
    return { userId: participant.userId, status: 'already_refunded', transactionId: already.id };
  }

  const amount = match.entryFee;
  if (!amount) return { userId: participant.userId, status: 'no_fee' };

  creditWallet(data, user, 'balance', amount, {
    type: 'refund',
    description: `Refund for ${match.title} (${reason})`,
    matchId: match.id,
  });
  participant.refunded = true;
  participant.refundTransactionId = data.transactions[data.transactions.length - 1].id;
  participant.refundedAt = now();

  await notifyUser(data, user.id, {
    title: 'Match refund credited',
    body: `Your entry fee of ₹${amount} for "${match.title}" has been refunded to your wallet.`,
    type: 'refund',
    matchId: match.id,
    clickAction: '/wallet',
  });

  return { userId: user.id, status: 'refunded', amount, transactionId: participant.refundTransactionId };
}

export async function cancelMatch(data, match, { reason = 'Match cancelled by admin', adminId = null } = {}) {
  if (match.status === 'cancelled') return { cancelled: false, refunds: [], reason: 'Already cancelled' };
  const refunds = [];
  for (const participant of match.participants) {
    refunds.push(await refundParticipant(data, match, participant, reason));
  }
  match.status = 'cancelled';
  match.cancelledAt = now();
  match.cancelReason = reason;
  match.refundSummary = {
    at: now(),
    refunded: refunds.filter((r) => r.status === 'refunded').length,
    alreadyRefunded: refunds.filter((r) => r.status === 'already_refunded').length,
    failed: refunds.filter((r) => r.status === 'failed').length,
  };
  match.activity.push({ at: now(), actorId: adminId, action: 'cancelled', detail: reason });
  for (const participant of match.participants) {
    const user = findUser(data, participant.userId);
    if (!user) continue;
    await notifyUser(data, user.id, {
      title: 'Match cancelled',
      body: `"${match.title}" has been cancelled. Any entry fee has been refunded to your wallet.`,
      type: 'match',
      matchId: match.id,
      clickAction: '/wallet',
    });
  }
  return { cancelled: true, refunds };
}

/* ------------------------------------------------------------------ */
/* Scheduled maintenance: auto-expire + auto-refund (idempotent)        */
/* ------------------------------------------------------------------ */

export async function runMaintenance(data, { reason = 'scheduled', actorId = null } = {}) {
  const startedAt = Date.now();
  const result = {
    id: uid('job'),
    at: now(),
    reason,
    actorId,
    scanned: 0,
    expired: [],
    refunds: 0,
    refundedAmount: 0,
    statusChanges: [],
    errors: [],
    durationMs: 0,
  };

  for (const match of data.matches) {
    if (match.deletedAt) continue;
    result.scanned += 1;
    try {
      const before = match.status;
      refreshMatchStatus(match);
      if (match.status === 'expired' && before !== 'expired') {
        // Expiration: stop registration, hide credentials, refund once.
        match.registrationClosed = true;
        match.expiredAt = now();
        match.roomCredentialsHidden = true;
        const refunds = [];
        if (match.autoRefund !== false) {
          for (const participant of match.participants) {
            refunds.push(await refundParticipant(data, match, participant, 'match expired'));
          }
        }
        const refunded = refunds.filter((r) => r.status === 'refunded');
        result.refunds += refunded.length;
        result.refundedAmount += refunded.reduce((sum, r) => sum + (r.amount || 0), 0);
        match.refundSummary = {
          at: now(),
          automatic: true,
          refunded: refunded.length,
          alreadyRefunded: refunds.filter((r) => r.status === 'already_refunded').length,
          failed: refunds.filter((r) => r.status === 'failed').length,
          transactionIds: refunded.map((r) => r.transactionId),
        };
        match.activity.push({ at: now(), actorId: null, action: 'expired', detail: 'Automatically expired and refunded by scheduler' });
        result.expired.push(match.id);
        for (const participant of match.participants) {
          const user = findUser(data, participant.userId);
          if (!user) continue;
          const refundedHere = refunds.find((r) => r.userId === user.id && r.status === 'refunded');
          await notifyUser(data, user.id, {
            title: refundedHere ? 'Match expired — entry fee refunded' : 'Match expired',
            body: refundedHere
              ? `"${match.title}" expired without completion. ₹${refundedHere.amount} has been credited back to your wallet.`
              : `"${match.title}" has expired. Please contact support if you need assistance.`,
            type: 'refund',
            matchId: match.id,
            clickAction: refundedHere ? '/wallet' : '/support',
          });
        }
      } else if (before !== match.status) {
        result.statusChanges.push({ matchId: match.id, from: before, to: match.status });
        if (match.status === 'live') {
          match.activity.push({ at: now(), actorId: null, action: 'live', detail: 'Match started' });
        }
        if (match.status === 'registration_closed') {
          match.activity.push({ at: now(), actorId: null, action: 'registration_closed', detail: 'Registration window closed' });
        }
      }
    } catch (error) {
      result.errors.push({ matchId: match.id, message: error.message });
    }
  }

  result.durationMs = Date.now() - startedAt;
  result.status = result.errors.length ? (result.expired.length ? 'partial' : 'failed') : 'ok';
  data.jobRuns.push(result);
  if (data.jobRuns.length > 100) data.jobRuns.splice(0, data.jobRuns.length - 100);
  return result;
}

/* ------------------------------------------------------------------ */
/* Prize distribution                                                  */
/* ------------------------------------------------------------------ */

/**
 * Credit prizes atomically and idempotently.
 * Entries: [{ userId, amount, rank }]
 * - validates every entry against the participant list and budget
 * - never pays twice (guarded by an existing completed prize transaction)
 * - records a per-winner status so partial failures can be retried safely
 */
export async function distributePrizes(data, match, entries, adminId) {
  if (['cancelled', 'expired'].includes(match.status)) fail(409, 'Cannot distribute prizes for a cancelled or expired match.', 'MATCH_CLOSED');

  const budget = Number(match.prizePool) || 0;
  const cleanEntries = entries.map((entry) => ({
    userId: entry.userId,
    amount: toAmount(entry.amount),
    rank: entry.rank === null || entry.rank === undefined || entry.rank === '' ? null : Number(entry.rank),
  }));

  if (!cleanEntries.length) fail(400, 'Select at least one winner.', 'NO_WINNERS');
  const seen = new Set();
  for (const entry of cleanEntries) {
    if (!entry.userId) fail(400, 'Every winner needs a user id.', 'INVALID_WINNER');
    if (entry.amount === null || entry.amount <= 0) fail(400, 'Prize amount must be greater than zero.', 'INVALID_AMOUNT');
    if (seen.has(entry.userId)) fail(400, 'A player can only be selected once.', 'DUPLICATE_WINNER');
    seen.add(entry.userId);
    const participant = matchParticipant(match, entry.userId);
    if (!participant) fail(400, 'Selected player did not join this match.', 'NOT_PARTICIPANT');
  }

  const alreadyPaid = data.transactions
    .filter((t) => t.matchId === match.id && t.type === 'prize' && t.status === 'completed')
    .reduce((sum, t) => sum + t.amount, 0);
  const paidUserIds = new Set(
    data.transactions
      .filter((t) => t.matchId === match.id && t.type === 'prize' && t.status === 'completed')
      .map((t) => t.userId),
  );
  const payableEntries = cleanEntries.filter((e) => !paidUserIds.has(e.userId));
  const total = payableEntries.reduce((sum, e) => sum + e.amount, 0);
  if (alreadyPaid + total > budget) {
    fail(400, `Prize total ₹${total} exceeds the remaining prize budget of ₹${Math.max(0, budget - alreadyPaid)}.`, 'OVER_BUDGET', {
      budget,
      alreadyPaid,
      requested: total,
      remaining: Math.max(0, budget - alreadyPaid),
    });
  }

  const distribution = {
    id: uid('dist'),
    matchId: match.id,
    matchTitle: match.title,
    adminId,
    budget,
    total,
    createdAt: now(),
    winners: [],
    status: 'processing',
  };

  for (const entry of cleanEntries) {
    const participant = matchParticipant(match, entry.userId);
    const user = findUser(data, entry.userId);
    const existing = data.transactions.find(
      (t) => t.matchId === match.id && t.userId === entry.userId && t.type === 'prize' && t.status === 'completed',
    );
    if (!user) {
      distribution.winners.push({ ...entry, status: 'failed', error: 'User not found', transactionId: null });
      continue;
    }
    if (existing) {
      distribution.winners.push({
        ...entry,
        username: user.username,
        status: 'already_paid',
        transactionId: existing.id,
      });
      continue;
    }
    if (user.banned) {
      distribution.winners.push({
        ...entry,
        username: user.username,
        status: 'failed',
        error: 'Account is blocked. Retry after unblocking or handle manually.',
        transactionId: null,
      });
      continue;
    }
    const tx = creditWallet(data, user, 'winning', entry.amount, {
      type: 'prize',
      description: `Prize for ${match.title}${entry.rank ? ` (Rank #${entry.rank})` : ''}`,
      matchId: match.id,
      reference: distribution.id,
      adminId,
    });
    participant.prize = Math.round(((participant.prize || 0) + entry.amount) * 100) / 100;
    participant.rank = entry.rank ?? participant.rank ?? null;
    participant.payoutStatus = 'paid';
    participant.payoutTransactionId = tx.id;
    distribution.winners.push({
      ...entry,
      username: user.username,
      status: 'paid',
      transactionId: tx.id,
    });
    await notifyUser(data, user.id, {
      title: 'Congratulations! Prize credited 🏆',
      body: `You won ₹${entry.amount} in "${match.title}". The prize has been credited to your winning balance.`,
      type: 'prize',
      matchId: match.id,
      clickAction: '/wins',
      dedupeKey: `prize:${match.id}:${user.id}:${tx.id}`,
    });
  }

  const paid = distribution.winners.filter((w) => w.status === 'paid');
  const failed = distribution.winners.filter((w) => w.status === 'failed');
  distribution.status = failed.length === 0 ? 'completed' : paid.length ? 'partial' : 'failed';
  distribution.paidCount = paid.length;
  distribution.failedCount = failed.length;
  distribution.paidAmount = paid.reduce((sum, w) => sum + w.amount, 0);

  data.distributions.push(distribution);
  match.distributionIds = [...(match.distributionIds || []), distribution.id];
  match.prizesDistributed = distribution.status !== 'failed';
  match.resultsPublished = true;
  if (distribution.status !== 'failed') match.status = 'completed';
  match.activity.push({
    at: now(),
    actorId: adminId,
    action: 'prizes_distributed',
    detail: `₹${distribution.paidAmount} paid to ${paid.length} winner(s); ${failed.length} failed`,
  });

  return distribution;
}

export async function retryFailedPayout(data, match, distribution, userId, adminId) {
  const entry = distribution.winners.find((w) => w.userId === userId);
  if (!entry) fail(404, 'Winner not found in this distribution.', 'NOT_FOUND');
  if (entry.status === 'paid') fail(409, 'This payout has already been paid.', 'ALREADY_PAID');
  const participant = matchParticipant(match, userId);
  if (!participant) fail(400, 'Player is no longer a participant of this match.', 'NOT_PARTICIPANT');
  const user = findUser(data, userId);
  if (!user) fail(404, 'User not found.', 'NOT_FOUND');
  if (user.banned) fail(409, 'Account is blocked. Unblock it before retrying the payout.', 'USER_BLOCKED');

  const existing = data.transactions.find(
    (t) => t.matchId === match.id && t.userId === userId && t.type === 'prize' && t.status === 'completed',
  );
  if (existing) {
    entry.status = 'already_paid';
    entry.transactionId = existing.id;
    return { entry, transactionId: existing.id, status: 'already_paid' };
  }

  const remainingBudget = Number(match.prizePool) - data.transactions
    .filter((t) => t.matchId === match.id && t.type === 'prize' && t.status === 'completed')
    .reduce((sum, t) => sum + t.amount, 0);
  if (entry.amount > remainingBudget) {
    fail(400, 'Not enough prize budget remaining for this payout.', 'OVER_BUDGET');
  }

  const tx = creditWallet(data, user, 'winning', entry.amount, {
    type: 'prize',
    description: `Prize retry for ${match.title}${entry.rank ? ` (Rank #${entry.rank})` : ''}`,
    matchId: match.id,
    reference: distribution.id,
    adminId,
  });
  entry.status = 'paid';
  entry.transactionId = tx.id;
  entry.error = null;
  entry.retriedAt = now();
  participant.prize = Math.round(((participant.prize || 0) + entry.amount) * 100) / 100;
  participant.payoutStatus = 'paid';
  participant.payoutTransactionId = tx.id;

  const remainingFailed = distribution.winners.filter((w) => w.status === 'failed').length;
  distribution.status = remainingFailed ? 'partial' : 'completed';
  distribution.paidAmount = distribution.winners
    .filter((w) => ['paid', 'already_paid'].includes(w.status))
    .reduce((sum, w) => sum + w.amount, 0);
  distribution.paidCount = distribution.winners.filter((w) => ['paid', 'already_paid'].includes(w.status)).length;
  distribution.failedCount = remainingFailed;
  match.prizesDistributed = true;
  match.status = 'completed';
  match.activity.push({ at: now(), actorId: adminId, action: 'payout_retried', detail: `₹${entry.amount} to ${user.username}` });

  await notifyUser(data, user.id, {
    title: 'Prize credited 🏆',
    body: `Your pending prize of ₹${entry.amount} for "${match.title}" has been credited to your winning balance.`,
    type: 'prize',
    matchId: match.id,
    clickAction: '/wins',
    dedupeKey: `prize:${match.id}:${user.id}:${tx.id}`,
  });

  return { entry, transactionId: tx.id, status: 'paid' };
}
