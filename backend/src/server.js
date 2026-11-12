import { createApp } from './app.js';
import { createStoreFromEnv } from './store.js';
import { runMaintenance } from './services.js';
import { seed } from './seed.js';

const PORT = Number(process.env.PORT) || 4000;
const store = createStoreFromEnv();

if (process.env.AUTO_SEED !== 'false' && store.state.users.length === 0) {
  await seed(store);
  console.log('[seed] demo data created (set AUTO_SEED=false to skip)');
}

const app = createApp(store);

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[api] listening on http://0.0.0.0:${PORT}`);
});

// Immediate pass so expired matches created before a restart are settled.
store
  .tx((data) => runMaintenance(data, { reason: 'startup' }))
  .then((run) => console.log(`[jobs] startup pass: ${run.expired.length} expired, ${run.refunds} refunds`))
  .catch((error) => console.error('[jobs] startup pass failed', error));

// Reliable server-side scheduler (not a browser timer). Idempotent by design.
const INTERVAL = Number(process.env.EXPIRY_INTERVAL_MS) || 30_000;
const timer = setInterval(() => {
  store
    .tx((data) => runMaintenance(data, { reason: 'scheduled' }))
    .then((run) => {
      if (run.expired.length || run.statusChanges.length || run.errors.length) {
        console.log(
          `[jobs] expired=${run.expired.length} refunds=${run.refunds} statusChanges=${run.statusChanges.length} errors=${run.errors.length}`,
        );
      }
    })
    .catch((error) => console.error('[jobs] scheduled pass failed', error));
}, INTERVAL);
timer.unref?.();

async function shutdown(signal) {
  console.log(`[api] ${signal} received, shutting down…`);
  clearInterval(timer);
  server.close(async () => {
    await store.flush();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 8000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export { app, store, server };
