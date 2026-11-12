import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { createApp } from '../src/app.js';
import { seed } from '../src/seed.js';
import { findMatch } from '../src/services.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-arena-test-'));
const store = new Store({ file: path.join(tmpDir, 'data.json') });
await seed(store);
const app = createApp(store, { logger: { error: () => {} } });
const server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;

async function api(pathname, { token, method = 'GET', body } = {}) {
  const res = await fetch(base + pathname, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, body: json, text };
}

const uniq = Date.now().toString(36);

const state = {
  user: null,
  token: null,
  otherToken: null,
  otherDeviceId: null,
  admin: null,
  adminToken: null,
  matchId: null,
  prizeMatchId: null,
  secondUserId: null,
  expiryMatchId: null,
};

test('backend boots and seeds demo data', async () => {
  const health = await api('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);
  assert.ok(health.body.users >= 8);
  assert.ok(health.body.matches >= 6);
});

test('new account: profile, wallet bonus, exactly one welcome notification', async () => {
  const email = `tester-${uniq}@example.com`;
  const reg = await api('/api/auth/register', {
    method: 'POST',
    body: {
      email,
      password: 'TestPass123',
      username: `Tester${uniq.slice(-4)}`,
      gameUid: '99881122',
      device: {
        name: 'Test iPhone',
        os: 'iOS 18',
        browser: 'Safari',
        fingerprint: `fp-${uniq}-a`,
        model: 'iPhone 15',
      },
    },
  });
  assert.equal(reg.status, 201, reg.text);
  assert.ok(reg.body.token);
  assert.equal(reg.body.user.wallet.balance, 25, 'registration bonus should be credited');
  assert.equal(reg.body.user.role, 'user');
  assert.equal(reg.body.user.passwordHash, undefined);

  state.user = reg.body.user;
  state.token = reg.body.token;
  state.email = email;

  const notifications = await api('/api/notifications', { token: state.token });
  assert.equal(notifications.status, 200);
  const welcome = notifications.body.notifications.filter((n) => n.type === 'welcome');
  assert.equal(welcome.length, 1, 'welcome notification must not be duplicated');
  assert.match(welcome[0].body, /successfully created/i);

  const relogin = await api('/api/auth/login', {
    method: 'POST',
    body: {
      email,
      password: 'TestPass123',
      device: { name: 'Test iPhone', os: 'iOS 18', browser: 'Safari', fingerprint: `fp-${uniq}-a` },
    },
  });
  assert.equal(relogin.status, 200);
  assert.equal(relogin.body.newDevice, false, 'same device must not be reported as new');

  const again = await api('/api/notifications', { token: relogin.body.token });
  assert.equal(again.body.notifications.filter((n) => n.type === 'welcome').length, 1);
  state.token = relogin.body.token;
});

test('new device login raises a security alert and is listed in device management', async () => {
  const login = await api('/api/auth/login', {
    method: 'POST',
    body: {
      email: state.email,
      password: 'TestPass123',
      device: { name: 'Windows Computer', os: 'Windows 11', browser: 'Chrome', fingerprint: `fp-${uniq}-b` },
    },
  });
  assert.equal(login.status, 200);
  assert.equal(login.body.newDevice, true);
  state.otherToken = login.body.token;

  const notifications = await api('/api/notifications', { token: state.token });
  const alert = notifications.body.notifications.find((n) => n.type === 'security' && /new login/i.test(n.title));
  assert.ok(alert, 'owner must receive a new device login alert');

  const devices = await api('/api/devices', { token: state.token });
  assert.equal(devices.status, 200);
  assert.equal(devices.body.devices.length, 2);
  assert.equal(devices.body.devices.filter((d) => d.current).length, 1);
  const other = devices.body.devices.find((d) => !d.current);
  assert.ok(other);
  state.otherDeviceId = other.id;

  const activity = await api('/api/security/activity', { token: state.token });
  assert.ok(activity.body.events.some((e) => e.type === 'new_device_login'));

  const forbidden = await api(`/api/devices/${other.id}/revoke`, { method: 'POST', token: state.adminToken || state.token });
  assert.equal(forbidden.status, 200, 'user can revoke their own device');

  const stale = await api('/api/profile', { token: state.otherToken });
  assert.equal(stale.status, 401);
  assert.equal(stale.body.error.code, 'SESSION_REVOKED');
});

test('admin login and server-side role enforcement', async () => {
  const userAttempt = await api('/api/admin/auth/login', {
    method: 'POST',
    body: { email: state.email, password: 'TestPass123' },
  });
  assert.equal(userAttempt.status, 403);

  const playerOverview = await api('/api/admin/overview', { token: state.token });
  assert.equal(playerOverview.status, 403);

  const admin = await api('/api/admin/auth/login', {
    method: 'POST',
    body: { email: 'admin@firearena.gg', password: 'Admin@12345', device: { name: 'Admin Desk', os: 'Linux', browser: 'Chrome', fingerprint: 'admin-fp' } },
  });
  assert.equal(admin.status, 200, admin.text);
  assert.equal(admin.body.user.role, 'admin');
  state.adminToken = admin.body.token;
  state.admin = admin.body.user;

  const overview = await api('/api/admin/overview', { token: state.adminToken });
  assert.equal(overview.status, 200);
  assert.ok(overview.body.totals.users >= 8);
  assert.ok(overview.body.charts.length === 7);
});

test('match creation, joining, wallet debit and duplicate protection', async () => {
  const create = await api('/api/admin/matches', {
    method: 'POST',
    token: state.adminToken,
    body: {
      title: `Automated Test Match ${uniq}`,
      mode: 'solo',
      map: 'Bermuda',
      entryFee: 20,
      prizePool: 100,
      totalSlots: 4,
      startTime: new Date(Date.now() + 2 * 3600_000).toISOString(),
      registrationCloseTime: new Date(Date.now() + 90 * 60_000).toISOString(),
      expiryTime: new Date(Date.now() + 5 * 3600_000).toISOString(),
      roomId: 'ROOM-TEST-1',
      roomPassword: 'pass123',
    },
  });
  assert.equal(create.status, 201, create.text);
  state.matchId = create.body.match.id;

  const invalid = await api('/api/admin/matches', {
    method: 'POST',
    token: state.adminToken,
    body: { title: 'x', startTime: 'nope', totalSlots: 4, entryFee: 10, prizePool: 10 },
  });
  assert.equal(invalid.status, 400);

  const asPlayer = await api('/api/admin/matches', { method: 'POST', token: state.token, body: { title: 'nope' } });
  assert.equal(asPlayer.status, 403);

  const before = await api('/api/wallet', { token: state.token });
  const startBalance = before.body.wallet.balance;

  const join = await api(`/api/matches/${state.matchId}/join`, {
    method: 'POST',
    token: state.token,
    body: { ingameName: 'TestPlayer', teamName: 'Test Squad' },
  });
  assert.equal(join.status, 201, join.text);
  assert.equal(join.body.wallet.balance, Math.round((startBalance - 20) * 100) / 100);

  const dup = await api(`/api/matches/${state.matchId}/join`, { method: 'POST', token: state.token });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error.code, 'ALREADY_JOINED');

  const tx = await api('/api/wallet/transactions', { token: state.token });
  const entry = tx.body.transactions.find((t) => t.type === 'entry_fee' && t.matchId === state.matchId);
  assert.ok(entry);
  assert.equal(entry.amount, 20);

  // Room credentials: participant sees them, outsider does not.
  const playerView = await api(`/api/matches/${state.matchId}`, { token: state.token });
  assert.equal(playerView.body.match.roomId, 'ROOM-TEST-1');

  const stranger = await api('/api/auth/register', {
    method: 'POST',
    body: {
      email: `stranger-${uniq}@example.com`,
      password: 'TestPass123',
      username: `Stranger${uniq.slice(-4)}`,
      device: { name: 'Stranger PC', os: 'Windows', browser: 'Edge', fingerprint: `fp-${uniq}-s` },
    },
  });
  assert.equal(stranger.status, 201);
  state.secondUserId = stranger.body.user.id;
  state.secondToken = stranger.body.token;
  state.secondEmail = stranger.body.user.email;
  const strangerView = await api(`/api/matches/${state.matchId}`, { token: state.secondToken });
  assert.equal(strangerView.body.match.roomId, null);
  assert.equal(strangerView.body.match.roomPassword, null);
});

