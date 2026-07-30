import { query, withTransaction } from '../db/pool.js';
import { hashPassword, comparePassword } from '../utils/password.js';
import {
  issueTokenPair,
  verifyRefreshToken,
  isRefreshTokenValid,
  revokeRefreshToken,
} from '../utils/jwt.js';
import {
  conflict,
  unauthorized,
  badRequest,
} from '../utils/httpErrors.js';

const publicUser = (u) => ({ id: u.id, email: u.email, vaultSalt: u.vault_salt });

export const register = async (req, res) => {
  const { email, password, vaultSalt } = req.body;

  const existing = await query(
    `SELECT id FROM users WHERE email = $1`,
    [email],
  );
  if (existing.rowCount > 0) {
    throw conflict('email_taken', 'Email already registered');
  }

  const passwordHash = await hashPassword(password);

  const user = await withTransaction(async (client) => {
    const ins = await client.query(
      `INSERT INTO users (email, password_hash, vault_salt)
       VALUES ($1, $2, $3)
       RETURNING id, email, vault_salt`,
      [email, passwordHash, vaultSalt],
    );
    const created = ins.rows[0];

    // Seed an empty vault. Blob is a placeholder valid format: empty ciphertext.
    await client.query(
      `INSERT INTO vaults (user_id, encrypted_blob, version)
       VALUES ($1, ':', 0)`,
      [created.id],
    );

    return created;
  });

  const tokens = await issueTokenPair(user);

  res.status(201).json({
    user: publicUser(user),
    ...tokens,
  });
};

export const login = async (req, res) => {
  const { email, password } = req.body;

  const { rows } = await query(
    `SELECT id, email, password_hash, vault_salt
       FROM users
      WHERE email = $1
      LIMIT 1`,
    [email],
  );

  // Always run a compare to reduce timing-attack leakage.
  const dummy = '$2b$12$oooooooooooooooooooooooooooooooooooooooooooooooooooooo';
  const hashToCompare = rows.length > 0 ? rows[0].password_hash : dummy;
  const ok = await comparePassword(password, hashToCompare);

  if (rows.length === 0 || !ok) {
    throw unauthorized('invalid_credentials', 'Invalid email or password');
  }

  const user = rows[0];
  const tokens = await issueTokenPair(user);

  res.status(200).json({
    user: publicUser(user),
    ...tokens,
  });
};

export const refresh = async (req, res) => {
  const { refreshToken } = req.body;

  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw unauthorized('invalid_token', 'Invalid refresh token');
  }
  if (payload.type !== 'refresh') {
    throw unauthorized('invalid_token', 'Invalid token type');
  }

  const state = await isRefreshTokenValid(refreshToken);
  if (!state.valid) {
    throw unauthorized('invalid_token', 'Refresh token revoked or expired');
  }

  // Rotation: revoke current, issue new pair.
  await revokeRefreshToken(refreshToken);

  const { rows } = await query(
    `SELECT id, email, vault_salt FROM users WHERE id = $1`,
    [payload.sub],
  );
  if (rows.length === 0) {
    throw unauthorized('invalid_token', 'User no longer exists');
  }
  const user = rows[0];
  const tokens = await issueTokenPair(user);

  res.status(200).json(tokens);
};

export const logout = async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) throw badRequest('refreshToken required');

  try {
    verifyRefreshToken(refreshToken);
  } catch {
    // Idempotent logout: even if token is invalid/expired, return 204.
    return res.status(204).end();
  }

  await revokeRefreshToken(refreshToken);
  res.status(204).end();
};
