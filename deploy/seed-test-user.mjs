/**
 * seed-test-user.mjs
 * Crea un usuario de prueba con un vault ya poblado, cifrado exactamente igual
 * que lo haría el navegador (js/crypto.js): PBKDF2-SHA256 600k + AES-GCM,
 * formato "v2:<iteraciones>:<ivBase64>:<ciphertextBase64>".
 *
 *   node deploy/seed-test-user.mjs                       # valores por defecto
 *   node deploy/seed-test-user.mjs --email a@b.c --password 'Clave...' --count 20
 *   node deploy/seed-test-user.mjs --purge               # borra antes TODOS los usuarios
 *
 * El servidor sigue sin ver nada en claro: este script hace de "cliente", igual
 * que la PWA. Solo para entornos de desarrollo/pruebas.
 */
import { webcrypto as crypto } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const BASE_URL   = flag('url', 'http://127.0.0.1:8084');
const EMAIL      = flag('email', 'test@keyvault.local');
const PASSWORD   = flag('password', 'Acceso2026**');
const MASTER_PIN = flag('pin', PASSWORD);
const COUNT      = Number(flag('count', '20'));
const PURGE      = args.includes('--purge');
const DB_CONTAINER = flag('db-container', 'keyvault_db');

const ITERATIONS = 600000;
const FORMAT_VERSION = 'v2';

// ---------- generador de contraseñas (mismo criterio que js/generator.js) ----------
const SETS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!@#$%^&*()_+~`|}{[]:;?><,./-=',
};

/** Índice aleatorio sin sesgo de módulo. */
const randomIndex = (max) => {
  const limit = Math.floor(0xffffffff / max) * max;
  const buf = new Uint32Array(1);
  let value;
  do { crypto.getRandomValues(buf); value = buf[0]; } while (value >= limit);
  return value % max;
};

const pick = (set) => set[randomIndex(set.length)];

const generatePassword = (length = 18) => {
  const all = SETS.lower + SETS.upper + SETS.digits + SETS.symbols;
  // Se garantiza al menos uno de cada clase y se rellena el resto.
  const chars = [pick(SETS.lower), pick(SETS.upper), pick(SETS.digits), pick(SETS.symbols)];
  while (chars.length < length) chars.push(pick(all));
  // Fisher-Yates con la misma fuente de aleatoriedad (no Math.random).
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
};

// ---------- catálogo de servicios de prueba ----------
const SERVICES = [
  ['GitHub', 'dev.qa'], ['GitLab', 'dev.qa'], ['Google', 'qa.tester'],
  ['Microsoft 365', 'qa.tester'], ['AWS Console', 'iam-qa'], ['Cloudflare', 'ops.qa'],
  ['Netflix', 'familia.qa'], ['Spotify', 'musica.qa'], ['Amazon', 'compras.qa'],
  ['PayPal', 'pagos.qa'], ['Banco Pichincha', 'cliente.qa'], ['Slack', 'equipo.qa'],
  ['Notion', 'docs.qa'], ['Figma', 'diseno.qa'], ['Jira', 'pm.qa'],
  ['Docker Hub', 'registry.qa'], ['npm', 'publish.qa'], ['LinkedIn', 'perfil.qa'],
  ['Steam', 'juegos.qa'], ['Dropbox', 'archivos.qa'], ['Trello', 'tableros.qa'],
  ['Zoom', 'reuniones.qa'], ['Stripe', 'facturacion.qa'], ['DigitalOcean', 'infra.qa'],
];

const buildEntries = (n) => Array.from({ length: n }, (_, i) => {
  const [platform, user] = SERVICES[i % SERVICES.length];
  const suffix = i >= SERVICES.length ? `.${Math.floor(i / SERVICES.length) + 1}` : '';
  return {
    id: `seed-${String(i + 1).padStart(2, '0')}`,
    platform: platform + (suffix ? ` (${suffix.slice(1)})` : ''),
    username: `${user}${suffix}@keyvault.local`,
    password: generatePassword(18),
  };
});