test('room credential update notifies every registered participant', async () => {
  const update = await api(`/api/admin/matches/${state.matchId}`, {
    method: 'PATCH',
    token: state.adminToken,
    body: { roomId: 'ROOM-NEW-9', roomPassword: 'newpass99' },
  });
  assert.equal(update.status, 200, update.text);

  const notifications = await api('/api/notifications', { token: state.token });
  const alert = notifications.body.notifications.find((n) => /room updated/i.test(n.title));
  assert.ok(alert, 'participants must be notified about room updates');

  const activity = await api(`/api/admin/matches/${state.matchId}/activity`, { token: state.adminToken });
  assert.ok(activity.body.updateHistory.length >= 1);

  const playerView = await api(`/api/matches/${state.matchId}`, { token: state.token });
  assert.equal(playerView.body.match.roomId, 'ROOM-NEW-9');
});

test('wallet cannot be modified directly by a user', async () => {
  const before = await api('/api/wallet', { token: state.token });
  const attempt = await api('/api/profile', {
    method: 'PUT',
    token: state.token,
    body: { wallet: { balance: 999999 }, amount: 5000 },
  });
  assert.equal(attempt.status, 200);
  const after = await api('/api/wallet', { token: state.token });
  assert.equal(after.body.wallet.balance, before.body.wallet.balance, 'client-supplied wallet fields must be ignored');

  const tx = await api('/api/wallet/transactions', {
    method: 'POST',
    token: state.token,
    body: { amount: 1000 },
  });
  assert.equal(tx.status, 404);
});

