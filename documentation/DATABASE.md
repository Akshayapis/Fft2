# Data model

The runtime backend stores one JSON document (`backend/data/arena.json`). The Firebase option uses the same shapes as Firestore collections, with sub-collections noted.

Money is stored as **integer rupees** with two-decimal rounding (`₹`). All ledger entries are append-only.

## Collections / tables

### users
```json
{
  "id": "usr_...", "email": "...", "passwordHash": "bcrypt",
  "username": "AkshayX", "role": "user|admin", "gameUid": "1234567890",
  "phone": "", "avatar": "url|dataURL", "bio": "", "banned": false,
  "createdAt": "ISO", "lastLoginAt": "ISO", "loginCount": 4,
  "wallet": { "balance": 520, "winning": 38, "totalDeposited": 500,
              "totalWithdrawn": 0, "totalWon": 100 },
  "stats": { "matchesPlayed": 6, "wins": 1, "kills": 0, "prizeWon": 38 },
  "prefs": { "pushEnabled": true, "emailNotifications": true, "privateProfile": false }
}
```
Never writable by clients. Wallet fields change only through ledger operations.

### sessions
```json
{ "id": "sess_...", "userId": "...", "deviceId": "dev_...", "jti": "...",
  "ip": "1.2.3.4", "createdAt": "ISO", "lastActiveAt": "ISO",
  "expiresAt": "ISO", "revoked": false, "revokedReason": null }
```
Each request validates that its JWT `jti` maps to a session that is unrevoked and unexpired.

### devices
```json
{ "id": "dev_...", "userId": "...", "key": "sha256(userId|fingerprint)",
  "name": "Android Phone", "model": "Pixel 8", "os": "Android",
  "browser": "Chrome", "platform": "mobile", "ip": "1.2.3.4",
  "pushToken": "fcm-token|null", "firstLoginAt": "ISO",
  "lastActiveAt": "ISO", "revoked": false }
```
A login on a device key that does not yet exist and where the account already has devices triggers a `new_device_login` security event + notification.

### matches
```json
{
  "id": "mat_...", "title": "Friday Solo Showdown", "mode": "solo|duo|squad|clash",
  "map": "Bermuda", "entryFee": 20, "prizePool": 800, "perKill": 5,
  "totalSlots": 48, "startTime": "ISO", "registrationCloseTime": "ISO",
  "expiryTime": "ISO", "refundDeadline": "ISO", "status": "registration_open",
  "registrationPaused": false, "registrationClosed": false,
  "roomId": "84512397", "roomPassword": "arena786",
  "resultsPublished": false, "prizesDistributed": false,
  "participants": [{
    "userId": "...", "username": "...", "registrationId": "reg_...",
    "joinedAt": "ISO", "teamName": "", "ingameName": "AkshayX",
    "gameUid": "1234567890", "entryFeePaid": 20, "rank": 1, "prize": 38,
    "payoutStatus": "paid", "payoutTransactionId": "tx_...",
    "refunded": false, "refundTransactionId": null
  }],
  "activity": [{ "at": "ISO", "actorId": "usr|admin|null", "action": "created", "detail": "" }],
  "updateHistory": [{ "at": "ISO", "actorId": "usr_admin", "changes": { "roomId": { "from": "x", "to": "y" } } }],
  "refundSummary": { "at": "ISO", "refunded": 2, "transactionIds": [] },
  "deletedAt": null
}
```

Statuses: `registration_open`, `paused`, `registration_closed`, `live`, `completed`, `cancelled`, `expired`.

### transactions (append-only ledger)
```json
{ "id": "tx_...", "userId": "...", "type": "deposit|entry_fee|refund|prize|withdrawal_hold|withdrawal|withdrawal_reversal|bonus|admin_adjust|transfer_in|transfer_out|deposit_request",
  "direction": "credit|debit", "bucket": "balance|winning|null", "amount": 20,
  "status": "completed|pending|approved|rejected", "description": "",
  "matchId": null, "reference": null, "adminId": null, "createdAt": "ISO" }
```

### deposits / withdrawals
```json
{ "id": "dep_...", "userId": "...", "amount": 100, "method": "upi",
  "reference": "UTR...", "status": "pending|approved|rejected",
  "reviewedAt": null, "reviewedBy": null, "rejectReason": null, "createdAt": "ISO" }
```
```json
{ "id": "wdr_...", "userId": "...", "amount": 150, "upiId": "name@upi",
  "status": "pending|paid|rejected", "breakdown": { "winning": 0, "balance": 150 },
  "utr": "", "createdAt": "ISO" }
```
Withdrawals are held (debited) at request time; rejection returns the exact bucket split.

### notifications
```json
{ "id": "ntf_...", "userId": "...", "title": "", "body": "", "image": null,
  "type": "welcome|security|match|wallet|prize|refund|support|announcement",
  "matchId": null, "clickAction": "/wallet", "dedupeKey": "welcome:usr_...",
  "read": false, "createdAt": "ISO",
  "delivery": { "status": "sent|not_configured|in_app_only|no_devices|failed",
                "provider": "fcm|none", "targetCount": 1, "successCount": 1,
                "failureCount": 0, "errors": [] } }
```

### securityEvents
`{ id, userId, type, message, deviceId, ip, location, createdAt }`

### supportTickets
`{ id, userId, username, subject, category, status: open|answered|closed, replies: [{ by: user|admin, message, at }], createdAt, updatedAt }`

### distributions
```json
{ "id": "dist_...", "matchId": "...", "matchTitle": "...", "adminId": "...",
  "budget": 300, "total": 150, "paidAmount": 150, "paidCount": 2,
  "failedCount": 0, "status": "completed|partial|failed",
  "winners": [{ "userId": "...", "username": "...", "amount": 100, "rank": 1,
                "status": "paid|failed|already_paid", "transactionId": "tx_...",
                "error": null }],
  "createdAt": "ISO" }
```

### jobRuns
`{ id, at, reason, actorId, scanned, expired: [matchId], refunds, refundedAmount, statusChanges: [], errors: [], durationMs, status }`

### config
App name, currency, deposit/withdrawal limits, registration bonus, UPI ID, support contacts, maintenance mode, registration switch.

## Idempotency keys

| Operation | Guard |
|---|---|
| Refund | participant.refunded flag **and** existing transaction with same `matchId + userId + type=refund` |
| Prize payout | existing completed transaction with same `matchId + userId + type=prize` |
| Deposit approval | deposit `status` must still be `pending` (re-checked inside the transaction) |
| Withdrawal approval/rejection | withdrawal `status` must still be `pending` |
| Welcome notification | `dedupeKey = welcome:<userId>` |
| New device alert | `dedupeKey = new-login:<deviceId>:<hour>` |

## Firestore mapping

| JSON collection | Firestore path |
|---|---|
| users | `users/{uid}` |
| devices | `users/{uid}/devices/{deviceId}` |
| matches | `matches/{matchId}` |
| participants | `matches/{matchId}/participants/{uid}` |
| room credentials | `matchPrivate/{matchId}` (participants/admin read only) |
| wallet | `wallets/{uid}` |
| ledger | `transactions/{txId}` (deterministic ids for refunds/prizes) |
| deposits / withdrawals | `deposits/{id}`, `withdrawals/{id}` |
| notifications | `notifications/{id}` |
| distributions | `prizeDistributions/{id}` |
| security events | `securityEvents/{id}` |
| job runs | `jobRuns/{id}` |
| config | `config/app` |
