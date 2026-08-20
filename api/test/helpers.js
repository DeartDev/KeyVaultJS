/**
 * helpers.js
 * Arranque de la API contra una base de datos de pruebas efímera.
 *
 * Se ejecuta DENTRO del contenedor api, que ya tiene DATABASE_URL apuntando al
 * Postgres de compose; aquí solo se cambia el nombre de la base para no tocar
 * los datos reales:
 *
 *   docker compose exec -T api npm test
 *
 * El entorno se fija ANTES de importar la app porque config/index.js valida
 * process.env en tiempo de importación (fail-fast).
 */
import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'src', 'db', 'migrations');

const TEST_DB = process.env.TEST_DB_NAME || 'keyvault_test';

const swapDatabase = (url, dbName) => {
  const parsed = new URL(url);
  parsed.pathname = `/${dbName}`;
  return parsed.toString();
};

export const TEST_ENV = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  BCRYPT_ROUNDS: '10',          // los tests no necesitan coste 12
  TRUST_PROXY_HOPS: '1',
  RATE_LIMIT_WINDOW_MS: '60000',
  RATE_LIMIT_AUTH_MAX_IP: '10000',  // alto: no debe interferir con el resto
  RATE_LIMIT_AUTH_MAX_EMAIL: '5',   // bajo: el test de rate limit lo verifica
  REFRESH_TOKEN_PURGE_DAYS: '30',
};

/** Crea (si hace falta) la base de pruebas y aplica todas las migraciones. */
export const prepareDatabase = async () => {
  const source = process.env.DATABASE_URL;
  if (!source) throw new Error('DATABASE_URL es obligatorio para los tests');

  const adminUrl = swapDatabase(source, 'postgres');
  const testUrl = swapDatabase(source, TEST_DB);

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const { rowCount } = await admin.query(
      'SELECT 1 FROM pg_database WHERE datname = $1', [TEST_DB],
    );
    if (rowCount === 0) await admin.query(`CREATE DATABASE ${TEST_DB}`);
  } finally {
    await admin.end();
  }

  const client = new pg.Client({ connectionString: testUrl });
  await client.connect();
  try {
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    if (files.length === 0) throw new Error('No hay migraciones que aplicar');
    for (const f of files) {
      await client.query(await readFile(join(MIGRATIONS_DIR, f), 'utf8'));
    }
  } finally {
    await client.end();
  }

  Object.assign(process.env, TEST_ENV, { DATABASE_URL: testUrl });
  return testUrl;
};

/**
 * Levanta la app en un puerto efímero. Devuelve { baseUrl, close, truncate }.
 * La app se importa dinámicamente para que ocurra después de fijar el entorno.
 */
export const startServer = async () => {
  const { default: app } = await import('../src/app.js');
  const { pool, closePool } = await import('../src/db/pool.js');

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address();

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    truncate: () => pool.query('TRUNCATE users, vaults, refresh_tokens CASCADE'),
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await closePool();
    },
  };
};

/** Cliente HTTP mínimo: devuelve { status, body } sin lanzar en errores HTTP. */
export const makeClient = (baseUrl) => async (path, { method = 'GET', body, token } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  let parsed = null;
  if (text) {
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
  }
  return { status: res.status, body: parsed };
};

let seq = 0;
export const uniqueEmail = (prefix = 'user') => `${prefix}${++seq}.${Date.now()}@test.local`;

// 16 bytes en base64: cumple el mínimo endurecido de vaultSalt (H-20).
export const VAULT_SALT = Buffer.from('0123456789abcdef').toString('base64');
export const PASSWORD = 'CorrectHorseBattery1';
