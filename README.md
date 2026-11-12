# 🔥 Fire Arena — Free Fire Tournament Platform

A complete, working tournament platform with **two separate applications** and **one shared secure backend**:

| Application | Folder | Purpose |
|---|---|---|
| 🎮 Player app | `user-app/` | Registration, matches, wallet, deposits, withdrawals, leaderboard, profile, devices, notifications, support |
| 🛠 Admin console | `admin-app/` | Users, matches, prize distribution, refunds, deposits, withdrawals, notifications, devices, support, reports, configuration |
| ⚙️ Backend API | `backend/` | Auth sessions, wallets, ledger, matches, expiry/refund job, prize distribution, notifications, admin operations |
| 🔥 Firebase configuration | `firebase/` | Firestore rules, indexes, Storage rules, Cloud Functions, FCM setup |

Both frontends are independently deployable and share the same REST API. The admin console is **not** a copy of the player app — different layout, navigation, feature set and security boundary.

---

## Quick start (2 minutes)

```bash
# 1 — install everything
npm run install:all

# 2 — run all three services
npm run dev
```

| Service | URL |
|---|---|
| Player app | http://localhost:5173 |
| Admin console | http://localhost:5174 |
| API | http://localhost:4000/api/health |

Demo accounts (auto-seeded on first boot):

| Role | Email | Password |
|---|---|---|
| Player | `player@firearena.gg` | `Player@12345` |
| Admin | `admin@firearena.gg` | `Admin@12345` |

> Change these credentials and `JWT_SECRET` before production. Set `AUTO_SEED=false` to start empty.

---

## Verified in this repository

Everything below was executed in this workspace, not just written:

```
backend:  npm test                  → 18/18 integration & security tests passed
user-app: npm run build             → Vite production build OK
admin-app npm run build             → Vite production build OK
live:     node scripts/smoke-test.mjs → 11/11 end-to-end checks against the running stack
```

The smoke test drives real HTTP through each app's dev proxy: registration → match listing → join → room credentials → room update notification → result publishing → prize distribution → duplicate-payout protection → admin dashboard → CSV export.

```bash
npm test        # backend integration suite
npm run smoke   # requires the stack to be running (npm run dev)
npm run build   # production builds for both apps
npm run package # builds artifacts/fire-arena-tournament-platform.zip
```

---

## Feature map

### Player app
- Registration/login with JWT sessions, hashed passwords, device fingerprint registration and welcome bonus + welcome notification (exactly once).
- Home dashboard, live matches, upcoming matches, my matches, results, wins, leaderboard, wallet, deposit, withdrawal, profile, notifications, device management, security activity, support, settings.
- Private room credentials: visible **only** to registered players while the match is active/upcoming; hidden on expiry/cancel/completion.
- Wallet: wallet balance + winning balance, immutable transaction ledger, deposit requests, withdrawal holds, winnings transfer.
- Multi-device security: device list (name, model, OS, browser, IP, first login, last active, current device), revoke device, log out other devices, new-device login alert, security event history, password change with automatic session revocation.
- Push: Firebase Cloud Messaging registration, service worker, token refresh/cleanup, foreground + background handling, click navigation, in-app notification centre that always works even when push is denied.
- Premium gaming UI generated in code (canvas ember background, gradient motion, glass panels), mobile-first layout with bottom navigation.

### Admin console
- Server-verified admin login; every admin endpoint re-checks the role on the backend.
- Dashboard: users, active players, tournaments, live matches, revenue, pending approvals, 7-day chart, recent activity.
- Matches: create, edit, duplicate, pause/resume registration, close registration, adjust slots, cancel, soft-delete, publish results, export participants CSV, full activity/update history.
- **Prize distribution studio**: select multiple winners, per-player editable amounts and ranks, live budget/remaining calculation, over-budget prevention, confirmation modal, per-winner payout status, distribution history with individual transaction IDs and safe retries for failed payouts.
- Automatic expiration & refunds: scheduled server job (plus "Run now" with error report), idempotent refunds, soft deletion, preserved financial records.
- Deposits & withdrawals with approve/reject, ledger entries, player notifications.
- Notification centre with audiences: all, single user, multiple users, match participants, pending deposits, pending withdrawals, top players. Delivery status tracked per message.
- Users: search, wallet history, matches, devices, deposits/withdrawals, security events, block/unblock with session revocation, manual wallet adjustment.
- Devices & sessions: revoke device or session, security log.
- Support desk: reply/close tickets and notify the player.
- Financial reports with date range, net revenue/cash-flow, transaction export.
- App configuration: wallet limits, bonus, UPI, support contacts, maintenance, registration switch, job runner.

