import { Router } from 'express';
import { query } from '../db/pool.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.get('/', asyncHandler(async (_req, res) => {
  try {
    await query('SELECT 1');
    res.status(200).json({ status: 'ok', db: 'up' });
  } catch {
    res.status(503).json({ status: 'degraded', db: 'down' });
  }
}));

export default router;
