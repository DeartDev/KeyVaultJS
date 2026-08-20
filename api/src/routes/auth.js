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
  logoutSchema,
} from '../schemas/authSchema.js';
import { authIpLimiter, loginEmailLimiter } from '../middleware/rateLimit.js';
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

// H-04: límite por IP para todo el router de autenticación.
router.use(authIpLimiter);

router.post('/register', validate(registerSchema), asyncHandler(register));
// El límite por email va DESPUÉS de validar: así la clave del limitador es
// siempre un email normalizado (trim + lowercase) y no se puede eludir con
// variaciones de mayúsculas o espacios sobrantes.
router.post('/login', validate(loginSchema), loginEmailLimiter, asyncHandler(login));
router.post('/refresh', validate(refreshSchema), asyncHandler(refresh));
// H-19: logoutSchema estaba definido pero no se aplicaba.
router.post('/logout', validate(logoutSchema), asyncHandler(logout));

export default router;
