import pino from 'pino';
import { config } from '../config/index.js';

const transport = config.isDev
  ? {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:standard' },
    }
  : undefined;

const logger = pino(
  {
    level: config.LOG_LEVEL,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.body.password',
        'req.body.refreshToken',
        'req.body.encryptedBlob',
      ],
      censor: '[REDACTED]',
    },
    ...(transport ? { transport } : {}),
  },
);

export default logger;