test('deposit approval credits the wallet exactly once', async () => {
  const before = await api('/api/wallet', { token: state.token });
  const deposit = await api('/api/wallet/deposit', {
    method: 'POST',
    token: state.token,
    body: { amount: 100, reference: `UTR-${uniq}`, method: 'upi' },
  });
  assert.equal(deposit.status, 201, deposit.text);

  const approval = await api(`/api/admin/deposits/${deposit.body.deposit.id}/approve`, {
    method: 'POST',
    token: state.adminToken,
  });
  assert.equal(approval.status, 200, approval.text);
  assert.equal(approval.body.wallet.balance, Math.round((before.body.wallet.balance + 100) * 100) / 100);

  const duplicate = await api(`/api/admin/deposits/${deposit.body.deposit.id}/approve`, {
    method: 'POST',
    token: state.adminToken,
  });
  assert.equal(duplicate.status, 409);

  const invalid = await api('/api/wallet/deposit', {
    method: 'POST',
    token: state.token,
    body: { amount: 1, reference: 'x' },
  });
  assert.equal(invalid.status, 400);
});

test('withdrawal holds funds and rejection returns them', async () => {
  const before = await api('/api/wallet', { token: state.token });
  const withdrawal = await api('/api/wallet/withdraw', {
    method: 'POST',
    token: state.token,
    body: { amount: 60, upiId: 'tester@upi' },
  });
  assert.equal(withdrawal.status, 201, withdrawal.text);

  const afterRequest = await api('/api/wallet', { token: state.token });
  assert.equal(afterRequest.body.wallet.balance, Math.round((before.body.wallet.balance - 60) * 100) / 100);

  const reject = await api(`/api/admin/withdrawals/${withdrawal.body.withdrawal.id}/reject`, {
    method: 'POST',
    token: state.adminToken,
    body: { reason: 'Test rejection' },
  });
  assert.equal(reject.status, 200);
  assert.equal(reject.body.wallet.balance, before.body.wallet.balance);
});

