import { z } from 'zod';
import { config } from '../config/index.js';

const ivCipherPattern = /^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/;

export const putVaultSchema = z.object({
  encryptedBlob: z
    .string()
    .min(1, 'encryptedBlob required')
    .max(config.VAULT_MAX_BYTES, 'encryptedBlob too large')
    .regex(ivCipherPattern, 'encryptedBlob must be ivBase64:ciphertextBase64'),
  version: z.number().int().nonnegative(),
});
