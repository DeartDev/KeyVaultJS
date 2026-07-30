import app from './app.js';
import { config } from './config/index.js';
import { closePool } from './db/pool.js';
import logger from './utils/logger.js';

const server = app.listen(config.PORT, () => {
  logger.info(
    { port: config.PORT, env: config.NODE_ENV },
    `KeyVaultJS API listening on :${config.PORT}`,
  );
});

const shutdown = (signal) => {
  logger.info({ signal }, 'shutting down');
  server.close(async () => {
    try {
      await closePool();
    } catch (err) {
      logger.error({ err }, 'error closing pg pool');
    }
    process.exit(0);
  });
  // Force exit after 10s if hanging.
  setTimeout(() => process.exit(1), 10000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'unhandledRejection');
});
process.on('uncaughtException', (err) => {
  logger.error({ err }, 'uncaughtException');
  process.exit(1);
});
