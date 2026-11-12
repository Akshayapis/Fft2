# Deployment

Three deployables: `user-app` (static), `admin-app` (static) and `backend` (Node service).

## 1. Backend API

Any Node host with a persistent disk works: Render, Railway, Fly.io, a VPS, Docker.

| Setting | Value |
|---|---|
| Build command | `npm ci` |
| Start command | `npm start` |
| Health check | `/api/health` |
| Required env | `NODE_ENV=production`, `JWT_SECRET`, `DATA_FILE=/data/arena.json`, `AUTO_SEED=false` |
| Optional env | `FIREBASE_SERVICE_ACCOUNT`, `FIREBASE_WEB_CONFIG`, `EXPIRY_INTERVAL_MS`, `PORT` |

> The JSON data store needs a **persistent disk**. On ephemeral filesystems data is lost on redeploy — attach a disk or move to the Firestore implementation in `firebase/`.

Enable CORS only for your app origins if you do not proxy `/api` on the same origin.

### Real push notifications

1. Firebase console → Project settings → Service accounts → generate a new private key.
2. Store the JSON as the `FIREBASE_SERVICE_ACCOUNT` secret (one line) or a mounted file via `GOOGLE_APPLICATION_CREDENTIALS`.
3. Add the public web config + Web Push certificate (`vapidKey`) as `FIREBASE_WEB_CONFIG`.
4. Put the same public config in `user-app/public/firebase-config.js` (used by the service worker).
5. Restart the API. `GET /api/config` now returns `push.configured: true` and the player app can register FCM tokens.

Without these, everything still works except real background push, and the UI states that clearly.

## 2. Player app (Vercel example)

```bash
cd user-app
npm ci
VITE_API_URL=https://api.yourdomain.com npm run build
npx vercel deploy --prod
```

- Project root: `user-app`
- Build: `npm run build`, Output: `dist`
- Add a rewrite `/api/*` → your backend if you prefer same-origin requests.

## 3. Admin console (Vercel example)

Same as above with project root `admin-app` and a separate Vercel project (and ideally a separate domain / access list). The admin app contains no secrets: the API enforces admin authorisation.

## 4. Firebase Hosting both apps

`firebase/firebase.json` defines two hosting targets:

```bash
cd firebase
firebase target:apply hosting user-app <user-hosting-site>
firebase target:apply hosting admin-app <admin-hosting-site>
cd ..
npm --prefix user-app run build
npm --prefix admin-app run build
firebase deploy --only hosting,firestore:rules,firestore:indexes,storage,functions
```

## 5. GitHub Actions secrets

| Secret | Used by |
|---|---|
| `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_SCOPE` | app deployments |
| `VERCEL_PROJECT_ID_USER`, `VERCEL_PROJECT_ID_ADMIN` | app deployments |
| `USER_APP_API_URL`, `ADMIN_APP_API_URL` | build-time API origin |
| `BACKEND_DEPLOY_HOOK`, `BACKEND_HEALTH_URL` | backend deploy + checks |
| `USER_APP_URL`, `ADMIN_APP_URL` | scheduled health checks |
| `FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT` | rules/functions/hosting deploy |

Workflows check for the presence of secrets and skip with a warning instead of failing or faking a deployment.

## 6. Production checklist

- [ ] `JWT_SECRET` is long, random and stored as a secret
- [ ] `AUTO_SEED=false`; demo accounts removed
- [ ] Admin password changed; admin account e-mail verified
- [ ] Persistent disk attached for `DATA_FILE` (or Firestore deployed)
- [ ] HTTPS everywhere; CORS restricted to your domains
- [ ] FCM credentials configured (or push intentionally disabled)
- [ ] UPI ID / support contacts updated in admin → Configuration
- [ ] Database backups scheduled (`backend/data/arena.json`)
- [ ] `npm test` and `npm run smoke` green in CI
- [ ] Health check workflow enabled

## 7. Firebase production alternative

If you prefer a serverless Google stack:

1. `firebase use --add` your project.
2. `cd firebase/functions && npm ci`
3. Grant the admin custom claim to your admin user:
   `admin.auth().setCustomUserClaims(uid, { admin: true })`
4. `firebase deploy`

The Cloud Functions mirror the REST API guarantees (transactions, deterministic refund/prize ids, FCM, scheduled expiry).
