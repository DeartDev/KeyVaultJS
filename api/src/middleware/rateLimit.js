/**
 * rateLimit.js
 * Limitación de intentos sobre /api/auth/* (H-04).
 *
 * Dos capas complementarias:
 *  - Por IP: frena el escaneo masivo desde un mismo origen y, sobre todo, evita
 *    que un atacante queme CPU del host encadenando hashes bcrypt (coste 12).
 *  - Por email (solo login): un atacante distribuido puede rotar IPs, pero no
 *    la cuenta objetivo. Solo contabiliza intentos fallidos, así que un usuario
 *    legítimo que acierta la contraseña nunca consume cuota.
 *
 * Requiere `app.set('trust proxy', ...)` (H-12) para que `req.ip` sea la IP
 * real del cliente y no la del contenedor nginx.
 */
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { config } from '../config/index.js';

const handler = (_req, res) => {
  res.status(429).json({
    error: 'rate_limited',
    message: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.',
  });
};

const base = {
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler,
};

// Todo /api/auth/*: register, login, refresh y logout.
export const authIpLimiter = rateLimit({
  ...base,
  limit: config.RATE_LIMIT_AUTH_MAX_IP,
  // ipKeyGenerator normaliza IPv6 a /64 para que rotar dentro del mismo prefijo
  // no sirva para saltarse el límite.
  keyGenerator: (req) => ipKeyGenerator(req.ip),
});

// Solo /api/auth/login, por cuenta objetivo.
export const loginEmailLimiter = rateLimit({
  ...base,
  limit: config.RATE_LIMIT_AUTH_MAX_EMAIL,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const email = typeof req.body?.email === 'string'
      ? req.body.email.trim().toLowerCase()
      : '';
    return email ? `email:${email}` : ipKeyGenerator(req.ip);
  },
});
