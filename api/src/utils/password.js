import bcrypt from 'bcrypt';
import { config } from '../config/index.js';

export const hashPassword = (plain) =>
  bcrypt.hash(plain, config.BCRYPT_ROUNDS);

export const comparePassword = (plain, hash) =>
  bcrypt.compare(plain, hash);
