import { randomUUID } from 'node:crypto';
import { query, withTransaction } from '../db/pool.js';
import { hashPassword, comparePassword } from '../utils/password.js';
import {
  issueTokenPair,
  verifyRefreshToken,
  isRefreshTokenValid,
  revokeRefreshToken,
  revokeAllRefreshTokensForUser,
  maybePurgeStaleRefreshTokens,
} from '../utils/jwt.js';
import {
  conflict,
  unauthorized,
} from '../utils/httpErrors.js';

const publicUser = (u) => ({ id: u.id, email: u.email, vaultSalt: u.vault_salt });

/**
 * H-09: hash bcrypt "dummy" para igualar el tiempo de respuesta cuando el email
 * no existe. El literal anterior era inválido (54 chars tras el prefijo en vez
 * de 53), así que bcrypt.compare devolvía false de inmediato y el tiempo de
 * respuesta seguía delatando qué emails están registrados.
 *
 * Se genera una sola vez por proceso, de forma perezosa, con el mismo coste
 * configurado para los hashes reales.
 */
let dummyHashPromise = null;
const getDummyHash = () => {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword(randomUUID()).catch((err) => {
      dummyHashPromise = null; // permite reintentar en la siguiente petición
      throw err;
    });
  }
  return dummyHashPromise;
};

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
  const hashToCompare = rows.length > 0 ? rows[0].password_hash : await getDummyHash();
  const ok = await comparePassword(password, hashToCompare);

  if (rows.length === 0 || !ok) {
    throw unauthorized('invalid_credentials', 'Invalid email or password');
  }

  const user = rows[0];
  const tokens = await issueTokenPair(user);

  // H-14: mantenimiento oportunista (no bloqueante, como mucho 1 vez/hora).
  maybePurgeStaleRefreshTokens(req.log);

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
    // H-11: detección de reutilización. Si el token es criptográficamente válido
    // y está en la tabla pero ya fue rotado (revoked), quien lo presenta tiene una
    // copia obsoleta: o bien es el atacante, o bien es la víctima cuyo token le
    // robaron. En ambos casos lo correcto es revocar toda la familia y forzar un
    // login nuevo, en lugar de limitarse a devolver 401.
    if (state.row && state.row.revoked && !state.expired) {
      await revokeAllRefreshTokensForUser(state.row.user_id);
      req.log?.warn(
        { userId: state.row.user_id },
        'refresh token reuse detected: all sessions revoked',
      );
      throw unauthorized('token_reuse_detected', 'Session revoked for security reasons');
    }
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

  try {
    verifyRefreshToken(refreshToken);
  } catch {
    // Idempotent logout: even if token is invalid/expired, return 204.
    return res.status(204).end();
  }

  await revokeRefreshToken(refreshToken);
  res.status(204).end();
};
