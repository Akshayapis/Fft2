# Testing

## Verified results (this repository)

| Suite | Command | Result |
|---|---|---|
| Backend integration & security | `npm test` | **18 / 18 passed** |
| Player app production build | `npm --prefix user-app run build` | ✅ |
| Admin app production build | `npm --prefix admin-app run build` | ✅ |
| Live stack end-to-end | `node scripts/smoke-test.mjs` | **11 / 11 passed** |

The live smoke test requires the three services running (`npm run dev`). It drives real HTTP through each frontend's Vite proxy.

## Backend test matrix (`backend/test/api.test.js`)

| # | Test | What it proves |
|---|---|---|
| 1 | Boots & seeds | API healthy, seed data present |
| 2 | Registration | Profile created, ₹25 bonus, exactly one welcome notification, same-device login is not "new" |
| 3 | New device login | Second device flagged, security alert created, device list current flag, revoke works and old JWT is rejected with `SESSION_REVOKED` |
| 4 | Admin auth | Player rejected from admin login (403), player blocked from admin API, admin logs in, overview loads |
| 5 | Match creation & joining | Validation, wallet debit, duplicate join rejected, participant sees room, outsider does not |
| 6 | Room update | Participant notification + update history + new credentials visible |
| 7 | Wallet tampering | Client-supplied `wallet` fields ignored, no transaction-write route |
| 8 | Deposit approval | Wallet credited once, second approval rejected, minimum enforced |
| 9 | Withdrawal | Funds held immediately, rejection returns the exact amount |
| 10 | Auto expiration | Match expires, refund credited once, second job run refunds 0, single refund transaction, credentials hidden |
| 11 | Prize distribution | Over-budget rejected, non-participant rejected, partial failure recorded, no duplicate credit on re-run, failed payout retry, re-retry rejected |
| 12 | Cancellation | All players refunded, status cancelled, credentials hidden, soft delete preserves financial records, refund ledger present |
| 13 | Notifications | Audience all/single/match counts, delivery status recorded, invalid audience rejected |
| 14 | Support | Ticket creation, admin reply, player sees `answered` |
| 15 | CSV & reports | Participants CSV content, financial summary non-zero |
| 16 | Config | Validation (min > max rejected), public config reflects change, push reported honestly as not configured |
| 17 | Leaderboard & history | Ordering, my matches, results and wins consistency |
| 18 | Cleanup | Server closed, store flushed |

## Manual UI checklist

Player app (http://localhost:5173):
1. Register a new player → welcome bonus and notification appear.
2. Log in from a second browser/incognito profile → owner receives "New login detected"; Devices page lists both.
3. Browse tournaments → open a match → join → wallet debited → room credentials appear.
4. Wallet → add money (UTR) → pending; withdraw → funds held; history updates.
5. Notifications → open, mark all read; Settings → enable push (shows honest status).
6. Arcade background and layout on mobile widths (DevTools device mode).

Admin console (http://localhost:5174):
1. Login with the admin account.
2. Create a match → appears in the player app.
3. Open Match control → Participants & prizes → select winners, set amounts, watch remaining budget → Distribute.
4. Distribution history shows per-winner status and transaction ids; force a failure by blocking a player before distributing, then retry after unblocking.
5. Deposits → approve/reject; Withdrawals → mark paid/reject.
6. Notification centre → send to all / a match; player receives in-app notification.
7. Users → view detail, adjust wallet, block; Devices → revoke a session.
8. Reports → date range, CSV download; Configuration → change limits; Run expiration job.

## Adding tests

Backend tests use `node:test` + `fetch` against an ephemeral server with a temp data file, so they never touch your real data. Add new cases to `backend/test/api.test.js`; keep each test independent and assert both the happy path and the failure mode (especially for money).

For frontend unit tests, Vitest can be added (`npm i -D vitest @testing-library/react`) — the components have no hidden globals, only `api.js` needs mocking.
