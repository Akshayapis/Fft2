# Security model

## Authentication

- Passwords hashed with bcrypt (cost 10).
- Sessions are signed JWTs (HS256, 30 days) whose `jti` **must** match a live session record. Logout, device revocation or a password change invalidates the token on the next request.
- Admin routes use the same session mechanism plus a server-side `role === admin` check. There is no client-side-only gate.
- Login/registration endpoints are rate limited per IP (and per email for login).

## Authorisation

| Resource | Rule |
|---|---|
| Devices | A user may only read/revoke their own devices (ownership checked server-side). |
| Room credentials | Returned only when the requester is a registered participant (or admin) **and** the match is not completed/cancelled/expired. |
| Wallet & ledger | Readable only by the owner or an admin. No endpoint accepts a balance or status from a client. |
| Admin operations | Every `/api/admin/*` route requires a live admin session; users receive `403`. |
| Support tickets | Scoped to the owning user; replies require ownership. |

## Financial integrity

- All mutations run inside serialized transactions with rollback on error.
- Money changes always create a ledger record; ledger records are never updated or deleted.
- Entry fee is debited atomically with registration; duplicate joins are rejected.
- Refunds are idempotent per `(matchId, userId)`; re-running the job cannot double-refund.
- Prize payouts are idempotent per `(matchId, userId)`; re-running a distribution marks the winner `already_paid`.
- Total prizes can never exceed `match.prizePool` (remaining budget is recomputed from the ledger).
- Deposit approvals and withdrawal decisions re-check `status === pending` **inside** the transaction.
- Clients cannot mark a deposit approved, publish results, distribute prizes or change their own role — those endpoints simply do not exist for users.

## Device & session security

- Device identity = sha256(userId + browser fingerprint); a login from an unrecognised device registers it.
- If the account already had devices, a `new_device_login` security event is written, an in-app notification is created and a push is attempted to the owner's other devices.
- An IP change alone never blocks an account (as required) — it is recorded, not treated as proof of compromise.
- `POST /auth/password` revokes all other sessions and notifies the owner.
- `POST /devices/logout-others` revokes every other session and clears their push tokens.
- Admin block revokes all sessions immediately.

## Push & tokens

- FCM tokens are stored per device, cleared on logout/revocation, and invalid tokens reported by FCM are removed automatically.
- Session tokens and service-account secrets are never returned to clients. The only Firebase data in the browser is the public web config.
- If FCM credentials are absent, the API reports `push.configured: false`; it never claims delivery.

## Data protection

- Passwords and password hashes are never included in API responses (`publicUser` whitelists fields).
- Room credentials are excluded from list responses unless authorised.
- CSV exports are admin-only.
- JWT secret must be ≥16 chars and is required to boot in production (`NODE_ENV=production`).

## Firestore rules (Firebase deployment)

- Deny-by-default; client writes to wallet, transactions, matches, results, approvals and roles are impossible.
- Room credentials live in `matchPrivate/{matchId}` readable only if a participant document exists.
- Admin access derives from the custom claim `admin == true`, set only by a trusted process.
- Users may only update their own profile fields (wallet/role/banned/stats/email immutable) and mark their own notifications read.

## Known limitations / next steps

- The bundled JSON store is single-node; for horizontal scaling use the Firestore functions or move the store to Postgres with row-level locking.
- Email verification, 2FA and password reset mail require an SMTP or Firebase Auth integration (not included by default).
- Deposit verification is manual by design (no payment gateway credentials were provided).
- Add a WAF / reverse-proxy rate limit in production in addition to the built-in limiter.

## Reporting

Security issues: `support@firearena.gg` (replace with your real address in admin → Configuration).