// ---------- cripto: idéntica a js/crypto.js ----------
const toBase64 = (bytes) => Buffer.from(bytes).toString('base64');

const deriveKey = async (password, saltB64) => {
  const salt = Buffer.from(saltB64, 'base64');
  const material = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), { name: 'PBKDF2' }, false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
};

const encryptVault = async (data, pin, saltB64) => {
  const key = await deriveKey(pin, saltB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(data)),
  );
  return [FORMAT_VERSION, ITERATIONS, toBase64(iv), toBase64(new Uint8Array(ciphertext))].join(':');
};

const decryptVault = async (blob, pin, saltB64) => {
  const [, iterRaw, ivB64, ctB64] = blob.split(':');
  const salt = Buffer.from(saltB64, 'base64');
  const material = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(pin), { name: 'PBKDF2' }, false, ['deriveKey'],
  );
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: Number(iterRaw), hash: 'SHA-256' },
    material, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
  );
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: Buffer.from(ivB64, 'base64') }, key, Buffer.from(ctB64, 'base64'),
  );
  return JSON.parse(new TextDecoder().decode(plain));
};

// ---------- HTTP ----------
const call = async (path, { method = 'GET', body, token } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const payload = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(payload)}`);
  }
  return payload;
};

// ---------- flujo ----------
const main = async () => {
  if (PURGE) {
    console.log('· Borrando TODOS los usuarios existentes (cascada a vaults y refresh_tokens)...');
    execFileSync('docker', [
      'exec', DB_CONTAINER, 'psql', '-U', process.env.POSTGRES_USER || 'keyvault',
      '-d', process.env.POSTGRES_DB || 'keyvault',
      '-c', 'TRUNCATE users CASCADE;',
    ], { stdio: 'inherit' });
  }

  console.log(`· Registrando ${EMAIL} en ${BASE_URL}...`);
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const vaultSalt = toBase64(saltBytes);
  const session = await call('/api/auth/register', {
    method: 'POST', body: { email: EMAIL, password: PASSWORD, vaultSalt },
  });

  const entries = buildEntries(COUNT);
  console.log(`· Cifrando ${entries.length} credenciales (PBKDF2 ${ITERATIONS.toLocaleString('es')} + AES-GCM)...`);
  const blob = await encryptVault(entries, MASTER_PIN, session.user.vaultSalt);

  const put = await call('/api/vault', {
    method: 'PUT', token: session.accessToken, body: { encryptedBlob: blob, version: 0 },
  });
  console.log(`· Vault subido (versión ${put.version}, ${blob.length} bytes de blob).`);

  // Verificación de ida y vuelta: se descarga y descifra igual que el navegador.
  const remote = await call('/api/vault', { token: session.accessToken });
  const roundTrip = await decryptVault(remote.encryptedBlob, MASTER_PIN, session.user.vaultSalt);
  if (roundTrip.length !== entries.length) throw new Error('El round-trip no coincide');
  console.log(`· Verificado: descargado y descifrado con ${roundTrip.length} entradas.\n`);

  console.log('='.repeat(74));
  console.log('  USUARIO DE PRUEBA');
  console.log('='.repeat(74));
  console.log(`  URL                    ${BASE_URL}`);
  console.log(`  Email                  ${EMAIL}`);
  console.log(`  Contraseña de cuenta   ${PASSWORD}`);
  console.log(`  PIN / llave maestra    ${MASTER_PIN}`);
  console.log('='.repeat(74));
  console.log(`  ${entries.length} CONTRASEÑAS DE PRUEBA EN LA BÓVEDA`);
  console.log('='.repeat(74));
  const pad = Math.max(...entries.map((e) => e.platform.length));
  for (const e of entries) {
    console.log(`  ${e.platform.padEnd(pad)}  ${e.username.padEnd(28)}  ${e.password}`);
  }
  console.log('='.repeat(74));
};

main().catch((err) => {
  console.error('\n[x] Fallo al sembrar los datos de prueba:', err.message);
  process.exit(1);
});
