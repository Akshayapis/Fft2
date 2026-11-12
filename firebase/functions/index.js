/* eslint-disable max-len */
/**
 * Fire Arena — Firebase Cloud Functions (production backend).
 *
 * These functions are the Firebase-native equivalent of the Node/Express backend in
 * `/backend`. Deploy either one; both expose the same financial guarantees:
 *
 *  - wallets are only mutated inside Firestore transactions,
 *  - every money movement writes an append-only ledger document,
 *  - refunds and prizes use deterministic document ids so a retry can never double-pay,
 *  - admin authorisation is verified from the auth custom claim `admin === true`,
 *  - notifications are always stored in-app and pushed through FCM when a token exists.
 */
const crypto = require('crypto');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { setGlobalOptions } = require('firebase-functions/v2');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { getAuth } = require('firebase-admin/auth');

initializeApp();
const db = getFirestore();
setGlobalOptions({ region: 'asia-south1', maxInstances: 20 });

const DEFAULT_CONFIG = {
  appName: 'Fire Arena',
  currency: 'INR',
  minDeposit: 10,
  maxDeposit: 10000,
  minWithdrawal: 50,
  maxWithdrawal: 5000,
  registrationBonus: 25,
  upiId: 'firearena@upi',
  supportEmail: 'support@firearena.gg',
  maintenanceMode: false,
  allowRegistration: true,
};

const round = (value) => Math.round(Number(value) * 100) / 100;
const fail = (code, message) => {
  throw new HttpsError(code, message);
};

function requireAuth(request) {
  if (!request.auth) fail('unauthenticated', 'Sign in required.');
  return request.auth;
}

async function requireAdmin(request) {
  const auth = requireAuth(request);
  if (auth.token.admin !== true) fail('permission-denied', 'Administrator privileges required.');
  return auth;
}

async function config() {
  const snap = await db.doc('config/app').get();
  return { ...DEFAULT_CONFIG, ...(snap.exists ? snap.data() : {}) };
}

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

async function pushToTokens(tokens, title, body, data = {}) {
  const unique = [...new Set((tokens || []).filter(Boolean))];
  if (!unique.length) return { status: 'no_devices', successCount: 0, failureCount: 0, invalid: [] };
  try {
    const res = await getMessaging().sendEachForMulticast({
      tokens: unique,
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v ?? '')])),
      webpush: {
        notification: { title, body, icon: '/icon-192.png' },
        fcmOptions: data.clickAction ? { link: data.clickAction } : undefined,
      },
    });
    const invalid = [];
    res.responses.forEach((r, i) => {
      if (!r.success && /registration-token-not-registered|invalid-argument/.test(r.error?.code || '')) invalid.push(unique[i]);
    });
    return { status: res.successCount ? 'sent' : 'failed', successCount: res.successCount, failureCount: res.failureCount, invalid };
  } catch (error) {
    return { status: 'failed', successCount: 0, failureCount: unique.length, invalid: [], error: error.message };
  }
}

/**
 * Creates an in-app notification (always) and attempts FCM push.
 * `dedupeId` guarantees at-most-once creation.
 */
async function notifyUser({ userId, title, body, type = 'general', matchId = null, clickAction = '/notifications', image = null, dedupeId = null }) {
  const ref = dedupeId ? db.collection('notifications').doc(dedupeId) : db.collection('notifications').doc();
  const existing = dedupeId ? await ref.get() : null;
  if (existing && existing.exists) return existing.data();

  const deviceSnap = await db.collection('users').doc(userId).collection('devices').where('revoked', '==', false).get();
  const tokens = deviceSnap.docs.map((d) => d.data().fcmToken).filter(Boolean);

  const notification = {
    userId,
    title,
    body,
    image: image || null,
    type,
    matchId,
    clickAction,
    read: false,
    createdAt: FieldValue.serverTimestamp(),
    delivery: { status: 'pending', provider: 'fcm', targetCount: tokens.length, successCount: 0 },
  };
  await ref.set(notification);

  const report = await pushToTokens(tokens, title, body, { notificationId: ref.id, type, matchId: matchId || '', clickAction });
  await ref.update({
    delivery: {
      status: tokens.length ? report.status : 'no_devices',
      provider: 'fcm',
      targetCount: tokens.length,
      successCount: report.successCount || 0,
      failureCount: report.failureCount || 0,
      errors: report.error ? [report.error] : [],
    },
  });

  for (const token of report.invalid || []) {
    for (const doc of deviceSnap.docs) {
      if (doc.data().fcmToken === token) await doc.ref.update({ fcmToken: null });
    }
  }
  return notification;
}

async function notifyMany(userIds, payload) {
  const results = [];
  for (const userId of [...new Set(userIds)]) {
    results.push(await notifyUser({ ...payload, userId }));
  }
  return results.length;
}

/* ------------------------------------------------------------------ */
/* Ledger helpers (all called inside a transaction)                    */
/* ------------------------------------------------------------------ */

