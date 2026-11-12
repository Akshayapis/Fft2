# Requirement traceability

| Requirement | Where it is implemented |
|---|---|
| **Two separate applications** | `user-app/` (player UI, bottom nav, mobile-first) and `admin-app/` (desktop console, different design, routes, auth and features). Both talk to one API. |
| **Registration / login** | `backend/src/routes/authRoutes.js`, `user-app/src/pages/Login.jsx`, `Register.jsx` |
| **Automatic welcome notification (no duplicates)** | Registration flow → `notifyUser` with `dedupeKey: welcome:<uid>`; preview card also returned to the client. Firebase: `onUserCreated` uses notification id `welcome_<uid>`. |
| **Wallet initialisation + bonus** | `addTransaction`/ledger on register; both UI wallets read the same balances |
| **Advanced multi-device security** | `backend/src/auth.js` (`startSession`), `routes/userRoutes.js` device endpoints, `user-app/src/pages/Devices.jsx` |
| Device name/model/OS/browser/IP/first login/last active/current indicator | `deviceView()` + `getDeviceInfo()` (UA parsing, persistent fingerprint) |
| New device alert to previously registered devices | `startSession` → `securityEvent` + `notifyUser` (push attempted, in-app always) |
| Remove device / revoke session / logout others / block sessions | `POST /devices/:id/revoke`, `DELETE /devices/:id`, `POST /devices/logout-others`, admin session revoke |
| Change password + review security activity | `POST /auth/password`, `GET /security/activity`, Devices page timeline |
| Cannot remove another user's devices / tokens never exposed | Ownership checks per device; device responses whitelist fields; sessions store only `jti` |
| **Real push notifications (FCM)** | `backend/src/push.js` (firebase-admin `sendEachForMulticast`), `user-app/src/lib/push.js`, `user-app/public/firebase-messaging-sw.js`, `firebase/functions` push |
| Permission handling, token registration, refresh/cleanup | Settings → enable push → `getToken` → `POST /devices/token`; invalid tokens cleared automatically |
| Background + foreground handling, click navigation | Service worker + `onMessage` bridge to toasts; `notificationclick` opens `clickAction` |
| Notification history + in-app record even when push denied | `notifications` records always created; `delivery.status` reflects reality (`sent`, `not_configured`, `in_app_only`) |
| **Admin notification centre with audiences** | `POST /admin/notifications` (`all`, `user`, `users`, `match`, `pending_deposits`, `pending_withdrawals`, `top_players`) + `admin-app/src/pages/Notifications.jsx` |
| Title/body/image/type/match/click target/created/delivery status | Notification schema + admin history table |
| **Automatic match expiration** | `runMaintenance` in `backend/src/services.js`, scheduled every 30 s in `server.js`, manual retry endpoint + UI |
| Stop registrations, hide credentials, refund once, notify, update status | Expiry path sets `registrationClosed`, hides credentials server-side, `refundParticipant` (idempotent), notifications, `status=expired` |
| Reliable backend scheduler (no browser timer) | `setInterval` job in the API process + Firebase `scheduledMatchMaintenance` |
| Admin retry + error report | `POST /admin/jobs/expire-matches`, `GET /admin/jobs/runs`, Configuration page runner |
| Soft deletion preserving history | `DELETE /admin/matches/:id` → `deletedAt`, records retained; hard delete only without financial history |
| **Room password/ID update notifications** | `PATCH /admin/matches/:id` detects room/schedule changes → notifies every participant; update history stored |
| Participants-only credentials | `presentMatch` strips `roomId`/`roomPassword`; tests assert outsider sees `null` |
| **Premium prize distribution** | `admin-app/src/pages/MatchDetail.jsx` (selection, per-player amounts, ranks, remaining budget, confirmation) → `distributePrizes` |
| Participant list with name/UID/avatar/team/entry/registration/rank/prize/status | Participants tab + `GET /admin/matches/:id/participants` |
| Validate admin, participants, amounts, budget, duplicates; atomic wallet updates; separate transactions; notify winners | `distributePrizes` in `services.js` + Firebase `distributePrizes` |
| Distribution history with paid/failed/pending, transaction ids, date, admin | `distributions` records + history tab; retries for failed payouts only |
| **Match management extras** | Duplicate, pause/resume, close registration, slot adjustment, update, participant view/export, cancel, refunds, results, activity history |
| **Profile improvements** | Avatar upload (local resize), username/UID/phone/bio, security, devices, login activity, notification prefs, privacy, password, support/wallet/match/win history, logout-all |
| **Firebase backend & security** | `firebase/` rules, indexes, storage rules, Cloud Functions (auth, devices, join, deposits, withdrawals, prizes, expiry, notifications, config) |
| Server-side role verification, transactions, no client financial writes | Session/role middleware + rules deny client writes |
| **GitHub Actions** | `.github/workflows/build.yml`, `deploy-user.yml`, `deploy-admin.yml`, `deploy-backend.yml`, `firebase-deploy.yml`, `health-check.yml` |
| **ZIP delivery** | `npm run package` → `artifacts/fire-arena-tournament-platform.zip` with `project/{user-app,admin-app,backend,firebase,.github,documentation,README.md,.env.example}` |
| **Actual start & build verification** | Backend suite 18/18, both production builds, live stack smoke 11/11 (documented in `TESTING.md`) |
| Premium gaming UI with code-generated animated background | `user-app/src/components/Background.jsx` (canvas embers + gradient), glass UI, hero animations |
| Missing credentials reported honestly | `GET /api/config` → `push.configured=false` + reason; admin panel and player Settings show it |

## Deliberate design decisions

- **Manual deposit verification**: no payment-gateway credentials were supplied, so deposits are UPI + UTR review. Do not claim automatic gateway settlement.
- **JSON store by default**: zero external services means the project runs immediately; Firebase functions provide the managed alternative.
- **Winnings are separate from wallet balance**: entry fees use wallet balance (optionally winnings), withdrawals can draw from both, prizes always land in winnings.
