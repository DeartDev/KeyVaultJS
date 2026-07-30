import { verifyAccessToken } from '../utils/jwt.js';
import { unauthorized } from '../utils/httpErrors.js';

export const requireAuth = (req, _res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(unauthorized('missing_bearer', 'Missing bearer token'));
  }

  try {
    const payload = verifyAccessToken(token);
    if (payload.type !== 'access') {
      return next(unauthorized('invalid_token', 'Invalid token type'));
    }
    req.user = { id: payload.sub, email: payload.email };
    return next();
  } catch {
    return next(unauthorized('invalid_token', 'Invalid or expired token'));
  }
};
