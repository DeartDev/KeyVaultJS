import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { config } from '../config/index.js';
import { query } from '../db/pool.js';

export const signAccessToken = (user) =>
  jwt.sign(
    { sub: user.id, email: user.email, type: 'access' },
    config.JWT_SECRET,
    { expiresIn: config.JWT_ACCESS_TTL },
  );

export const signRefreshToken = async (user) => {
  const jti = crypto.randomUUID();
  const token = jwt.sign(
    { sub: user.id, jid: jti, type: 'refresh' },
    config.JWT_REFRESH_SECRET,
    { expiresIn: config.JWT_REFRESH_TTL },
  );

  const decoded = jwt.decode(token);
  const tokenHash = sha256Hex(token);

  await query(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
     VALUES (gen_random_uuid(), $1, $2, to_timestamp($3))`,
    [user.id, tokenHash, decoded.exp],
  );

  return token;
};

export const verifyAccessToken = (token) =>
  jwt.verify(token, config.JWT_SECRET);

export const verifyRefreshToken = (token) =>
  jwt.verify(token, config.JWT_REFRESH_SECRET);

export const sha256Hex = (value) =>
  crypto.createHash('sha256').update(value).digest('hex');

export const isRefreshTokenValid = async (token) => {
  const tokenHash = sha256Hex(token);
  const { rows } = await query(
    `SELECT id, user_id, expires_at, revoked
       FROM refresh_tokens
      WHERE token_hash = $1
      LIMIT 1`,
    [tokenHash],
  );
  if (rows.length === 0) return { valid: false, row: null };
  const row = rows[0];
  const expired = new Date(row.expires_at).getTime() < Date.now();
  return { valid: !row.revoked && !expired, expired, row };
};

export const revokeRefreshToken = async (token) => {
  const tokenHash = sha256Hex(token);
  await query(`UPDATE refresh_tokens SET revoked = true WHERE token_hash = $1`, [
    tokenHash,
  ]);
};

export const revokeAllRefreshTokensForUser = async (userId) => {
  await query(`UPDATE refresh_tokens SET revoked = true WHERE user_id = $1`, [
    userId,
  ]);
};

/**
 * H-14: purga de refresh_tokens expirados o revocados hace más de N días.
 * Sin esto la tabla crece indefinidamente. Se llama de forma oportunista
 * (no bloqueante) desde el flujo de login/registro y desde el cron de backup.
 */
export const purgeStaleRefreshTokens = async () => {
  const days = config.REFRESH_TOKEN_PURGE_DAYS;
  const { rowCount } = await query(
    `DELETE FROM refresh_tokens
      WHERE expires_at < now() - ($1 || ' days')::interval
         OR (revoked AND created_at < now() - ($1 || ' days')::interval)`,
    [String(days)],
  );
  return rowCount;
};

// Throttle en memoria: como mucho una purga por hora y por proceso.
const PURGE_INTERVAL_MS = 60 * 60 * 1000;
let lastPurgeAt = 0;

export const maybePurgeStaleRefreshTokens = (log) => {
  const now = Date.now();
  if (now - lastPurgeAt < PURGE_INTERVAL_MS) return;
  lastPurgeAt = now;
  // Fire-and-forget: nunca debe retrasar ni romper la respuesta al usuario.
  purgeStaleRefreshTokens()
    .then((n) => { if (n > 0) log?.info({ purged: n }, 'refresh_tokens purged'); })
    .catch((err) => log?.warn({ err }, 'refresh_tokens purge failed'));
};

export const issueTokenPair = async (user) => {
  const accessToken = signAccessToken(user);
  const refreshToken = await signRefreshToken(user);
  return { accessToken, refreshToken };
};