test('automatic expiration refunds each player exactly once (idempotent job)', async () => {
  const create = await api('/api/admin/matches', {
    method: 'POST',
    token: state.adminToken,
    body: {
      title: `Expiry Test ${uniq}`,
      mode: 'solo',
      entryFee: 20,
      prizePool: 100,
      totalSlots: 10,
      startTime: new Date(Date.now() + 3600_000).toISOString(),
      registrationCloseTime: new Date(Date.now() + 3000_000).toISOString(),
      expiryTime: new Date(Date.now() + 7200_000).toISOString(),
      roomId: 'EXP-ROOM',
      roomPassword: 'EXP-PASS',
    },
  });
  assert.equal(create.status, 201, create.text);
  state.expiryMatchId = create.body.match.id;

  const join = await api(`/api/matches/${state.expiryMatchId}/join`, { method: 'POST', token: state.token });
  assert.equal(join.status, 201, join.text);
  const balanceBefore = join.body.wallet.balance;

  // Simulate the clock passing the configured expiry time.
  await store.tx((data) => {
    const m = findMatch(data, state.expiryMatchId);
    m.expiryTime = new Date(Date.now() - 1000).toISOString();
  });

  const run1 = await api('/api/admin/jobs/expire-matches', { method: 'POST', token: state.adminToken });
  assert.equal(run1.status, 200, run1.text);
  assert.ok(run1.body.run.expired.includes(state.expiryMatchId));
  assert.ok(run1.body.run.refunds >= 1);

  const walletAfter = await api('/api/wallet', { token: state.token });
  assert.equal(walletAfter.body.wallet.balance, Math.round((balanceBefore + 20) * 100) / 100);

  const run2 = await api('/api/admin/jobs/expire-matches', { method: 'POST', token: state.adminToken });
  assert.equal(run2.status, 200);
  assert.equal(run2.body.run.refunds, 0, 'second pass must not refund again');

  const walletAgain = await api('/api/wallet', { token: state.token });
  assert.equal(walletAgain.body.wallet.balance, walletAfter.body.wallet.balance);

  const tx = await api('/api/wallet/transactions?type=refund', { token: state.token });
  const refunds = tx.body.transactions.filter((t) => t.matchId === state.expiryMatchId);
  assert.equal(refunds.length, 1, 'exactly one refund transaction');

  const view = await api(`/api/matches/${state.expiryMatchId}`, { token: state.token });
  assert.equal(view.body.match.status, 'expired');
  assert.equal(view.body.match.roomId, null, 'expired room credentials must be hidden');
});

