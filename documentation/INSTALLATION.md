# Installation

## Requirements

- Node.js **20+** (verified on Node 22.22)
- npm 9+
- Ports `4000` (API), `5173` (player app), `5174` (admin console) free

## 1. Install dependencies

```bash
cd project
npm run install:all
```

That installs `backend`, `user-app` and `admin-app`. You can also install individually:

```bash
npm --prefix backend install
npm --prefix user-app install
npm --prefix admin-app install
```

## 2. Configure environment

```bash
cp backend/.env.example backend/.env
cp user-app/.env.example user-app/.env
cp admin-app/.env.example admin-app/.env
```

Development defaults work out of the box. For production you must set `JWT_SECRET` (16+ chars) and `AUTO_SEED=false`.

## 3. Start everything

```bash
npm run dev
```

Expected output:

```
[api]   listening on http://0.0.0.0:4000
[seed]  demo data created
[user]  VITE ready  →  http://localhost:5173
[admin] VITE ready  →  http://localhost:5174
```

## 4. Sign in

| Role | URL | Email | Password |
|---|---|---|---|
| Player | http://localhost:5173 | `player@firearena.gg` | `Player@12345` |
| Admin | http://localhost:5174 | `admin@firearena.gg` | `Admin@12345` |

New players can register from the player app and receive the configured welcome bonus + welcome notification.

## 5. Verify the installation

```bash
npm test          # backend suite (18 tests)
npm run smoke     # live stack (needs services running)
npm run build     # both frontends build
```

## Reset the demo database

```bash
rm -rf backend/data
npm --prefix backend run seed -- --force
```

The seed script creates:

- 1 admin + 8 players,
- 6 matches (live, upcoming ×2, completed with paid prizes, cancelled with refunds, expired/refunded),
- pending + approved deposits, a pending withdrawal,
- support tickets and notifications.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `EADDRINUSE` on 4000/5173/5174 | Stop the other process or set `PORT` (backend) / `PORT=5175 npm run dev` (frontend). |
| API calls return 500 after moving folders | Delete `backend/data/arena.json` and restart to reseed. |
| 401 after restarting with a new `JWT_SECRET` | Expected — old sessions are invalid. Sign in again. |
| Push never arrives | FCM is not configured. Without `FIREBASE_SERVICE_ACCOUNT` + `FIREBASE_WEB_CONFIG` the app reports "in-app only" by design. |
| Admin console redirects to login | The account must have `role: admin` (use the seeded admin or promote via the backend data file/seed). |

## Docker (optional)

```dockerfile
# backend/Dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
ENV NODE_ENV=production PORT=4000 DATA_FILE=/data/arena.json
VOLUME ["/data"]
EXPOSE 4000
CMD ["node", "src/server.js"]
```

```bash
docker build -t fire-arena-api backend
docker run -p 4000:4000 -v fire_arena_data:/data --env-file backend/.env fire-arena-api
```
