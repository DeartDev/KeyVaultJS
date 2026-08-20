/**
 * api.test.js
 * Suite de integración de la API contra un Postgres real.
 *
 *   docker compose exec -T api npm test
 *
 * Cubre los criterios de aceptación del plan de mejora: rotación y revocación
 * de refresh tokens, detección de reutilización (H-11), bloqueo optimista del
 * vault, validaciones de esquema y rate limiting (H-04).
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  prepareDatabase,
  startServer,
  makeClient,
  uniqueEmail,
  VAULT_SALT,
  PASSWORD,
} from './helpers.js';

let api;   // cliente HTTP
let srv;   // { baseUrl, close, truncate }

before(async () => {
  await prepareDatabase();
  srv = await startServer();
  api = makeClient(srv.baseUrl);
});

after(async () => { await srv.close(); });

beforeEach(async () => { await srv.truncate(); });

const register = (overrides = {}) => api('/api/auth/register', {
  method: 'POST',
  body: { email: uniqueEmail(), password: PASSWORD, vaultSalt: VAULT_SALT, ...overrides },
});

// ==========================================
// Salud
// ==========================================
test('GET /api/health responde ok con la base arriba', async () => {
  const res = await api('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.db, 'up');
});

// ==========================================
// Registro
// ==========================================
test('register crea la cuenta, devuelve tokens y hace eco del vaultSalt', async () => {
  const email = uniqueEmail();
  const res = await register({ email });

  assert.equal(res.status, 201);
  assert.equal(res.body.user.email, email);
  assert.equal(res.body.user.vaultSalt, VAULT_SALT);
  assert.ok(res.body.accessToken);
  assert.ok(res.body.refreshToken);
  assert.equal(res.body.user.passwordHash, undefined, 'no debe filtrar el hash');
});

test('register rechaza un email ya registrado con 409', async () => {
  const email = uniqueEmail();
  assert.equal((await register({ email })).status, 201);

  const dup = await register({ email });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error, 'email_taken');
});

test('register rechaza contraseñas de menos de 12 caracteres', async () => {
  const res = await register({ password: 'corta123' });
  assert.equal(res.status, 422);
  assert.equal(res.body.error, 'validation_error');
});

test('register rechaza un vaultSalt más corto que 16 bytes (H-20)', async () => {
  const res = await register({ vaultSalt: 'c2hvcnQ=' }); // 6 bytes
  assert.equal(res.status, 422);
  assert.ok(res.body.details.some((d) => d.path === 'vaultSalt'));
});

// ==========================================
// Login
// ==========================================
test('login devuelve un par de tokens con credenciales correctas', async () => {
  const email = uniqueEmail();
  await register({ email });

  const res = await api('/api/auth/login', { method: 'POST', body: { email, password: PASSWORD } });
  assert.equal(res.status, 200);
  assert.ok(res.body.accessToken);
  assert.equal(res.body.user.vaultSalt, VAULT_SALT);
});

test('login normaliza el email (trim + minúsculas)', async () => {
  const email = uniqueEmail();
  await register({ email });

  const res = await api('/api/auth/login', {
    method: 'POST',
    body: { email: `  ${email.toUpperCase()}  `, password: PASSWORD },
  });
  assert.equal(res.status, 200);
});

test('login con contraseña incorrecta y con email inexistente dan la misma respuesta', async () => {
  const email = uniqueEmail();
  await register({ email });

  const wrongPassword = await api('/api/auth/login', {
    method: 'POST', body: { email, password: 'IncorrectaPeroLarga1' },
  });
  const unknownEmail = await api('/api/auth/login', {
    method: 'POST', body: { email: uniqueEmail(), password: PASSWORD },
  });

  assert.equal(wrongPassword.status, 401);
  assert.equal(unknownEmail.status, 401);
  // No debe poder distinguirse si la cuenta existe (H-09).
  assert.deepEqual(wrongPassword.body, unknownEmail.body);
});

// ==========================================
// Refresh: rotación y reutilización
// ==========================================
test('refresh rota el token: el anterior deja de servir', async () => {
  const { body: session } = await register();

  const rotated = await api('/api/auth/refresh', {
    method: 'POST', body: { refreshToken: session.refreshToken },
  });
  assert.equal(rotated.status, 200);
  assert.notEqual(rotated.body.refreshToken, session.refreshToken);

  const reused = await api('/api/auth/refresh', {
    method: 'POST', body: { refreshToken: session.refreshToken },
  });
  assert.equal(reused.status, 401);
});

test('reutilizar un refresh token ya rotado revoca todas las sesiones (H-11)', async () => {
  const { body: session } = await register();

  const rotated = await api('/api/auth/refresh', {
    method: 'POST', body: { refreshToken: session.refreshToken },
  });
  assert.equal(rotated.status, 200);

  // El atacante presenta el token viejo: se asume robo.
  const reuse = await api('/api/auth/refresh', {
    method: 'POST', body: { refreshToken: session.refreshToken },
  });
  assert.equal(reuse.status, 401);
  assert.equal(reuse.body.error, 'token_reuse_detected');

  // Y el token legítimo emitido en la rotación también queda revocado.
  const legit = await api('/api/auth/refresh', {
    method: 'POST', body: { refreshToken: rotated.body.refreshToken },
  });
  assert.equal(legit.status, 401);
});

test('refresh rechaza un token con firma inválida', async () => {
  const res = await api('/api/auth/refresh', {
    method: 'POST', body: { refreshToken: 'no.es.un.jwt' },
  });
  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'invalid_token');
});

// ==========================================
// Logout
// ==========================================
test('logout revoca el refresh token y es idempotente', async () => {
  const { body: session } = await register();

  assert.equal((await api('/api/auth/logout', {
    method: 'POST', body: { refreshToken: session.refreshToken },
  })).status, 204);

  assert.equal((await api('/api/auth/refresh', {
    method: 'POST', body: { refreshToken: session.refreshToken },
  })).status, 401);

  // Repetir el logout no debe fallar.
  assert.equal((await api('/api/auth/logout', {
    method: 'POST', body: { refreshToken: session.refreshToken },
  })).status, 204);
});

test('logout sin refreshToken se valida por esquema (H-19)', async () => {
  const res = await api('/api/auth/logout', { method: 'POST', body: {} });
  assert.equal(res.status, 422);
  assert.equal(res.body.error, 'validation_error');
});

// ==========================================
// Vault
// ==========================================
test('el vault exige autenticación', async () => {
  assert.equal((await api('/api/vault')).status, 401);
  assert.equal((await api('/api/vault', { token: 'basura' })).status, 401);
});

test('tras registrarse el vault existe, vacío y en versión 0', async () => {
  const { body: session } = await register();
  const res = await api('/api/vault', { token: session.accessToken });

  assert.equal(res.status, 200);
  assert.equal(res.body.version, 0);
  assert.equal(res.body.encryptedBlob, ':');
});

test('PUT del vault incrementa la versión y acepta el formato v2 (H-10)', async () => {
  const { body: session } = await register();
  const blob = 'v2:600000:aXZiYXNlNjQ=:Y2lwaGVydGV4dA==';

  const put = await api('/api/vault', {
    method: 'PUT', token: session.accessToken, body: { encryptedBlob: blob, version: 0 },
  });
  assert.equal(put.status, 200);
  assert.equal(put.body.version, 1);

  const get = await api('/api/vault', { token: session.accessToken });
  assert.equal(get.body.encryptedBlob, blob);
});

test('PUT del vault sigue aceptando el formato legado iv:ciphertext', async () => {
  const { body: session } = await register();
  const res = await api('/api/vault', {
    method: 'PUT', token: session.accessToken,
    body: { encryptedBlob: 'aXZiYXNlNjQ=:Y2lwaGVydGV4dA==', version: 0 },
  });
  assert.equal(res.status, 200);
});

test('PUT con una versión desfasada devuelve 409 con la versión actual', async () => {
  const { body: session } = await register();
  const blob = 'v2:600000:aXZiYXNlNjQ=:Y2lwaGVydGV4dA==';

  await api('/api/vault', {
    method: 'PUT', token: session.accessToken, body: { encryptedBlob: blob, version: 0 },
  });

  const stale = await api('/api/vault', {
    method: 'PUT', token: session.accessToken, body: { encryptedBlob: blob, version: 0 },
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, 'version_conflict');
  assert.equal(stale.body.details.currentVersion, 1);
});

test('PUT rechaza un blob con formato inválido', async () => {
  const { body: session } = await register();
  const res = await api('/api/vault', {
    method: 'PUT', token: session.accessToken,
    body: { encryptedBlob: 'esto no es un blob', version: 0 },
  });
  assert.equal(res.status, 422);
});

test('un usuario no puede leer el vault de otro', async () => {
  const a = (await register()).body;
  const b = (await register()).body;
  const blob = 'v2:600000:aXZiYXNlNjQ=:Y2lwaGVydGV4dA==';

  await api('/api/vault', {
    method: 'PUT', token: a.accessToken, body: { encryptedBlob: blob, version: 0 },
  });

  const res = await api('/api/vault', { token: b.accessToken });
  assert.equal(res.status, 200);
  assert.equal(res.body.encryptedBlob, ':', 'cada usuario ve solo su propio vault');
});

// ==========================================
// Cambio de contraseña de cuenta (Fase 4 / H-23)
// ==========================================
const NEW_PASSWORD = 'NuevaClaveSegura99';

test('change-password exige sesión activa', async () => {
  const res = await api('/api/auth/change-password', {
    method: 'POST', body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
  });
  assert.equal(res.status, 401);
});

test('change-password cambia la contraseña y devuelve tokens nuevos', async () => {
  const email = uniqueEmail();
  const { body: session } = await register({ email });

  const res = await api('/api/auth/change-password', {
    method: 'POST', token: session.accessToken,
    body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
  });

  assert.equal(res.status, 200);
  assert.ok(res.body.accessToken);
  assert.ok(res.body.refreshToken);
  assert.notEqual(res.body.refreshToken, session.refreshToken);

  // El par nuevo sirve de inmediato: no hace falta volver a iniciar sesión.
  const vault = await api('/api/vault', { token: res.body.accessToken });
  assert.equal(vault.status, 200);
});

test('tras el cambio, solo la contraseña nueva permite iniciar sesión', async () => {
  const email = uniqueEmail();
  const { body: session } = await register({ email });

  await api('/api/auth/change-password', {
    method: 'POST', token: session.accessToken,
    body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
  });

  const conNueva = await api('/api/auth/login', { method: 'POST', body: { email, password: NEW_PASSWORD } });
  assert.equal(conNueva.status, 200);

  const conVieja = await api('/api/auth/login', { method: 'POST', body: { email, password: PASSWORD } });
  assert.equal(conVieja.status, 401);
});

test('el cambio revoca los refresh tokens emitidos antes', async () => {
  const email = uniqueEmail();
  const { body: session } = await register({ email });

  const res = await api('/api/auth/change-password', {
    method: 'POST', token: session.accessToken,
    body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
  });
  assert.equal(res.status, 200);

  // El refresh token anterior al cambio ya no vale...
  const viejo = await api('/api/auth/refresh', {
    method: 'POST', body: { refreshToken: session.refreshToken },
  });
  assert.equal(viejo.status, 401);

  // ...y el emitido junto al cambio sí. Importante: el intento fallido de
  // arriba NO debe activar la detección de reutilización (H-11) y tumbar de
  // paso la sesión recién creada. Un dispositivo obsoleto no puede echar al
  // usuario que acaba de cambiar la contraseña.
  const nuevo = await api('/api/auth/refresh', {
    method: 'POST', body: { refreshToken: res.body.refreshToken },
  });
  assert.equal(nuevo.status, 200, 'la sesión nueva debe sobrevivir al refresh fallido de un dispositivo viejo');
});

test('change-password con la contraseña actual incorrecta da 401 y no cambia nada', async () => {
  const email = uniqueEmail();
  const { body: session } = await register({ email });

  const res = await api('/api/auth/change-password', {
    method: 'POST', token: session.accessToken,
    body: { currentPassword: 'EstaNoEsLaBuena1', newPassword: NEW_PASSWORD },
  });
  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'invalid_credentials');

  // El hash sigue intacto: la contraseña original todavía funciona.
  const login = await api('/api/auth/login', { method: 'POST', body: { email, password: PASSWORD } });
  assert.equal(login.status, 200);
});

test('change-password rechaza con 400 una contraseña nueva igual a la actual', async () => {
  const { body: session } = await register();

  const res = await api('/api/auth/change-password', {
    method: 'POST', token: session.accessToken,
    body: { currentPassword: PASSWORD, newPassword: PASSWORD },
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'bad_request');
});

test('change-password rechaza con 422 una contraseña nueva demasiado corta', async () => {
  const { body: session } = await register();

  const res = await api('/api/auth/change-password', {
    method: 'POST', token: session.accessToken,
    body: { currentPassword: PASSWORD, newPassword: 'corta123' },
  });
  assert.equal(res.status, 422);
  assert.equal(res.body.error, 'validation_error');
});

test('cambiar la contraseña de cuenta no toca el vault ni el vaultSalt', async () => {
  const email = uniqueEmail();
  const { body: session } = await register({ email });
  const blob = 'v2:600000:aXZiYXNlNjQ=:Y2lwaGVydGV4dA==';

  await api('/api/vault', {
    method: 'PUT', token: session.accessToken, body: { encryptedBlob: blob, version: 0 },
  });

  const changed = await api('/api/auth/change-password', {
    method: 'POST', token: session.accessToken,
    body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
  });
  assert.equal(changed.status, 200);

  // El PIN maestro y la bóveda son independientes de la contraseña de cuenta.
  const login = await api('/api/auth/login', { method: 'POST', body: { email, password: NEW_PASSWORD } });
  assert.equal(login.body.user.vaultSalt, VAULT_SALT);

  const vault = await api('/api/vault', { token: login.body.accessToken });
  assert.equal(vault.body.encryptedBlob, blob);
  assert.equal(vault.body.version, 1);
});

// ==========================================
// Rate limiting (H-04)
// ==========================================
test('intentos fallidos repetidos contra la misma cuenta acaban en 429', async () => {
  const email = uniqueEmail();
  await register({ email });

  const attempt = () => api('/api/auth/login', {
    method: 'POST', body: { email, password: 'ContraseñaMala123' },
  });

  // RATE_LIMIT_AUTH_MAX_EMAIL = 5 en el entorno de test.
  const statuses = [];
  for (let i = 0; i < 7; i++) statuses.push((await attempt()).status);

  assert.ok(statuses.slice(0, 5).every((s) => s === 401), `esperaba 401s: ${statuses}`);
  assert.ok(statuses.includes(429), `esperaba algún 429: ${statuses}`);

  // El límite por email solo cuenta fallos, pero una vez agotado bloquea
  // también los intentos con la contraseña correcta durante la ventana.
  const good = await api('/api/auth/login', { method: 'POST', body: { email, password: PASSWORD } });
  assert.equal(good.status, 429);
});
