# HTTP API reference

Base URL: `http://localhost:4000/api`
Auth: `Authorization: Bearer <jwt>` unless marked public.
Errors: `{ "error": { "message": "...", "code": "MACHINE_CODE", "detail": ... } }`

## Public

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | Service status and counts |
| GET | `/config` | Public app config + FCM web config + push status |
| POST | `/auth/register` | `{ email, password, username, gameUid?, phone?, device? }` → token, user, welcomeNotification |
| POST | `/auth/login` | `{ email, password, device? }` → token, user, newDevice |

## Player (session required)

### Profile & security
| Method | Path | Notes |
|---|---|---|
| GET | `/auth/me` | Current user + session + device |
| POST | `/auth/logout` | Revokes current session |
| POST | `/auth/password` | `{ currentPassword, newPassword }` revokes other sessions |
| GET / PUT | `/profile` | Read / update username, gameUid, phone, avatar, bio, prefs |
| GET | `/devices` | Devices with current flag, last active, IP, OS, browser |
| POST | `/devices/token` | `{ token, platform }` register/clear FCM token |
| POST | `/devices/:id/revoke` | Revoke one device (own only) |
| DELETE | `/devices/:id` | Remove device record (own only) |
| POST | `/devices/logout-others` | Revoke all other sessions |
| GET | `/security/activity` | Last 50 security events |

### Notifications
| Method | Path | Notes |
|---|---|---|
| GET | `/notifications?unread=true&limit=100` | In-app notification centre |
| POST | `/notifications/:id/read` | Mark one read |
| POST | `/notifications/read-all` | Mark all read |

### Matches
| Method | Path | Notes |
|---|---|---|
| GET | `/matches?status=upcoming\|live\|completed\|mine` | Credentials stripped unless participant/admin |
| GET | `/matches/:id` | Detail + participants (if joined) |
| POST | `/matches/:id/join` | `{ ingameName, gameUid?, teamName?, useWinnings? }` |
| GET | `/me/matches` | Joined matches |
| GET | `/me/results` | Published results for the player |
| GET | `/me/wins` | Matches with prize > 0 |
| GET | `/leaderboard` | Top 50 by prize money + caller position |

### Wallet
| Method | Path | Notes |
|---|---|---|
| GET | `/wallet` | Balances, recent ledger, limits, pending counts |
| GET | `/wallet/transactions?type=&limit=` | Ledger filter |
| GET | `/wallet/deposits` / `/wallet/withdrawals` | Request history |
| POST | `/wallet/deposit` | `{ amount, reference, method }` → pending request |
| POST | `/wallet/withdraw` | `{ amount, upiId }` → pending request, funds held |
| POST | `/wallet/transfer-winnings` | `{ amount }` winnings → wallet balance |

### Support
| Method | Path | Notes |
|---|---|---|
| GET | `/support` | Own tickets |
| POST | `/support` | `{ subject, message, category }` |
| POST | `/support/:id/reply` | `{ message }` |

## Admin (role `admin`, live session required)

### Auth & overview
| Method | Path | Notes |
|---|---|---|
| POST | `/admin/auth/login` | `{ email, password, device? }` admin only |
| GET | `/admin/overview` | Totals, finance summary, 7-day chart, recent items, push status |

### Users
| Method | Path | Notes |
|---|---|---|
| GET | `/admin/users?q=&role=` | Search + device/match counts |
| GET | `/admin/users/:id` | Full profile: devices, sessions, ledger, deposits, withdrawals, matches, security |
| PATCH | `/admin/users/:id` | `{ banned, note }` block/unblock (revokes sessions) |
| POST | `/admin/users/:id/adjust` | `{ amount, direction, bucket, reason }` ledger adjustment |

