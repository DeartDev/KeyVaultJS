import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.string().default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 chars'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),

  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

  VAULT_MAX_BYTES: z.coerce.number().int().positive().default(1048576),

  // Nº de proxies de confianza para resolver la IP real desde X-Forwarded-For.
  // 1 = nginx del contenedor web (que a su vez reescribe lo que recibe de Apache).
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),

  // Rate limiting de /api/auth/*.
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  RATE_LIMIT_AUTH_MAX_IP: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_AUTH_MAX_EMAIL: z.coerce.number().int().positive().default(10),

  // Retención de refresh_tokens expirados/revocados antes de purgarlos.
  REFRESH_TOKEN_PURGE_DAYS: z.coerce.number().int().positive().default(30),

  // Origin allow-list for CORS (comma separated). Empty => same-origin only via nginx.
  CORS_ALLOWED_ORIGINS: z.string().default(''),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = Object.freeze({
  ...parsed.data,
  isProd: parsed.data.NODE_ENV === 'production',
  isDev: parsed.data.NODE_ENV === 'development',
  isTest: parsed.data.NODE_ENV === 'test',

  // Límite del body de Express derivado de VAULT_MAX_BYTES (H-18): el blob viaja
  // dentro de un JSON, así que hay que dejar margen para el escapado y el resto
  // de campos. 1.4x cubre holgadamente ese overhead.
  jsonBodyLimit: Math.ceil(parsed.data.VAULT_MAX_BYTES * 1.4),
  corsOrigins: parsed.data.CORS_ALLOWED_ORIGINS
    ? parsed.data.CORS_ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
    : [],
});
