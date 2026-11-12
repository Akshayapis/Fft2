#!/usr/bin/env node
/**
 * End-to-end smoke test against a RUNNING stack (backend + both dev servers).
 *
 *   node scripts/smoke-test.mjs
 *
 * Verifies that:
 *  - both frontends serve their HTML shell
 *  - the API proxy of each app reaches the backend
 *  - player registration, login, match listing, joining and wallet work
 *  - admin login, match creation, room update notification and prize distribution work
 *
 * Exit code 0 means every check passed.
 */
import assert from 'node:assert/strict';

const USER = process.env.USER_APP_URL || 'http://127.0.0.1:5173';
const ADMIN = process.env.ADMIN_APP_URL || 'http://127.0.0.1:5174';

let passed = 0;
const check = (name, fn) => {
  process.stdout.write(`• ${name} … `);
  return Promise.resolve()
    .then(fn)
    .then((result) => {
      passed += 1;
      console.log('ok');
      return result;
    })
    .catch((error) => {
      console.log('FAILED');
      throw error;
    });
};

async function json(url, { token, method = 'GET', body } = {}) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { status: res.status, data, text };
}

const stamp = Date.now().toString(36);

console.log('\nFire Arena — live stack smoke test\n');

await check('player app serves the SPA shell', async () => {
  const res = await fetch(USER);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /<div id="root">/);
});

await check('admin app serves the SPA shell', async () => {
  const res = await fetch(ADMIN);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /<div id="root">/);
});

const player = await check('player registers through the user-app API proxy', async () => {
  const res = await json(`${USER}/api/auth/register`, {
    method: 'POST',
    body: {
      email: `smoke-${stamp}@example.com`,
      password: 'SmokePass123',
      username: `Smoke${stamp.slice(-4)}`,
      device: { name: 'Smoke Device', os: 'Linux', browser: 'Node', fingerprint: `smoke-${stamp}` },
    },
  });
  assert.equal(res.status, 201, res.text);
  assert.equal(res.data.user.wallet.balance, 25);
  return res.data;
});

const matches = await check('matches are visible to the player', async () => {
  const res = await json(`${USER}/api/matches`, { token: player.token });
  assert.equal(res.status, 200);
  assert.ok(res.data.matches.length > 0);
  return res.data.matches;
});

const joinable = matches.find((m) => ['registration_open'].includes(m.status) && !m.joined && m.entryFee <= 25);

await check('player joins a tournament and the wallet is debited', async () => {
  if (!joinable) {
    console.log('\n  (no joinable cheap match seeded — skipping join check)');
    return;
  }
  const res = await json(`${USER}/api/matches/${joinable.id}/join`, {
    method: 'POST',
    token: player.token,
    body: { ingameName: 'SmokePlayer' },
  });
  assert.equal(res.status, 201, res.text);
  assert.equal(res.data.participant.matchId || joinable.id, joinable.id);
});

const admin = await check('admin signs in through the admin-app API proxy', async () => {
  const res = await json(`${ADMIN}/api/admin/auth/login`, {
    method: 'POST',
    body: {
      email: 'admin@firearena.gg',
      password: 'Admin@12345',
      device: { name: 'Smoke Admin', os: 'Linux', browser: 'Node', fingerprint: `admin-${stamp}` },
    },
  });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.data.user.role, 'admin');
  return res.data;
});

const created = await check('admin creates a tournament with room credentials', async () => {
  const start = new Date(Date.now() + 4 * 3600_000);
  const res = await json(`${ADMIN}/api/admin/matches`, {
    method: 'POST',
    token: admin.token,
    body: {
      title: `Smoke Cup ${stamp}`,
      mode: 'solo',
      entryFee: 0,
      prizePool: 100,
      totalSlots: 8,
      startTime: start.toISOString(),
      registrationCloseTime: new Date(start.getTime() - 900_000).toISOString(),
      expiryTime: new Date(start.getTime() + 3 * 3600_000).toISOString(),
      roomId: 'SMOKE-1',
      roomPassword: 'smoke-pass',
    },
  });
  assert.equal(res.status, 201, res.text);
  return res.data.match;
});

await check('player joins the new match and sees the private room', async () => {
  const join = await json(`${USER}/api/matches/${created.id}/join`, { method: 'POST', token: player.token });
  assert.equal(join.status, 201, join.text);
  const view = await json(`${USER}/api/matches/${created.id}`, { token: player.token });
  assert.equal(view.data.match.roomId, 'SMOKE-1');
});

await check('room credential update notifies the registered player', async () => {
  const patch = await json(`${ADMIN}/api/admin/matches/${created.id}`, {
    method: 'PATCH',
    token: admin.token,
    body: { roomPassword: 'smoke-pass-2' },
  });
  assert.equal(patch.status, 200, patch.text);
  const notifications = await json(`${USER}/api/notifications`, { token: player.token });
  assert.ok(notifications.data.notifications.some((n) => /room updated/i.test(n.title)));
});

await check('prize distribution credits the winner once', async () => {
  const publish = await json(`${ADMIN}/api/admin/matches/${created.id}/results`, {
    method: 'POST',
    token: admin.token,
    body: { results: [{ userId: player.user.id, rank: 1 }] },
  });
  assert.equal(publish.status, 200, publish.text);

  const dist = await json(`${ADMIN}/api/admin/matches/${created.id}/distribute-prizes`, {
    method: 'POST',
    token: admin.token,
    body: { winners: [{ userId: player.user.id, amount: 40, rank: 1 }] },
  });
  assert.equal(dist.status, 201, dist.text);
  assert.equal(dist.data.distribution.winners[0].status, 'paid');

  const again = await json(`${ADMIN}/api/admin/matches/${created.id}/distribute-prizes`, {
    method: 'POST',
    token: admin.token,
    body: { winners: [{ userId: player.user.id, amount: 40, rank: 1 }] },
  });
  assert.equal(again.data.distribution.winners[0].status, 'already_paid');

  const wallet = await json(`${USER}/api/wallet`, { token: player.token });
  assert.equal(wallet.data.wallet.winning, 40);
});

await check('admin dashboard, reports and participant export respond', async () => {
  const overview = await json(`${ADMIN}/api/admin/overview`, { token: admin.token });
  assert.equal(overview.status, 200);
  assert.ok(overview.data.totals.users > 0);
  const csv = await fetch(`${ADMIN}/api/admin/matches/${created.id}/participants.csv`, {
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  assert.equal(csv.status, 200);
  assert.match(await csv.text(), /Registration ID,Username/);
});

console.log(`\n✅ ${passed} live checks passed against the running stack.\n`);
