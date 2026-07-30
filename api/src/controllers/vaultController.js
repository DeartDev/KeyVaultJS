import { query, withTransaction } from '../db/pool.js';
import { notFound, conflict } from '../utils/httpErrors.js';

const EMPTY_BLOB = ':';

export const getVault = async (req, res) => {
  const { rows } = await query(
    `SELECT encrypted_blob, version, updated_at
       FROM vaults
      WHERE user_id = $1
      LIMIT 1`,
    [req.user.id],
  );
  if (rows.length === 0) {
    throw notFound('Vault not found');
  }
  const row = rows[0];
  res.status(200).json({
    encryptedBlob: row.encrypted_blob,
    version: row.version,
    updatedAt: row.updated_at,
  });
};

export const putVault = async (req, res) => {
  const { encryptedBlob, version } = req.body;

  const result = await withTransaction(async (client) => {
    const sel = await client.query(
      `SELECT version FROM vaults WHERE user_id = $1 FOR UPDATE`,
      [req.user.id],
    );

    if (sel.rowCount === 0) {
      // First upload if the register step didn't seed a row.
      if (version !== 0) {
        throw conflict(
          'version_conflict',
          'Vault does not exist yet; send version = 0',
          { currentVersion: null },
        );
      }
      const ins = await client.query(
        `INSERT INTO vaults (user_id, encrypted_blob, version)
         VALUES ($1, $2, 1)
         RETURNING version, updated_at`,
        [req.user.id, encryptedBlob],
      );
      return ins.rows[0];
    }

    const currentVersion = sel.rows[0].version;
    if (version !== currentVersion) {
      throw conflict(
        'version_conflict',
        'The vault was modified in another device. Pull and retry.',
        { currentVersion },
      );
    }

    const upd = await client.query(
      `UPDATE vaults
          SET encrypted_blob = $1, version = version + 1
        WHERE user_id = $2
      RETURNING version, updated_at`,
      [encryptedBlob, req.user.id],
    );
    return upd.rows[0];
  });

  res.status(200).json({
    version: result.version,
    updatedAt: result.updated_at,
  });
};

void EMPTY_BLOB;
