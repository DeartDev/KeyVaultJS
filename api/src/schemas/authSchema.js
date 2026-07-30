import { z } from 'zod';

const base64Pattern = /^[A-Za-z0-9+/]+={0,2}$/;

export const registerSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email({ message: 'Invalid email' })
    .max(255),
  password: z
    .string()
    .min(12, 'Password must be at least 12 characters')
    .max(128, 'Password too long'),
  vaultSalt: z
    .string()
    .min(8, 'vaultSalt required')
    .regex(base64Pattern, 'vaultSalt must be base64'),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(128),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'refreshToken required'),
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(1, 'refreshToken required'),
});
