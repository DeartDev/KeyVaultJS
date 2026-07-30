export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message = 'Bad request', details) =>
  new HttpError(400, 'bad_request', message, details);

export const unauthorized = (code = 'unauthorized', message = 'Unauthorized') =>
  new HttpError(401, code, message);

export const forbidden = (message = 'Forbidden') =>
  new HttpError(403, 'forbidden', message);

export const notFound = (message = 'Not found') =>
  new HttpError(404, 'not_found', message);

export const conflict = (code = 'conflict', message = 'Conflict', details) =>
  new HttpError(409, code, message, details);

export const payloadTooLarge = (message = 'Payload too large') =>
  new HttpError(413, 'payload_too_large', message);

export const validationError = (details, message = 'Validation failed') =>
  new HttpError(422, 'validation_error', message, details);

export const internalError = (message = 'Internal server error') =>
  new HttpError(500, 'internal_error', message);
