import mongoose from 'mongoose';
import { logger } from '../config/logger.js';
import { ApiError } from '../utils/api-error.js';

export function notFoundHandler(req, _res, next) {
  next(new ApiError(404, 'NOT_FOUND', `No route for ${req.method} ${req.path}`));
}

/** Turns any thrown error into the standard JSON error response. Must be the last middleware. */
// Express recognises error handlers by their four parameters.
export function errorHandler(err, req, res, _next) {
  let error = err;
  if (err instanceof mongoose.Error.ValidationError) {
    const fields = Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v.message]));
    error = new ApiError(400, 'VALIDATION_ERROR', 'Please check the highlighted fields.', { fields });
  } else if (err instanceof mongoose.Error.CastError) {
    error = new ApiError(400, 'BAD_REQUEST', `Invalid value for ${err.path}.`);
  } else if (err?.code === 11000) {
    error = new ApiError(409, 'DUPLICATE', 'This already exists.', { keys: Object.keys(err.keyValue ?? {}) });
  } else if (err?.type === 'entity.too.large') {
    error = new ApiError(413, 'TOO_LARGE', 'The request is too large.');
  } else if (err?.type === 'entity.parse.failed') {
    error = new ApiError(400, 'BAD_JSON', 'The request body is not valid JSON.');
  }
  if (!(error instanceof ApiError)) {
    logger.error({ err, path: req.path }, 'Unhandled error');
    error = new ApiError(500, 'SERVER_ERROR', 'Something went wrong. Please try again.');
  }
  res.status(error.status).json({
    error: {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    },
  });
}
