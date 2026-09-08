/**
 * Centralized Express Error Handler & 404 Route Handler
 * Normalizes all operational, application, database, and system errors into a standard response format.
 */

const { AppError } = require('../utils/apiResponse');

function errorHandler(err, req, res, next) {
  let statusCode = err.statusCode || err.status || 500;
  let code = err.code || 'INTERNAL_SERVER_ERROR';
  let message = err.message || 'Internal server error.';
  let details = err.details || null;

  // MySQL specific errors
  if (err.code === 'ER_DUP_ENTRY' || err.errno === 1062) {
    statusCode = 409;
    code = 'DUPLICATE_ENTRY';
    message = 'A record with these details already exists.';
  } else if (err.code === 'ER_NO_REFERENCED_ROW_2' || err.errno === 1452) {
    statusCode = 400;
    code = 'FOREIGN_KEY_NOT_FOUND';
    message = 'Referenced resource does not exist.';
  } else if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.errno === 1451) {
    statusCode = 409;
    code = 'RESOURCE_IN_USE';
    message = 'Cannot delete or modify record because it is referenced by other items.';
  } else if (err.code === 'ER_DATA_TOO_LONG' || err.errno === 1406) {
    statusCode = 400;
    code = 'DATA_TOO_LONG';
    message = 'One or more fields exceed the maximum allowable length.';
  } else if (err.code === 'ECONNREFUSED' || err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ETIMEDOUT') {
    statusCode = 503;
    code = 'DATABASE_UNAVAILABLE';
    message = 'Database service is temporarily unavailable. Please try again later.';
  }

  // JWT errors
  if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    code = 'TOKEN_EXPIRED';
    message = 'Session has expired. Please log in again.';
  } else if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    code = 'INVALID_TOKEN';
    message = 'Invalid authentication token.';
  }

  // JSON Body Parse syntax error
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    statusCode = 400;
    code = 'INVALID_JSON';
    message = 'Malformed JSON payload provided.';
  }

  // Hide internal server error details in production unless explicitly marked operational
  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction && statusCode >= 500 && !err.isOperational) {
    message = 'An unexpected server error occurred.';
  }

  // Console logging
  if (statusCode >= 500) {
    console.error(`[ERROR 5xx] [${req.method}] ${req.originalUrl}:`, err);
  } else if (process.env.NODE_ENV !== 'test') {
    console.warn(`[WARN ${statusCode}] [${req.method}] ${req.originalUrl} (${code}):`, message);
  }

  return res.status(statusCode).json({
    success: false,
    message,
    error: {
      code,
      message,
      ...(details ? { details } : {})
    },
    ...(process.env.NODE_ENV === 'development' ? { stack: err.stack } : {})
  });
}

function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found.`,
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: `Route ${req.method} ${req.originalUrl} not found.`
    }
  });
}

module.exports = {
  errorHandler,
  notFoundHandler,
};
