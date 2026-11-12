import express from 'express';
import cors from 'cors';
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import { HttpError } from './util.js';

export function createApp(store, { logger = console } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(cors({ origin: true, credentials: false }));
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (req, res) => {
    res.json({
      ok: true,
      service: 'ff-arena-backend',
      uptime: Math.round(process.uptime()),
      users: store.state.users.length,
      matches: store.state.matches.filter((m) => !m.deletedAt).length,
      time: new Date().toISOString(),
    });
  });

  app.use('/api/auth', authRoutes(store));
  app.use('/api', userRoutes(store));
  app.use('/api/admin', adminRoutes(store));

  app.use('/api', (req, res) => {
    res.status(404).json({ error: { message: 'Endpoint not found.', code: 'NOT_FOUND' } });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    if (error instanceof HttpError) {
      return res.status(error.status).json({
        error: { message: error.message, code: error.code, detail: error.detail || null },
      });
    }
    if (error?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { message: 'Invalid JSON body.', code: 'BAD_JSON' } });
    }
    logger.error?.('[api] unhandled error', error);
    return res.status(500).json({ error: { message: 'Internal server error.', code: 'INTERNAL' } });
  });

  return app;
}
