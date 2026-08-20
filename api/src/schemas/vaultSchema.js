import { z } from 'zod';
import { config } from '../config/index.js';

// Formatos aceptados para el blob opaco (el servidor nunca lo descifra):
//   - v2 (actual):  "v2:<iteracionesPBKDF2>:<ivBase64>:<ciphertextBase64>"
//   - legacy:       "<ivBase64>:<ciphertextBase64>"  (PBKDF2 100k implícito)
// El prefijo versionado (H-10) permite cambiar los parámetros del KDF sin
// romper los vaults ya cifrados: el cliente los re-cifra al siguiente guardado.
const ivCipherPattern = /^(v\d+:\d+:)?[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/;

export const putVaultSchema = z.object({
  encryptedBlob: z
    .string()
    .min(1, 'encryptedBlob required')
    .max(config.VAULT_MAX_BYTES, 'encryptedBlob too large')
    .regex(ivCipherPattern, 'encryptedBlob must be ivBase64:ciphertextBase64'),
  version: z.number().int().nonnegative(),
});
