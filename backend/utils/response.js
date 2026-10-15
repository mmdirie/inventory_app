/**
 * Standardized API Response format
 */
function success(res, data = null, message = 'Success', statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    message,
    data
  });
}

function error(res, message = 'An unexpected error occurred', statusCode = 500, errorDetails = null) {
  const response = {
    success: false,
    message
  };

  if (errorDetails && process.env.NODE_ENV !== 'production') {
    response.error = errorDetails;
  }

  return res.status(statusCode).json(response);
}

module.exports = {
  success,
  error
};
