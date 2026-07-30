import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import 'dotenv/config';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'db', 'migrations');

const args = process.argv.slice(2);
const command = args[0] || 'up';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const ensureMigrationsTable = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
};

const listApplied = async (client) => {
  const { rows } = await client.query(
    `SELECT filename FROM schema_migrations ORDER BY filename ASC`,
  );
  return new Set(rows.map((r) => r.filename));
};

const listAvailable = async () => {
  const files = await readdir(MIGRATIONS_DIR);
  return files.filter((f) => f.endsWith('.sql')).sort();
};

const runMigration = async (client, filename) => {
  const sql = await readFile(join(MIGRATIONS_DIR, filename), 'utf8');
  console.log(`> applying ${filename}`);
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query(
      `INSERT INTO schema_migrations (filename) VALUES ($1)
       ON CONFLICT (filename) DO NOTHING`,
      [filename],
    );
    await client.query('COMMIT');
    console.log(`  ok: ${filename}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`  FAILED: ${filename}`);
    throw err;
  }
};

const main = async () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await ensureMigrationsTable(client);

    if (command === 'status') {
      const applied = await listApplied(client);
      const available = await listAvailable();
      console.log('Migrations status:');
      for (const f of available) {
        console.log(`  [${applied.has(f) ? 'x' : ' '}] ${f}`);
      }
      return;
    }

    if (command === 'up') {
      const applied = await listApplied(client);
      const available = await listAvailable();
      const pending = available.filter((f) => !applied.has(f));
      if (pending.length === 0) {
        console.log('No pending migrations.');
        return;
      }
      for (const f of pending) {
        await runMigration(client, f);
      }
      console.log(`Applied ${pending.length} migration(s).`);
      return;
    }

    console.error(`Unknown command: ${command}. Use: up | status`);
    process.exit(1);
  } finally {
    await client.end();
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