function addLedger(tx, payload) {
  const ref = payload.dedupeId ? db.collection('transactions').doc(payload.dedupeId) : db.collection('transactions').doc();
  tx.set(ref, {
    userId: payload.userId,
    type: payload.type,
    direction: payload.direction,
    bucket: payload.bucket || null,
    amount: round(payload.amount),
    status: payload.status || 'completed',
    description: payload.description || '',
    matchId: payload.matchId || null,
    reference: payload.reference || null,
    adminId: payload.adminId || null,
    createdAt: FieldValue.serverTimestamp(),
  });
  return ref.id;
}

function credit(tx, walletRef, wallet, bucket, amount) {
  const amounts = { balance: Number(wallet.balance) || 0, winning: Number(wallet.winning) || 0 };
  amounts[bucket] = round(amounts[bucket] + round(amount));
  const updates = { [bucket]: amounts[bucket], updatedAt: FieldValue.serverTimestamp() };
  if (bucket === 'winning') updates.totalWon = round((wallet.totalWon || 0) + amount);
  tx.set(walletRef, updates, { merge: true });
  return amounts[bucket];
}

function debit(tx, walletRef, wallet, bucket, amount) {
  const current = Number(wallet[bucket]) || 0;
  if (current < round(amount)) fail('failed-precondition', 'Insufficient balance.');
  const next = round(current - round(amount));
  tx.set(walletRef, { [bucket]: next, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return next;
}

/* ------------------------------------------------------------------ */
/* Account creation: profile + wallet + welcome notification           */
/* ------------------------------------------------------------------ */

exports.onUserCreated = onDocumentCreated({ document: 'users/{uid}', region: 'asia-south1' }, async (event) => {
  const snap = event.data;
  if (!snap) return;
  const uid = event.params.uid;
  const user = snap.data() || {};
  const cfg = await config();

  // Wallet is only ever created if missing: idempotent.
  const walletRef = db.collection('wallets').doc(uid);
  const walletSnap = await walletRef.get();
  if (!walletSnap.exists) {
    const bonus = round(cfg.registrationBonus || 0);
    await walletRef.set({
      userId: uid,
      balance: bonus,
      winning: 0,
      totalDeposited: 0,
      totalWithdrawn: 0,
      totalWon: 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (bonus > 0) {
      await db.collection('transactions').doc(`bonus_${uid}`).set({
        userId: uid,
        type: 'bonus',
        direction: 'credit',
        bucket: 'balance',
        amount: bonus,
        status: 'completed',
        description: 'Welcome registration bonus',
        createdAt: FieldValue.serverTimestamp(),
      });
    }
  }

  await notifyUser({
    userId: uid,
    title: 'Welcome to the arena! 🔥',
    body: `Welcome to ${cfg.appName}! Your account has been successfully created. Start exploring tournaments!`,
    type: 'welcome',
    clickAction: '/matches',
    dedupeId: `welcome_${uid}`,
  });

  await db.collection('securityEvents').add({
    userId: uid,
    type: 'account_created',
    message: 'Account created',
    createdAt: FieldValue.serverTimestamp(),
  });

  if (user.email) {
    await getAuth()
      .setCustomUserClaims(uid, { ...(typeof user.role === 'string' ? {} : {}), role: 'user' })
      .catch(() => undefined);
  }
});

/* ------------------------------------------------------------------ */
/* Devices & sessions                                                  */
/* ------------------------------------------------------------------ */

exports.registerDevice = onCall({ cors: true }, async (request) => {
  const auth = requireAuth(request);
  const { device = {}, fcmToken = null, platform = 'web', ip = null } = request.data || {};
  const fingerprint = String(device.fingerprint || device.name || 'unknown').slice(0, 200);
  const deviceId = crypto.createHash('sha256').update(`${auth.uid}|${fingerprint}`).digest('hex').slice(0, 32);

  const devicesRef = db.collection('users').doc(auth.uid).collection('devices');
  const before = await devicesRef.where('revoked', '==', false).get();
  const deviceRef = devicesRef.doc(deviceId);
  const existing = await deviceRef.get();

  await deviceRef.set(
    {
      id: deviceId,
      userId: auth.uid,
      name: String(device.name || 'Unknown device').slice(0, 80),
      model: String(device.model || '').slice(0, 60),
      os: String(device.os || '').slice(0, 60),
      browser: String(device.browser || '').slice(0, 60),
      platform,
      ip,
      fcmToken,
      revoked: false,
      firstLoginAt: existing.exists ? existing.data().firstLoginAt : FieldValue.serverTimestamp(),
      lastActiveAt: FieldValue.serverTimestamp(),
      tokenUpdatedAt: fcmToken ? FieldValue.serverTimestamp() : null,
    },
    { merge: true },
  );

  const isNew = !existing.exists;
  if (isNew && before.size > 0) {
    await notifyUser({
      userId: auth.uid,
      title: 'New login detected',
      body: `Your account was accessed from a new device (${device.os || 'Unknown OS'} · ${device.browser || 'Web'}${ip ? `, IP ${ip}` : ''}). If this wasn't you, secure your account immediately.`,
      type: 'security',
      clickAction: '/devices',
      dedupeId: `newlogin_${deviceId}_${new Date().toISOString().slice(0, 13)}`,
    });
    await db.collection('securityEvents').add({
      userId: auth.uid,
      type: 'new_device_login',
      message: `New device: ${device.name || 'unknown'}`,
      deviceId,
      ip,
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  return { deviceId, isNewDevice: isNew, activeDevices: before.size + (isNew ? 1 : 0) };
});

exports.revokeDevice = onCall({ cors: true }, async (request) => {
  const auth = requireAuth(request);
  const { deviceId, userId } = request.data || {};
  if (!deviceId) fail('invalid-argument', 'deviceId is required.');
  const ownerUid = auth.token.admin === true && userId ? userId : auth.uid;
  const ref = db.collection('users').doc(ownerUid).collection('devices').doc(deviceId);
  const snap = await ref.get();
  if (!snap.exists) fail('not-found', 'Device not found.');
  await ref.set({ revoked: true, fcmToken: null, revokedAt: FieldValue.serverTimestamp(), revokedBy: auth.uid }, { merge: true });
  await db.collection('securityEvents').add({
    userId: ownerUid,
    type: 'device_revoked',
    message: `Device ${snap.data().name} revoked`,
    deviceId,
    createdAt: FieldValue.serverTimestamp(),
  });
  return { ok: true, deviceId };
});

exports.logoutAllDevices = onCall({ cors: true }, async (request) => {
  const auth = requireAuth(request);
  const devices = await db.collection('users').doc(auth.uid).collection('devices').get();
  const batch = db.batch();
  devices.forEach((doc) => batch.set(doc.ref, { revoked: true, fcmToken: null }, { merge: true }));
  await batch.commit();
  await getAuth().revokeRefreshTokens(auth.uid);
  await db.collection('securityEvents').add({
    userId: auth.uid,
    type: 'logout_all_devices',
    message: 'Signed out from all devices',
    createdAt: FieldValue.serverTimestamp(),
  });
  return { ok: true, revoked: devices.size };
});

/* ------------------------------------------------------------------ */
/* Match registration                                                  */
/* ------------------------------------------------------------------ */

exports.joinMatch = onCall({ cors: true }, async (request) => {
  const auth = requireAuth(request);
  const { matchId, ingameName = '', teamName = '', gameUid = '', useWinnings = false } = request.data || {};
  if (!matchId) fail('invalid-argument', 'matchId is required.');

  const matchRef = db.collection('matches').doc(matchId);
  const regRef = matchRef.collection('participants').doc(auth.uid);
  const walletRef = db.collection('wallets').doc(auth.uid);

  const result = await db.runTransaction(async (tx) => {
    const [matchSnap, regSnap, walletSnap, userSnap] = await Promise.all([
      tx.get(matchRef),
      tx.get(regRef),
      tx.get(walletRef),
      tx.get(db.collection('users').doc(auth.uid)),
    ]);
    if (!matchSnap.exists) fail('not-found', 'Match not found.');
    if (regSnap.exists) fail('already-exists', 'You have already joined this match.');
    if (!walletSnap.exists) fail('failed-precondition', 'Wallet not initialised.');

    const match = matchSnap.data();
    const wallet = walletSnap.data();
    const user = userSnap.exists ? userSnap.data() : {};
    if (user.banned) fail('permission-denied', 'Account is blocked.');
    if (['cancelled', 'expired', 'completed'].includes(match.status)) fail('failed-precondition', 'Match is closed.');
    if (match.registrationPaused || match.registrationClosed) fail('failed-precondition', 'Registrations are closed.');
    const now = Date.now();
    if (match.registrationCloseTime && match.registrationCloseTime.toMillis() < now) fail('failed-precondition', 'Registration window closed.');
    if ((match.filledSlots || 0) >= match.totalSlots) fail('failed-precondition', 'Match is full.');

    const fee = round(match.entryFee || 0);
    const fromBalance = Math.min(Number(wallet.balance) || 0, fee);
    const remaining = round(fee - fromBalance);
    if (remaining > 0 && (!useWinnings || (Number(wallet.winning) || 0) < remaining)) {
      fail('failed-precondition', 'Insufficient wallet balance for the entry fee.');
    }

    let balance = Number(wallet.balance) || 0;
    let winning = Number(wallet.winning) || 0;
    if (fromBalance > 0) {
      balance = debit(tx, walletRef, wallet, 'balance', fromBalance);
      addLedger(tx, {
        userId: auth.uid,
        type: 'entry_fee',
        direction: 'debit',
        bucket: 'balance',
        amount: fromBalance,
        description: `Entry fee for ${match.title}`,
        matchId,
        dedupeId: `entry_${matchId}_${auth.uid}`,
      });
    }
    if (remaining > 0) {
      winning = debit(tx, walletRef, { ...wallet, balance }, 'winning', remaining);
      addLedger(tx, {
        userId: auth.uid,
        type: 'entry_fee',
        direction: 'debit',
        bucket: 'winning',
        amount: remaining,
        description: `Entry fee for ${match.title} (winnings)`,
        matchId,
        dedupeId: `entry_win_${matchId}_${auth.uid}`,
      });
    }

    tx.set(regRef, {
      userId: auth.uid,
      username: user.username || '',
      ingameName: String(ingameName || user.username || '').slice(0, 30),
      teamName: String(teamName || '').slice(0, 30),
      gameUid: String(gameUid || user.gameUid || '').slice(0, 32),
      registrationId: regRef.id,
      entryFeePaid: fee,
      joinedAt: FieldValue.serverTimestamp(),
      rank: null,
      prize: 0,
      payoutStatus: 'none',
      refunded: false,
    });
    tx.update(matchRef, {
      filledSlots: FieldValue.increment(1),
      activity: FieldValue.arrayUnion({ at: Timestamp.now(), action: 'joined', detail: `${user.username || auth.uid} joined` }),
    });

    return { balance, winning, matchTitle: match.title };
  });

  await notifyUser({
    userId: auth.uid,
    title: 'Match registration confirmed ✅',
    body: `You joined "${result.matchTitle}". Room details will appear in My Matches before the match starts.`,
    type: 'match',
    matchId,
    clickAction: '/my-matches',
    dedupeId: `joined_${matchId}_${auth.uid}`,
  });

  return { ok: true, balance: result.balance, winning: result.winning };
});

/* ------------------------------------------------------------------ */
/* Wallet: deposits and withdrawals                                    */
/* ------------------------------------------------------------------ */

exports.requestDeposit = onCall({ cors: true }, async (request) => {
  const auth = requireAuth(request);
  const cfg = await config();
  const { amount, reference, method = 'upi' } = request.data || {};
  const value = round(amount);
  if (!value || value < cfg.minDeposit || value > cfg.maxDeposit) fail('invalid-argument', 'Deposit amount outside allowed limits.');
  if (!reference) fail('invalid-argument', 'Payment reference is required.');

  const pending = await db.collection('deposits').where('userId', '==', auth.uid).where('status', '==', 'pending').get();
  if (pending.size >= 5) fail('resource-exhausted', 'Too many pending deposits.');

  const ref = await db.collection('deposits').add({
    userId: auth.uid,
    amount: value,
    method: String(method).slice(0, 20),
    reference: String(reference).slice(0, 80),
    status: 'pending',
    createdAt: FieldValue.serverTimestamp(),
  });
  return { depositId: ref.id };
});

exports.approveDeposit = onCall({ cors: true }, async (request) => {
  const auth = await requireAdmin(request);
  const { depositId } = request.data || {};
  const depositRef = db.collection('deposits').doc(depositId);
  const walletRef = db.collection('wallets').doc((await depositRef.get()).data()?.userId || 'missing');

  const outcome = await db.runTransaction(async (tx) => {
    const [depositSnap, walletSnap] = await Promise.all([tx.get(depositRef), tx.get(walletRef)]);
    if (!depositSnap.exists) fail('not-found', 'Deposit not found.');
    const deposit = depositSnap.data();
    if (deposit.status !== 'pending') fail('failed-precondition', `Deposit already ${deposit.status}.`);
    if (!walletSnap.exists) fail('failed-precondition', 'Wallet missing.');
    const wallet = walletSnap.data();
    const balance = credit(tx, walletRef, wallet, 'balance', deposit.amount);
    tx.set(walletRef, { totalDeposited: round((wallet.totalDeposited || 0) + deposit.amount) }, { merge: true });
    tx.update(depositRef, { status: 'approved', reviewedAt: FieldValue.serverTimestamp(), reviewedBy: auth.uid });
    addLedger(tx, {
      userId: deposit.userId,
      type: 'deposit',
      direction: 'credit',
      bucket: 'balance',
      amount: deposit.amount,
      description: `Deposit approved (${deposit.method})`,
      reference: depositId,
      adminId: auth.uid,
      dedupeId: `deposit_${depositId}`,
    });
    return { userId: deposit.userId, amount: deposit.amount, balance };
  });

  await notifyUser({
    userId: outcome.userId,
    title: `Deposit approved ₹${outcome.amount}`,
    body: `Your deposit of ₹${outcome.amount} has been credited to your wallet.`,
    type: 'wallet',
    clickAction: '/wallet',
    dedupeId: `deposit_approved_${depositId}`,
  });
  return outcome;
});

exports.rejectDeposit = onCall({ cors: true }, async (request) => {
  const auth = await requireAdmin(request);
  const { depositId, reason = 'Payment could not be verified' } = request.data || {};
  const depositRef = db.collection('deposits').doc(depositId);
  const depositSnap = await depositRef.get();
  if (!depositSnap.exists) fail('not-found', 'Deposit not found.');
  const deposit = depositSnap.data();
  if (deposit.status !== 'pending') fail('failed-precondition', `Deposit already ${deposit.status}.`);
  await depositRef.update({ status: 'rejected', rejectReason: String(reason).slice(0, 250), reviewedAt: FieldValue.serverTimestamp(), reviewedBy: auth.uid });
  await notifyUser({
    userId: deposit.userId,
    title: 'Deposit rejected',
    body: `Your deposit of ₹${deposit.amount} was rejected. Reason: ${reason}`,
    type: 'wallet',
    clickAction: '/wallet',
    dedupeId: `deposit_rejected_${depositId}`,
  });
  return { ok: true };
});

exports.requestWithdrawal = onCall({ cors: true }, async (request) => {
  const auth = requireAuth(request);
  const cfg = await config();
  const { amount, upiId } = request.data || {};
  const value = round(amount);
  if (!value || value < cfg.minWithdrawal || value > cfg.maxWithdrawal) fail('invalid-argument', 'Withdrawal amount outside allowed limits.');
  if (!/^[\w.\-]{2,}@[\w.\-]{2,}$/.test(String(upiId || ''))) fail('invalid-argument', 'Invalid UPI ID.');

  const walletRef = db.collection('wallets').doc(auth.uid);
  const withdrawalRef = db.collection('withdrawals').doc();

  const outcome = await db.runTransaction(async (tx) => {
    const walletSnap = await tx.get(walletRef);
    if (!walletSnap.exists) fail('failed-precondition', 'Wallet missing.');
    const wallet = walletSnap.data();
    if ((wallet.winning || 0) + (wallet.balance || 0) < value) fail('failed-precondition', 'Insufficient balance.');

    const fromWinning = Math.min(Number(wallet.winning) || 0, value);
    const fromBalance = round(value - fromWinning);
    let winning = Number(wallet.winning) || 0;
    let balance = Number(wallet.balance) || 0;
    if (fromWinning > 0) winning = debit(tx, walletRef, wallet, 'winning', fromWinning);
    if (fromBalance > 0) balance = debit(tx, walletRef, { ...wallet, winning }, 'balance', fromBalance);

    tx.set(withdrawalRef, {
      userId: auth.uid,
      amount: value,
      upiId: String(upiId).slice(0, 60),
      status: 'pending',
      breakdown: { winning: fromWinning, balance: fromBalance },
      createdAt: FieldValue.serverTimestamp(),
    });
    addLedger(tx, {
      userId: auth.uid,
      type: 'withdrawal_hold',
      direction: 'debit',
      bucket: fromWinning > 0 ? 'winning' : 'balance',
      amount: value,
      description: 'Withdrawal request (hold)',
      reference: withdrawalRef.id,
      dedupeId: `withdrawal_hold_${withdrawalRef.id}`,
    });
    return { withdrawalId: withdrawalRef.id, balance, winning };
  });

  return outcome;
});

exports.approveWithdrawal = onCall({ cors: true }, async (request) => {
  const auth = await requireAdmin(request);
  const { withdrawalId, utr = '' } = request.data || {};
  const withdrawalRef = db.collection('withdrawals').doc(withdrawalId);
  const withdrawalSnap = await withdrawalRef.get();
  if (!withdrawalSnap.exists) fail('not-found', 'Withdrawal not found.');
  const withdrawal = withdrawalSnap.data();
  if (withdrawal.status !== 'pending') fail('failed-precondition', `Withdrawal already ${withdrawal.status}.`);

  await db.runTransaction(async (tx) => {
    const fresh = await tx.get(withdrawalRef);
    if (fresh.data().status !== 'pending') fail('failed-precondition', 'Already processed.');
    const walletRef = db.collection('wallets').doc(withdrawal.userId);
    const walletSnap = await tx.get(walletRef);
    const wallet = walletSnap.data() || {};
    tx.set(walletRef, { totalWithdrawn: round((wallet.totalWithdrawn || 0) + withdrawal.amount) }, { merge: true });
    tx.update(withdrawalRef, { status: 'paid', utr, reviewedAt: FieldValue.serverTimestamp(), reviewedBy: auth.uid });
    addLedger(tx, {
      userId: withdrawal.userId,
      type: 'withdrawal',
      direction: 'debit',
      amount: withdrawal.amount,
      status: 'completed',
      description: `Withdrawal paid to ${withdrawal.upiId}`,
      reference: withdrawalId,
      adminId: auth.uid,
      dedupeId: `withdrawal_paid_${withdrawalId}`,
    });
  });

  await notifyUser({
    userId: withdrawal.userId,
    title: `Withdrawal paid ₹${withdrawal.amount}`,
    body: `Your withdrawal of ₹${withdrawal.amount} has been paid to ${withdrawal.upiId}.`,
    type: 'wallet',
    clickAction: '/wallet',
    dedupeId: `withdrawal_paid_note_${withdrawalId}`,
  });
  return { ok: true };
});

exports.rejectWithdrawal = onCall({ cors: true }, async (request) => {
  const auth = await requireAdmin(request);
  const { withdrawalId, reason = 'Rejected by admin' } = request.data || {};
  const withdrawalRef = db.collection('withdrawals').doc(withdrawalId);

  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(withdrawalRef);
    if (!snap.exists) fail('not-found', 'Withdrawal not found.');
    const withdrawal = snap.data();
    if (withdrawal.status !== 'pending') fail('failed-precondition', 'Already processed.');
    const walletRef = db.collection('wallets').doc(withdrawal.userId);
    const walletSnap = await tx.get(walletRef);
    const wallet = walletSnap.data() || {};
    const breakdown = withdrawal.breakdown || { winning: 0, balance: withdrawal.amount };
    if (breakdown.winning > 0) credit(tx, walletRef, wallet, 'winning', breakdown.winning);
    if (breakdown.balance > 0) credit(tx, walletRef, { ...wallet, winning: (wallet.winning || 0) + (breakdown.winning || 0) }, 'balance', breakdown.balance);
    tx.update(withdrawalRef, { status: 'rejected', rejectReason: String(reason).slice(0, 250), reviewedAt: FieldValue.serverTimestamp(), reviewedBy: auth.uid });
    addLedger(tx, {
      userId: withdrawal.userId,
      type: 'withdrawal_reversal',
      direction: 'credit',
      amount: withdrawal.amount,
      description: 'Withdrawal rejected — amount returned',
      reference: withdrawalId,
      adminId: auth.uid,
      dedupeId: `withdrawal_reversal_${withdrawalId}`,
    });
    return { userId: withdrawal.userId, amount: withdrawal.amount };
  });

  await notifyUser({
    userId: outcome.userId,
    title: 'Withdrawal rejected',
    body: `Your withdrawal of ₹${outcome.amount} was rejected and returned to your wallet. Reason: ${reason}`,
    type: 'wallet',
    clickAction: '/wallet',
    dedupeId: `withdrawal_rejected_${withdrawalId}`,
  });
  return { ok: true };
});

/* ------------------------------------------------------------------ */
/* Match updates & notifications                                       */
/* ------------------------------------------------------------------ */

exports.updateMatch = onCall({ cors: true }, async (request) => {
  const auth = await requireAdmin(request);
  const { matchId, patch = {} } = request.data || {};
  if (!matchId) fail('invalid-argument', 'matchId is required.');
  const allowed = ['title', 'map', 'mode', 'rules', 'startTime', 'registrationCloseTime', 'expiryTime', 'roomId', 'roomPassword', 'totalSlots', 'prizePool', 'perKill', 'registrationPaused', 'registrationClosed'];
  const update = {};
  for (const key of allowed) {
    if (patch[key] === undefined) continue;
    update[key] = ['startTime', 'registrationCloseTime', 'expiryTime'].includes(key) ? Timestamp.fromDate(new Date(patch[key])) : patch[key];
  }
  if (!Object.keys(update).length) fail('invalid-argument', 'Nothing to update.');

  await db.collection('matches').doc(matchId).update({
    ...update,
    updatedAt: FieldValue.serverTimestamp(),
    activity: FieldValue.arrayUnion({ at: Timestamp.now(), action: 'updated', detail: `Updated: ${Object.keys(update).join(', ')}`, actorId: auth.uid }),
  });

  if (['roomId', 'roomPassword', 'startTime', 'map', 'title'].some((k) => update[k] !== undefined)) {
    const participants = await db.collection('matches').doc(matchId).collection('participants').get();
    await notifyMany(
      participants.docs.map((d) => d.id),
      {
        title: 'Match room updated',
        body: 'Your tournament room details have changed. Open My Matches to view the latest information.',
        type: 'match',
        matchId,
        clickAction: '/my-matches',
      },
    );
  }
  return { ok: true, updated: Object.keys(update) };
});

exports.sendNotification = onCall({ cors: true }, async (request) => {
  await requireAdmin(request);
  const { title, body, audience = 'all', userId, userIds = [], matchId, type = 'announcement', clickAction = '/notifications', image = null } = request.data || {};
  if (!title || !body) fail('invalid-argument', 'Title and body are required.');

  let targets = [];
  if (audience === 'all') {
    const users = await db.collection('users').where('role', '==', 'user').get();
    targets = users.docs.map((d) => d.id);
  } else if (audience === 'user') {
    if (!userId) fail('invalid-argument', 'userId required.');
    targets = [userId];
  } else if (audience === 'users') {
    targets = userIds;
  } else if (audience === 'match') {
    const participants = await db.collection('matches').doc(matchId).collection('participants').get();
    targets = participants.docs.map((d) => d.id);
  } else if (audience === 'pending_deposits') {
    const rows = await db.collection('deposits').where('status', '==', 'pending').get();
    targets = rows.docs.map((d) => d.data().userId);
  } else if (audience === 'pending_withdrawals') {
    const rows = await db.collection('withdrawals').where('status', '==', 'pending').get();
    targets = rows.docs.map((d) => d.data().userId);
  } else {
    fail('invalid-argument', 'Unknown audience.');
  }

  const count = await notifyMany(targets, { title, body, type, matchId: matchId || null, clickAction, image });
  return { count };
});

/* ------------------------------------------------------------------ */
/* Prize distribution                                                  */
/* ------------------------------------------------------------------ */

exports.distributePrizes = onCall({ cors: true }, async (request) => {
  const auth = await requireAdmin(request);
  const { matchId, winners = [] } = request.data || {};
  if (!matchId || !winners.length) fail('invalid-argument', 'matchId and winners are required.');

  const matchRef = db.collection('matches').doc(matchId);
  const distributionRef = db.collection('prizeDistributions').doc();

  const outcome = await db.runTransaction(async (tx) => {
    const matchSnap = await tx.get(matchRef);
    if (!matchSnap.exists) fail('not-found', 'Match not found.');
    const match = matchSnap.data();
    if (['cancelled', 'expired'].includes(match.status)) fail('failed-precondition', 'Match is closed.');

    // Validate every winner is a participant and amounts are valid.
    const regs = await Promise.all(winners.map((w) => tx.get(matchRef.collection('participants').doc(w.userId))));
    winners.forEach((w, i) => {
      if (!regs[i].exists) fail('invalid-argument', 'Winner is not a participant of this match.');
      if (!(round(w.amount) > 0)) fail('invalid-argument', 'Prize amount must be positive.');
    });
    if (new Set(winners.map((w) => w.userId)).size !== winners.length) fail('invalid-argument', 'Duplicate winner.');

    // Remaining budget = prizePool - already paid.
    const paidSnap = await tx.get(db.collection('transactions').where('matchId', '==', matchId).where('type', '==', 'prize'));
    const alreadyPaid = paidSnap.docs.reduce((sum, d) => sum + (d.data().status === 'completed' ? Number(d.data().amount) || 0 : 0), 0);
    const requested = winners.reduce((sum, w) => sum + round(w.amount), 0);
    if (alreadyPaid + requested > round(match.prizePool)) fail('failed-precondition', 'Prize total exceeds the prize budget.');

    const results = [];
    for (const winner of winners) {
      const ledgerId = `prize_${matchId}_${winner.userId}`;
      const ledgerRef = db.collection('transactions').doc(ledgerId);
      const ledgerSnap = await tx.get(ledgerRef);
      if (ledgerSnap.exists && ledgerSnap.data().status === 'completed') {
        results.push({ ...winner, status: 'already_paid', transactionId: ledgerId });
        continue;
      }
      const walletRef = db.collection('wallets').doc(winner.userId);
      const walletSnap = await tx.get(walletRef);
      const userSnap = await tx.get(db.collection('users').doc(winner.userId));
      if (!walletSnap.exists) {
        results.push({ ...winner, status: 'failed', error: 'Wallet missing' });
        continue;
      }
      if (userSnap.exists && userSnap.data().banned) {
        results.push({ ...winner, status: 'failed', error: 'Account is blocked' });
        continue;
      }
      credit(tx, walletRef, walletSnap.data(), 'winning', winner.amount);
      tx.set(ledgerRef, {
        userId: winner.userId,
        type: 'prize',
        direction: 'credit',
        bucket: 'winning',
        amount: round(winner.amount),
        status: 'completed',
        description: `Prize for ${match.title}${winner.rank ? ` (Rank #${winner.rank})` : ''}`,
        matchId,
        reference: distributionRef.id,
        adminId: auth.uid,
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.set(regs[winners.indexOf(winner)].ref, {
        rank: winner.rank || null,
        prize: FieldValue.increment(round(winner.amount)),
        payoutStatus: 'paid',
        payoutTransactionId: ledgerId,
      }, { merge: true });
      results.push({ ...winner, status: 'paid', transactionId: ledgerId });
    }

    const paid = results.filter((r) => r.status === 'paid');
    const failed = results.filter((r) => r.status === 'failed');
    const status = failed.length ? (paid.length ? 'partial' : 'failed') : 'completed';
    tx.set(distributionRef, {
      matchId,
      matchTitle: match.title,
      adminId: auth.uid,
      budget: match.prizePool,
      total: requested,
      paidAmount: paid.reduce((s, r) => s + round(r.amount), 0),
      paidCount: paid.length,
      failedCount: failed.length,
      winners: results,
      winnerIds: winners.map((w) => w.userId),
      status,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.update(matchRef, {
      resultsPublished: true,
      prizesDistributed: status !== 'failed',
      status: status === 'failed' ? match.status : 'completed',
      distributionIds: FieldValue.arrayUnion(distributionRef.id),
    });
    return { distributionId: distributionRef.id, status, results, matchTitle: match.title };
  });

  for (const row of outcome.results.filter((r) => r.status === 'paid')) {
    await notifyUser({
      userId: row.userId,
      title: 'Congratulations! Prize credited 🏆',
      body: `You won ₹${round(row.amount)} in "${outcome.matchTitle}". The prize has been credited to your winning balance.`,
      type: 'prize',
      matchId,
      clickAction: '/wins',
      dedupeId: `prize_note_${matchId}_${row.userId}`,
    });
  }

  return outcome;
});

/* ------------------------------------------------------------------ */
/* Automatic expiration + refunds (reliable scheduled job)             */
/* ------------------------------------------------------------------ */

async function expireMatch(matchId, reason = 'scheduled') {
  const matchRef = db.collection('matches').doc(matchId);
  const participantsSnap = await matchRef.collection('participants').get();
  const refunded = [];

  for (const participant of participantsSnap.docs) {
    const uid = participant.id;
    const data = participant.data();
    if (data.refunded) continue;
    if (!data.entryFeePaid) continue;

    const result = await db.runTransaction(async (tx) => {
      const regRef = matchRef.collection('participants').doc(uid);
      const fresh = await tx.get(regRef);
      if (!fresh.exists || fresh.data().refunded) return { status: 'already_refunded' };
      const walletRef = db.collection('wallets').doc(uid);
      const walletSnap = await tx.get(walletRef);
      if (!walletSnap.exists) return { status: 'failed', error: 'wallet missing' };
      credit(tx, walletRef, walletSnap.data(), 'balance', fresh.data().entryFeePaid);
      const ledgerId = `refund_${matchId}_${uid}`;
      const ledgerSnap = await tx.get(db.collection('transactions').doc(ledgerId));
      if (ledgerSnap.exists) return { status: 'already_refunded' };
      addLedger(tx, {
        userId: uid,
        type: 'refund',
        direction: 'credit',
        bucket: 'balance',
        amount: fresh.data().entryFeePaid,
        description: `Refund for ${matchId} (${reason})`,
        matchId,
        dedupeId: ledgerId,
      });
      tx.update(regRef, { refunded: true, refundedAt: FieldValue.serverTimestamp() });
      return { status: 'refunded', amount: fresh.data().entryFeePaid };
    });
    if (result.status === 'refunded') refunded.push({ uid, amount: result.amount });
  }

  await matchRef.set(
    {
      status: 'expired',
      registrationClosed: true,
      roomCredentialsHidden: true,
      expiredAt: FieldValue.serverTimestamp(),
      refundSummary: { automatic: true, refunded: refunded.length, at: FieldValue.serverTimestamp() },
    },
    { merge: true },
  );
  await db.collection('matchPrivate').doc(matchId).delete().catch(() => undefined);

  for (const row of refunded) {
    await notifyUser({
      userId: row.uid,
      title: 'Match expired — entry fee refunded',
      body: `The tournament expired without completion. ₹${round(row.amount)} has been credited back to your wallet.`,
      type: 'refund',
      matchId,
      clickAction: '/wallet',
      dedupeId: `refund_note_${matchId}_${row.uid}`,
    });
  }
  await notifyMany(
    participantsSnap.docs.map((d) => d.id).filter((uid) => !refunded.some((r) => r.uid === uid)),
    { title: 'Match expired', body: 'This tournament expired. Please contact support if you need assistance.', type: 'refund', matchId, clickAction: '/support' },
  );

  return { matchId, refunded: refunded.length, refundedAmount: refunded.reduce((s, r) => s + r.amount, 0) };
}

exports.expireMatchesNow = onCall({ cors: true }, async (request) => {
  const auth = await requireAdmin(request);
  return runMaintenance('manual', auth.uid);
});

async function runMaintenance(reason = 'scheduled', actorId = null) {
  const now = Timestamp.now();
  const startedAt = Date.now();
  const due = await db
    .collection('matches')
    .where('expiryTime', '<=', now)
    .where('status', 'in', ['registration_open', 'paused', 'registration_closed', 'live'])
    .get();

  const expired = [];
  const errors = [];
  let refunds = 0;
  let refundedAmount = 0;

  for (const doc of due.docs) {
    try {
      const result = await expireMatch(doc.id, reason);
      expired.push(doc.id);
      refunds += result.refunded;
      refundedAmount += result.refundedAmount;
    } catch (error) {
      errors.push({ matchId: doc.id, message: error.message });
    }
  }

  const run = {
    at: FieldValue.serverTimestamp(),
    reason,
    actorId,
    scanned: due.size,
    expired,
    refunds,
    refundedAmount: round(refundedAmount),
    errors,
    durationMs: Date.now() - startedAt,
    status: errors.length ? (expired.length ? 'partial' : 'failed') : 'ok',
  };
  await db.collection('jobRuns').add(run);
  return run;
}

exports.scheduledMatchMaintenance = onSchedule(
  { schedule: 'every 5 minutes', timeZone: 'Asia/Kolkata', region: 'asia-south1', retryCount: 2 },
  async () => {
    await runMaintenance('scheduled', null);
  },
);

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

exports.updateConfig = onCall({ cors: true }, async (request) => {
  const auth = await requireAdmin(request);
  const patch = request.data?.config || {};
  const allowed = ['appName', 'currency', 'minDeposit', 'maxDeposit', 'minWithdrawal', 'maxWithdrawal', 'registrationBonus', 'upiId', 'supportEmail', 'supportWhatsapp', 'maintenanceMode', 'allowRegistration'];
  const update = {};
  for (const key of allowed) if (patch[key] !== undefined) update[key] = patch[key];
  if (!Object.keys(update).length) fail('invalid-argument', 'Nothing to update.');
  await db.doc('config/app').set({ ...update, updatedAt: FieldValue.serverTimestamp(), updatedBy: auth.uid }, { merge: true });
  return { ok: true };
});

exports.health = onCall({ cors: true }, async () => {
  const [users, matches] = await Promise.all([db.collection('users').count().get(), db.collection('matches').count().get()]);
  return { ok: true, users: users.data().count, matches: matches.data().count, time: new Date().toISOString() };
});