### Matches
| Method | Path | Notes |
|---|---|---|
| GET | `/admin/matches?status=&includeDeleted=` | Admin view with credentials |
| POST | `/admin/matches` | Create (validates times, slots, fees) |
| GET | `/admin/matches/:id` | Detail incl. participants, activity, distributions |
| PATCH | `/admin/matches/:id` | Update; room/schedule changes notify participants |
| DELETE | `/admin/matches/:id` | Soft delete when financial history exists |
| POST | `/admin/matches/:id/duplicate` | Copy with new times |
| POST | `/admin/matches/:id/pause` / `resume` / `close-registration` | Registration control |
| PATCH | `/admin/matches/:id/slots` | `{ totalSlots }` never below joined count |
| POST | `/admin/matches/:id/cancel` | `{ reason }` refunds every player once |
| GET | `/admin/matches/:id/participants` | Participants + prize transactions |
| GET | `/admin/matches/:id/participants.csv` | CSV export |
| GET | `/admin/matches/:id/activity` | Activity + update history |
| POST | `/admin/matches/:id/results` | `{ results: [{ userId, rank, kills? }] }` |
| POST | `/admin/matches/:id/distribute-prizes` | `{ winners: [{ userId, amount, rank }] }` |
| POST | `/admin/matches/:id/distributions/:distributionId/retry` | `{ userId }` retry a failed payout |
| GET | `/admin/distributions` | All distributions |

### Finance
| Method | Path | Notes |
|---|---|---|
| GET | `/admin/deposits?status=` | All deposit requests |
| POST | `/admin/deposits/:id/approve` | Credits wallet once |
| POST | `/admin/deposits/:id/reject` | `{ reason }` |
| GET | `/admin/withdrawals?status=` | All withdrawal requests |
| POST | `/admin/withdrawals/:id/approve` | `{ utr? }` marks paid |
| POST | `/admin/withdrawals/:id/reject` | `{ reason }` returns held funds |
| GET | `/admin/reports/financial?from=&to=` | Range summary + transactions |
| GET | `/admin/reports/transactions.csv` | Ledger export |

### Notifications
| Method | Path | Notes |
|---|---|---|
| POST | `/admin/notifications` | `{ title, body, audience, userId?, userIds?, matchId?, type?, image?, clickAction? }` |
| GET | `/admin/notifications?limit=` | History + delivery stats |

Audiences: `all`, `user`, `users`, `match`, `pending_deposits`, `pending_withdrawals`, `top_players`.

### Devices, support, config, jobs
| Method | Path | Notes |
|---|---|---|
| GET | `/admin/devices` / `/admin/sessions` | All devices / sessions |
| POST | `/admin/devices/:id/revoke` | Revoke device + its sessions |
| POST | `/admin/sessions/:id/revoke` | Revoke one session |
| GET | `/admin/security?limit=` | Security event feed |
| GET | `/admin/support?status=` | All tickets |
| POST | `/admin/support/:id/reply` | `{ message }` notifies player |
| POST | `/admin/support/:id/close` | Close ticket |
| GET / PUT | `/admin/config` | Read / update platform config |
| POST | `/admin/jobs/expire-matches` | Run expiration job now (retry) |
| GET | `/admin/jobs/runs` | Job history with errors |

## Response examples

```json
POST /api/matches/mat_x/join  →  201
{
  "participant": { "registrationId": "reg_...", "entryFeePaid": 20, "rank": null },
  "wallet": { "balance": 5, "winning": 0 },
  "match": { "id": "mat_x", "roomId": null, "credentialsNote": "..." }
}
```

```json
POST /api/admin/matches/mat_x/distribute-prizes  →  201
{
  "distribution": {
    "id": "dist_...", "status": "partial", "budget": 300,
    "paidAmount": 100, "paidCount": 1, "failedCount": 1,
    "winners": [
      { "userId": "usr_a", "amount": 100, "status": "paid", "transactionId": "tx_..." },
      { "userId": "usr_b", "amount": 50, "status": "failed", "error": "Account is blocked..." }
    ]
  }
}
```

## Status codes

`400` validation/business rule · `401` missing/invalid/revoked session · `403` role or ownership violation · `404` not found · `409` conflict (duplicate join, already paid, invalid state) · `429` rate limited · `500` unexpected error.
