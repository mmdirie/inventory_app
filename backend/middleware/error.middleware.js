const { error } = require('../utils/response');

function errorHandler(err, req, res, next) {
  console.error('Unhandled Application Error:', err);

  // Handle specific MySQL Errors
  if (err.code === 'ER_DUP_ENTRY') {
    return error(res, 'A record with this identifier already exists (duplicate entry).', 409, err.message);
  }

  if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.code === 'ER_NO_REFERENCED_ROW_2') {
    return error(res, 'Cannot complete operation due to existing related records (Foreign Key Constraint).', 400, err.message);
  }

  return error(
    res,
    err.message || 'An unexpected server error occurred',
    err.status || 500,
    process.env.NODE_ENV === 'development' ? err.stack : null
  );
}

module.exports = {
  errorHandler
};