### Backend guarantees
- All money mutations inside serialized, rollback-safe transactions.
- Append-only ledger (`transactions`); refunds and payouts are deduplicated per match + player.
- Prize payouts can never exceed the match prize budget; already-paid players are never paid twice.
- Admin routes require a live admin session (JWT + server-side session record), never a client flag.
- Clients cannot write wallets, results, prizes or approvals — no such endpoints exist.
- Expiry job is idempotent and records every run with counts and errors.

---

## Architecture

```
user-app (React + Vite, :5173)  ─┐
                                 ├──►  backend REST API (:4000)  ──►  data store
admin-app (React + Vite, :5174) ─┘         │
                                           ├── Firebase Cloud Messaging (optional, configured via env)
                                           └── scheduled expiration job (30s interval)

firebase/  →  Firestore rules + indexes + Storage rules + Cloud Functions (production alternative)
```

The runtime backend keeps its data in a JSON store with atomic writes (great for demos, single-node deploys and this repository's tests). For a fully managed Google stack, deploy `firebase/functions` instead — the same rules apply: transactional wallets, append-only ledger, deterministic refund/prize ids, admin custom claims.

---

## Configuration

Copy `.env.example` files and set values. Highlights:

| Variable | Where | Meaning |
|---|---|---|
| `JWT_SECRET` | backend | Session signing key (required in production) |
| `DATA_FILE` | backend | JSON store path (use a persistent disk) |
| `AUTO_SEED` | backend | Seed demo data on first boot |
| `EXPIRY_INTERVAL_MS` | backend | Expiration job interval |
| `FIREBASE_SERVICE_ACCOUNT` | backend | Service-account JSON enabling **real FCM push** |
| `FIREBASE_WEB_CONFIG` | backend | Public Firebase web config + `vapidKey` exposed to the player app |
| `VITE_API_URL` | both apps | API origin (empty = same origin / dev proxy) |

**Push is honest:** without FCM credentials the API reports `push.configured = false` and the UI says so. In-app notifications, device registration and security alerts still work; no "notification sent" claim is made when nothing was delivered.

---

## Deployment

- **Player & admin apps** → Vercel/Netlify/Firebase Hosting. Build with `npm run build` in each folder. Set `VITE_API_URL` to your API URL.
- **Backend** → Render/Railway/Fly/Docker host with a persistent disk. `npm start` in `backend/`.
- **Firebase** → `firebase deploy` from `firebase/` (rules, indexes, functions, hosting targets `user-app` and `admin-app`).

Ready-made workflows live in `.github/workflows/`:

| Workflow | What it does |
|---|---|
| `build.yml` | Installs, tests the API, builds both apps, boots the live stack and runs the smoke test, packages the ZIP |
| `deploy-user.yml` | Deploys the player app to Vercel when `VERCEL_TOKEN`/`VERCEL_PROJECT_ID_USER` are set |
| `deploy-admin.yml` | Deploys the admin console to Vercel |
| `deploy-backend.yml` | Tests, then triggers a hosting deploy hook and health-checks the API |
| `firebase-deploy.yml` | Deploys Firestore/Storage rules, indexes, Cloud Functions and Hosting |
| `health-check.yml` | Scheduled API + app availability checks |

Workflows skip cleanly with a warning when their secrets are absent — nothing pretends to deploy.

---

## Security notes

- Scores of checks in `backend/test/api.test.js` cover wallet tampering, role escalation, duplicate joining, duplicate approval, refund idempotency, payout idempotency, budget limits, session revocation and credential hiding.
- Sessions are individual records; revoking a device invalidates its JWTs immediately.
- Room credentials are stripped server-side for everyone except participants/admins and only while the match is live.
- Never expose service-account keys to the browser. The Firebase web config in the client contains only public values.

See `documentation/SECURITY.md` for the full threat model.

---

## Documentation

| File | Content |
|---|---|
| `documentation/INSTALLATION.md` | Step-by-step local setup and troubleshooting |
| `documentation/DEPLOYMENT.md` | Vercel, Render/Railway, Firebase, GitHub secrets, production checklist |
| `documentation/DATABASE.md` | Data model, ledger design, idempotency keys |
| `documentation/API.md` | Every endpoint with auth and payloads |
| `documentation/SECURITY.md` | Threat model and hard guarantees |
| `documentation/TESTING.md` | Test matrix and how to reproduce the verified results |
| `documentation/FEATURES.md` | Requirement → implementation traceability |

---

## License

Private project template. Free Fire is a trademark of Garena; this platform is not affiliated with Garena.
