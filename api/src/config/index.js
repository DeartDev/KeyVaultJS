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
  corsOrigins: parsed.data.CORS_ALLOWED_ORIGINS
    ? parsed.data.CORS_ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
    : [],
});
