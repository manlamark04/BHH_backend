/**
 * Standard API Response Envelope & Error Classes
 * Provides uniform structure across all controllers and services.
 */

class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_SERVER_ERROR', details = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

class BadRequestError extends AppError {
  constructor(message = 'Bad request', details = null) {
    super(message, 400, 'BAD_REQUEST', details);
  }
}

class ValidationError extends BadRequestError {
  constructor(message = 'Validation failed', details = null) {
    super(message, details);
    this.code = 'VALIDATION_ERROR';
  }
}

class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Insufficient permissions') {
    super(message, 403, 'FORBIDDEN');
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404, 'NOT_FOUND');
  }
}

class ConflictError extends AppError {
  constructor(message = 'Resource conflict', details = null) {
    super(message, 409, 'CONFLICT', details);
  }
}

class InternalServerError extends AppError {
  constructor(message = 'Internal server error') {
    super(message, 500, 'INTERNAL_SERVER_ERROR');
  }
}

/**
 * Wraps async route handlers/controllers to forward rejected promises to next(err).
 * Express 5 handles rejections natively, but asyncHandler standardizes stacks and middleware pipelines.
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Standard successful response helper.
 * Compatible with existing frontend expectations while introducing standardized structure.
 */
function sendSuccess(res, payload = null, message = null, statusCode = 200, meta = null) {
  // If payload is an array, return it directly to maintain frontend array-contract compatibility
  if (Array.isArray(payload)) {
    return res.status(statusCode).json(payload);
  }

  // If payload is an object, merge properties and ensure top-level success and message
  if (typeof payload === 'object' && payload !== null) {
    return res.status(statusCode).json({
      success: true,
      message: message || payload.message || 'Operation successful.',
      ...payload,
      ...(meta ? { meta } : {})
    });
  }

  // Primitive or null payload
  return res.status(statusCode).json({
    success: true,
    message: message || (typeof payload === 'string' ? payload : 'Operation successful.'),
    ...(payload !== null && typeof payload !== 'string' ? { data: payload } : {}),
    ...(meta ? { meta } : {})
  });
}

/**
 * Explicit envelope response helper for new or strictly enveloped endpoints.
 */
function sendEnvelope(res, data = null, message = 'Success', statusCode = 200, meta = null) {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
    ...(meta ? { meta } : {})
  });
}

/**
 * Standard error response helper.
 */
function sendError(res, message = 'An error occurred', statusCode = 400, code = 'ERROR', details = null) {
  return res.status(statusCode).json({
    success: false,
    message,
    error: {
      code,
      message,
      ...(details ? { details } : {})
    }
  });
}

module.exports = {
  AppError,
  BadRequestError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  InternalServerError,
  asyncHandler,
  sendSuccess,
  sendEnvelope,
  sendError,
};
