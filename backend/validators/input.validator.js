/**
 * Helper input validation utilities
 */
function validateRequired(obj, fields) {
  const missing = [];
  for (const field of fields) {
    if (obj[field] === undefined || obj[field] === null || String(obj[field]).trim() === '') {
      missing.push(field);
    }
  }
  return missing;
}

function isValidEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(String(email).toLowerCase());
}

function isPositiveNumber(num) {
  const n = Number(num);
  return !isNaN(n) && n >= 0;
}

module.exports = {
  validateRequired,
  isValidEmail,
  isPositiveNumber
};
