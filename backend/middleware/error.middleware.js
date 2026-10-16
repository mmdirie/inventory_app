const { error } = require('../utils/response');

function errorHandler(err, req, res, next) {
  // Always log full diagnostic information securely on the server
  console.error('[SERVER ERROR]', {
    message: err.message,
    code: err.code,
    status: err.status || 500,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip
  });

  const isProduction = process.env.NODE_ENV === 'production';

  // Handle specific MySQL Database Errors
  if (err.code === 'ER_DUP_ENTRY') {
    return error(
      res,
      'A record with this identifier already exists (duplicate entry).',
      409,
      isProduction ? null : err.message
    );
  }

  if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.code === 'ER_NO_REFERENCED_ROW_2') {
    return error(
      res,
      'Cannot complete operation due to existing related records (Foreign Key Constraint).',
      400,
      isProduction ? null : err.message
    );
  }

  // Explicit client/validation errors with status 4xx
  if (err.status && err.status >= 400 && err.status < 500) {
    return error(res, err.message, err.status);
  }

  // 5xx Server Errors
  const clientMessage = isProduction
    ? 'An unexpected server error occurred. Please contact the administrator.'
    : (err.message || 'An unexpected server error occurred.');

  return error(
    res,
    clientMessage,
    err.status || 500,
    isProduction ? null : err.stack
  );
}

module.exports = {
  errorHandler
};
