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
  if (rows.length === 0) return { valid: false };
  const row = rows[0];
  const expired = new Date(row.expires_at).getTime() < Date.now();
  return { valid: !row.revoked && !expired, row };
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

export const issueTokenPair = async (user) => {
  const accessToken = signAccessToken(user);
  const refreshToken = await signRefreshToken(user);
  return { accessToken, refreshToken };
};
