import { ZodError } from 'zod';
import { HttpError, validationError } from '../utils/httpErrors.js';

const redactKeys = new Set([
  'password',
  'encryptedblob',
  'refreshtoken',
  'accesstoken',
  'authorization',
]);

const scrub = (obj) => {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = redactKeys.has(String(k).toLowerCase()) ? '***' : v;
  }
  return out;
};

export const errorHandler = (logger) => (err, req, res, _next) => {
  if (err instanceof ZodError && !err.status) {
    err = validationError(
      err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }

  const status = err.status || 500;
  const code = err.code || 'internal_error';
  const message = err.message || 'Internal server error';

  if (status >= 500) {
    req.log?.error({ err, body: scrub(req.body) }, 'unhandled error');
  } else {
    req.log?.warn({ code, status, body: scrub(req.body) }, 'client error');
  }

  res.status(status).json({
    error: code,
    message,
    ...(err.details ? { details: err.details } : {}),
  });
};

export const notFound = (req, res) => {
  res.status(404).json({ error: 'not_found', message: 'Resource not found' });
};

void HttpError;
