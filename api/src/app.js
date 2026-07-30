import express from 'express';
import pinoHttp from 'pino-http';
import { randomUUID } from 'node:crypto';
import { config } from './config/index.js';
import logger from './utils/logger.js';
import healthRouter from './routes/health.js';
import authRouter from './routes/auth.js';
import vaultRouter from './routes/vault.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';

const app = express();

app.disable('x-powered-by');
app.use(pinoHttp({ logger, genReqId: () => randomUUID() }));

app.use(express.json({ limit: '2mb' }));

// Security headers for API responses.
app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
  });
  next();
});

// Minimal CORS allow-list (only used if direct cross-origin access is needed;
// normally nginx proxies same-origin, so this stays empty in production).
if (config.corsOrigins.length > 0) {
  app.use((_req, res, next) => {
    const origin = _req.headers.origin;
    if (origin && config.corsOrigins.includes(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Vary', 'Origin');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      if (_req.method === 'OPTIONS') return res.status(204).end();
    }
    next();
  });
}

app.get('/', (_req, res) => {
  res.json({ name: 'KeyVaultJS API', status: 'running' });
});

app.use('/api/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/vault', vaultRouter);

app.use(notFound);
app.use(errorHandler(logger));

export default app;
