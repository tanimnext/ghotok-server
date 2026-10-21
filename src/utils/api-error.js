/**
 * An error that maps to an HTTP response. Throw it from any layer; the error
 * middleware turns it into `{ error: { code, message, details } }`.
 *
 * `code` is a stable, machine-readable identifier the clients use to show a
 * translated message (see web/src/lib/i18n). `message` is an English fallback.
 */
export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message ?? code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (code = 'BAD_REQUEST', message, details) =>
  new ApiError(400, code, message, details);
export const unauthorized = (code = 'UNAUTHORIZED', message = 'Please log in to continue.') =>
  new ApiError(401, code, message);
export const paymentRequired = (code, message) => new ApiError(402, code, message);
export const forbidden = (code = 'FORBIDDEN', message = 'You do not have permission to do this.', details) =>
  new ApiError(403, code, message, details);
export const notFound = (what = 'Resource') => new ApiError(404, 'NOT_FOUND', `${what} not found.`);
export const conflict = (code = 'CONFLICT', message, details) => new ApiError(409, code, message, details);
export const tooMany = (code = 'RATE_LIMITED', message) => new ApiError(429, code, message);

/** A 400 VALIDATION_ERROR whose details map field names to error codes or messages. */
export const validationError = (fields, message = 'Please check the highlighted fields.') =>
  new ApiError(400, 'VALIDATION_ERROR', message, { fields });
