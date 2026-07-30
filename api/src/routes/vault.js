import { Router } from 'express';
import { getVault, putVault } from '../controllers/vaultController.js';
import { putVaultSchema } from '../schemas/vaultSchema.js';
import { requireAuth } from '../middleware/auth.js';
import { validationError } from '../utils/httpErrors.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const validatePut = (req, _res, next) => {
  const result = putVaultSchema.safeParse(req.body);
  if (!result.success) {
    return next(validationError(
      result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    ));
  }
  req.body = result.data;
  next();
};

const router = Router();

router.use(requireAuth);
router.get('/', asyncHandler(getVault));
router.put('/', validatePut, asyncHandler(putVault));

export default router;
