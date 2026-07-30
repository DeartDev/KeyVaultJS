import { Router } from 'express';
import {
  register,
  login,
  refresh,
  logout,
} from '../controllers/authController.js';
import {
  registerSchema,
  loginSchema,
  refreshSchema,
} from '../schemas/authSchema.js';
import { validationError } from '../utils/httpErrors.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const validate = (schema) => (req, _res, next) => {
  const result = schema.safeParse(req.body);
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

router.post('/register', validate(registerSchema), asyncHandler(register));
router.post('/login', validate(loginSchema), asyncHandler(login));
router.post('/refresh', validate(refreshSchema), asyncHandler(refresh));
router.post('/logout', asyncHandler(logout));

export default router;