test('prize distribution: budget guard, atomic payouts, partial failure retry', async () => {
  const create = await api('/api/admin/matches', {
    method: 'POST',
    token: state.adminToken,
    body: {
      title: `Prize Test ${uniq}`,
      mode: 'solo',
      entryFee: 0,
      prizePool: 300,
      totalSlots: 8,
      startTime: new Date(Date.now() + 3600_000).toISOString(),
      registrationCloseTime: new Date(Date.now() + 1800_000).toISOString(),
      expiryTime: new Date(Date.now() + 7200_000).toISOString(),
    },
  });
  assert.equal(create.status, 201, create.text);
  state.prizeMatchId = create.body.match.id;

  const joinA = await api(`/api/matches/${state.prizeMatchId}/join`, { method: 'POST', token: state.token });
  assert.equal(joinA.status, 201);
  const joinB = await api(`/api/matches/${state.prizeMatchId}/join`, { method: 'POST', token: state.secondToken });
  assert.equal(joinB.status, 201);

  const results = await api(`/api/admin/matches/${state.prizeMatchId}/results`, {
    method: 'POST',
    token: state.adminToken,
    body: {
      results: [
        { userId: state.user.id, rank: 1 },
        { userId: state.secondUserId, rank: 2 },
      ],
    },
  });
  assert.equal(results.status, 200, results.text);

  const overBudget = await api(`/api/admin/matches/${state.prizeMatchId}/distribute-prizes`, {
    method: 'POST',
    token: state.adminToken,
    body: { winners: [{ userId: state.user.id, amount: 250, rank: 1 }, { userId: state.secondUserId, amount: 100, rank: 2 }] },
  });
  assert.equal(overBudget.status, 400);
  assert.equal(overBudget.body.error.code, 'OVER_BUDGET');

  const nonParticipant = await api(`/api/admin/matches/${state.prizeMatchId}/distribute-prizes`, {
    method: 'POST',
    token: state.adminToken,
    body: { winners: [{ userId: 'usr_not_here', amount: 10, rank: 1 }] },
  });
  assert.equal(nonParticipant.status, 400);

  // Block the second winner so their payout fails while the first succeeds.
  const block = await api(`/api/admin/users/${state.secondUserId}`, {
    method: 'PATCH',
    token: state.adminToken,
    body: { banned: true, note: 'test block for payout failure' },
  });
  assert.equal(block.status, 200);

  const walletBefore = await api('/api/wallet', { token: state.token });
  const dist = await api(`/api/admin/matches/${state.prizeMatchId}/distribute-prizes`, {
    method: 'POST',
    token: state.adminToken,
    body: {
      winners: [
        { userId: state.user.id, amount: 100, rank: 1 },
        { userId: state.secondUserId, amount: 50, rank: 2 },
      ],
    },
  });
  assert.equal(dist.status, 201, dist.text);
  assert.equal(dist.body.distribution.status, 'partial');
  const paid = dist.body.distribution.winners.find((w) => w.userId === state.user.id);
  const failed = dist.body.distribution.winners.find((w) => w.userId === state.secondUserId);
  assert.equal(paid.status, 'paid');
  assert.equal(failed.status, 'failed');

  const walletAfter = await api('/api/wallet', { token: state.token });
  assert.equal(walletAfter.body.wallet.winning, Math.round((walletBefore.body.wallet.winning + 100) * 100) / 100);

  // Re-running the same distribution must not pay the successful winner twice.
  const repeat = await api(`/api/admin/matches/${state.prizeMatchId}/distribute-prizes`, {
    method: 'POST',
    token: state.adminToken,
    body: {
      winners: [
        { userId: state.user.id, amount: 100, rank: 1 },
        { userId: state.secondUserId, amount: 50, rank: 2 },
      ],
    },
  });
  assert.equal(repeat.status, 201);
  const repeatPaid = repeat.body.distribution.winners.find((w) => w.userId === state.user.id);
  assert.equal(repeatPaid.status, 'already_paid');
  const walletRepeat = await api('/api/wallet', { token: state.token });
  assert.equal(walletRepeat.body.wallet.winning, walletAfter.body.wallet.winning, 'no duplicate prize credit');

  // Unblock and retry the failed payout.
  await api(`/api/admin/users/${state.secondUserId}`, { method: 'PATCH', token: state.adminToken, body: { banned: false } });
  const distributionId = dist.body.distribution.id;
  const retry = await api(`/api/admin/matches/${state.prizeMatchId}/distributions/${distributionId}/retry`, {
    method: 'POST',
    token: state.adminToken,
    body: { userId: state.secondUserId },
  });
  assert.equal(retry.status, 200, retry.text);
  assert.equal(retry.body.status, 'paid');

  const retryAgain = await api(`/api/admin/matches/${state.prizeMatchId}/distributions/${distributionId}/retry`, {
    method: 'POST',
    token: state.adminToken,
    body: { userId: state.secondUserId },
  });
  assert.equal(retryAgain.status, 409, 'paid winner cannot be paid twice');

  // Repeating a fully-paid distribution must never move more money.
  const overshoot = await api(`/api/admin/matches/${state.prizeMatchId}/distribute-prizes`, {
    method: 'POST',
    token: state.adminToken,
    body: { winners: [{ userId: state.user.id, amount: 200, rank: 1 }] },
  });
  assert.equal(overshoot.status, 201);
  assert.equal(overshoot.body.distribution.winners[0].status, 'already_paid');
});

