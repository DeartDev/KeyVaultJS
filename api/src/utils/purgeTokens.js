/**
 * purgeTokens.js
 * Purga de refresh_tokens expirados o revocados (H-14), ejecutable como job.
 *
 *   docker compose exec -T api node src/utils/purgeTokens.js
 *
 * La API también purga de forma oportunista en cada login (máximo 1 vez/hora
 * por proceso); este script existe para el cron que instala deploy/deploy.sh,
 * de modo que la tabla se mantenga acotada aunque nadie inicie sesión.
 */
import { purgeStaleRefreshTokens } from './jwt.js';
import { closePool } from '../db/pool.js';
import { config } from '../config/index.js';

try {
  const deleted = await purgeStaleRefreshTokens();
  console.log(
    `purged ${deleted} refresh token(s) older than ${config.REFRESH_TOKEN_PURGE_DAYS} day(s)`,
  );
} catch (err) {
  console.error('purge failed:', err);
  process.exitCode = 1;
} finally {
  await closePool();
}
