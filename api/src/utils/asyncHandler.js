/**
 * Wraps an async route handler so that rejected promises are forwarded
 * to Express' error pipeline via next(err).
 *
 * Express 4 does not catch rejected promises from async handlers by default.
 */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