test('cancelling a match refunds players and preserves history', async () => {
  const create = await api('/api/admin/matches', {
    method: 'POST',
    token: state.adminToken,
    body: {
      title: `Cancel Test ${uniq}`,
      mode: 'solo',
      entryFee: 15,
      prizePool: 60,
      totalSlots: 8,
      startTime: new Date(Date.now() + 3600_000).toISOString(),
      registrationCloseTime: new Date(Date.now() + 1800_000).toISOString(),
      expiryTime: new Date(Date.now() + 7200_000).toISOString(),
    },
  });
  assert.equal(create.status, 201, create.text);
  const matchId = create.body.match.id;
  const relogin = await api('/api/auth/login', {
    method: 'POST',
    body: {
      email: state.secondEmail,
      password: 'TestPass123',
      device: { name: 'Stranger PC', os: 'Windows', browser: 'Edge', fingerprint: `fp-${uniq}-s2` },
    },
  });
  assert.equal(relogin.status, 200, relogin.text);
  state.secondToken = relogin.body.token;
  const join = await api(`/api/matches/${matchId}/join`, { method: 'POST', token: state.secondToken });
  assert.equal(join.status, 201, join.text);
  const balanceAfterJoin = join.body.wallet.balance;

  const cancel = await api(`/api/admin/matches/${matchId}/cancel`, {
    method: 'POST',
    token: state.adminToken,
    body: { reason: 'Test cancellation' },
  });
  assert.equal(cancel.status, 200, cancel.text);
  assert.equal(cancel.body.cancelled, true);

  const wallet = await api('/api/wallet', { token: state.secondToken });
  assert.equal(wallet.body.wallet.balance, Math.round((balanceAfterJoin + 15) * 100) / 100);

  const cancelAgain = await api(`/api/admin/matches/${matchId}/cancel`, { method: 'POST', token: state.adminToken });
  assert.equal(cancelAgain.status, 200);

  const view = await api(`/api/matches/${matchId}`, { token: state.secondToken });
  assert.equal(view.body.match.status, 'cancelled');
  assert.equal(view.body.match.roomId, null);

  const softDelete = await api(`/api/admin/matches/${matchId}`, { method: 'DELETE', token: state.adminToken });
  assert.equal(softDelete.status, 200);
  assert.equal(softDelete.body.softDeleted, true, 'financial records must be preserved via soft delete');

  const listed = await api('/api/admin/matches?includeDeleted=true', { token: state.adminToken });
  assert.ok(listed.body.matches.some((m) => m.id === matchId && m.deletedAt));

  const detail = await api(`/api/admin/users/${state.secondUserId}`, { token: state.adminToken });
  assert.ok(detail.body.transactions.some((t) => t.matchId === matchId && t.type === 'refund'));
});

test('admin notification centre targets audiences and records delivery', async () => {
  const send = await api('/api/admin/notifications', {
    method: 'POST',
    token: state.adminToken,
    body: {
      title: `Maintenance Notice ${uniq}`,
      body: 'Servers will restart at 2 AM.',
      audience: 'all',
      type: 'announcement',
      clickAction: '/notifications',
    },
  });
  assert.equal(send.status, 201, send.text);
  assert.ok(send.body.count >= 8);

  const mine = await api('/api/notifications', { token: state.token });
  const received = mine.body.notifications.find((n) => n.title.includes(uniq));
  assert.ok(received);
  assert.ok(received.delivery.status);

  const single = await api('/api/admin/notifications', {
    method: 'POST',
    token: state.adminToken,
    body: { title: 'Personal note', body: 'Only you.', audience: 'user', userId: state.user.id },
  });
  assert.equal(single.status, 201);
  assert.equal(single.body.count, 1);

  const matchAudience = await api('/api/admin/notifications', {
    method: 'POST',
    token: state.adminToken,
    body: { title: 'Match reminder', body: 'Room opens soon.', audience: 'match', matchId: state.matchId },
  });
  assert.equal(matchAudience.status, 201);
  assert.equal(matchAudience.body.count, 1);

  const badAudience = await api('/api/admin/notifications', {
    method: 'POST',
    token: state.adminToken,
    body: { title: 'x', body: 'y', audience: 'nope' },
  });
  assert.equal(badAudience.status, 400);
});

test('support tickets flow between player and admin', async () => {
  const ticket = await api('/api/support', {
    method: 'POST',
    token: state.token,
    body: { subject: 'Need help', message: 'My prize is missing.', category: 'wallet' },
  });
  assert.equal(ticket.status, 201, ticket.text);

  const reply = await api(`/api/admin/support/${ticket.body.ticket.id}/reply`, {
    method: 'POST',
    token: state.adminToken,
    body: { message: 'We are checking this for you.' },
  });
  assert.equal(reply.status, 201, reply.text);

  const list = await api('/api/support', { token: state.token });
  const found = list.body.tickets.find((t) => t.id === ticket.body.ticket.id);
  assert.equal(found.status, 'answered');
  assert.equal(found.replies.length, 2);
});

test('participant CSV export and financial report work', async () => {
  const csv = await fetch(`${base}/api/admin/matches/${state.matchId}/participants.csv`, {
    headers: { Authorization: `Bearer ${state.adminToken}` },
  });
  assert.equal(csv.status, 200);
  const text = await csv.text();
  assert.match(text, /Registration ID,Username/);
  assert.match(text, new RegExp(state.user.username));

  const report = await api('/api/admin/reports/financial', { token: state.adminToken });
  assert.equal(report.status, 200);
  assert.ok(report.body.summary.entryFees > 0);
  assert.ok(Array.isArray(report.body.transactions));
});

test('config updates are validated and reflected publicly', async () => {
  const update = await api('/api/admin/config', {
    method: 'PUT',
    token: state.adminToken,
    body: { minDeposit: 20, appName: 'Fire Arena Test' },
  });
  assert.equal(update.status, 200, update.text);

  const invalid = await api('/api/admin/config', {
    method: 'PUT',
    token: state.adminToken,
    body: { minDeposit: 500, maxDeposit: 100 },
  });
  assert.equal(invalid.status, 400);

  const publicConfig = await api('/api/config');
  assert.equal(publicConfig.status, 200);
  assert.equal(publicConfig.body.minDeposit, 20);
  assert.equal(publicConfig.body.push.configured, false, 'push must report honestly when FCM is not configured');
});

test('leaderboard, my matches, results and wins are consistent', async () => {
  const lb = await api('/api/leaderboard', { token: state.token });
  assert.equal(lb.status, 200);
  assert.ok(lb.body.leaderboard.length > 0);
  assert.ok(lb.body.leaderboard[0].totalWon >= lb.body.leaderboard.at(-1).totalWon);

  const mine = await api('/api/me/matches', { token: state.token });
  assert.ok(mine.body.matches.some((m) => m.id === state.matchId));

  const results = await api('/api/me/results', { token: state.token });
  assert.ok(results.body.results.some((r) => r.matchId === state.prizeMatchId));

  const wins = await api('/api/me/wins', { token: state.token });
  assert.ok(wins.body.wins.some((w) => w.matchId === state.prizeMatchId && w.prize === 100));
});

test('cleanup', async () => {
  await new Promise((resolve) => server.close(resolve));
  await store.flush();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
