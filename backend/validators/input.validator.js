/**
 * Strict Input Validation and Type Parsing Utilities
 * Enforces server-side integrity and rejects malformed values.
 */

function validateRequired(obj, fields) {
  const missing = [];
  if (!obj || typeof obj !== 'object') {
    return fields;
  }
  for (const field of fields) {
    if (obj[field] === undefined || obj[field] === null || String(obj[field]).trim() === '') {
      missing.push(field);
    }
  }
  return missing;
}

function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  const re = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  return re.test(email.trim().toLowerCase());
}

/**
 * Validates password strength:
 * Minimum 8 characters, at least one letter and at least one number
 */
function isValidPassword(password) {
  if (typeof password !== 'string') return false;
  if (password.length < 8) return false;
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  return hasLetter && hasNumber;
}

/**
 * Strictly parses a numeric value without accepting trailing non-numeric characters.
 * Rejects "12abc", Infinity, NaN, boolean, null, undefined.
 */
function parseStrictNumber(val) {
  if (val === undefined || val === null || val === '') return null;
  if (typeof val === 'number') {
    return Number.isFinite(val) ? val : null;
  }
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  if (!/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(trimmed)) {
    return null;
  }
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : null;
}

/**
 * Strict decimal parser for money and rate values with explicit bounds.
 */
function parseStrictDecimal(val, options = {}) {
  const { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = options;
  const parsed = parseStrictNumber(val);
  if (parsed === null || parsed < min || parsed > max) {
    return null;
  }
  return parsed;
}

/**
 * Checks if a value is a valid non-negative number (>= 0).
 */
function isPositiveNumber(val) {
  const num = parseStrictNumber(val);
  return num !== null && num >= 0;
}

/**
 * Strictly parses an integer (can be negative).
 */
function parseStrictInteger(val) {
  if (val === undefined || val === null || val === '') return null;
  if (typeof val === 'number') {
    return Number.isSafeInteger(val) ? val : null;
  }
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    return null;
  }
  const num = Number(trimmed);
  return Number.isSafeInteger(num) ? num : null;
}

/**
 * Strictly parses a positive integer (> 0).
 */
function parseStrictPositiveInteger(val) {
  const num = parseStrictInteger(val);
  return num !== null && num > 0 ? num : null;
}

/**
 * Validates an ID parameter (from req.params.id).
 * Returns safe integer or throws a 400 error.
 */
function validateId(id, paramName = 'id') {
  const parsed = parseStrictPositiveInteger(id);
  if (parsed === null) {
    const err = new Error(`Invalid ${paramName} parameter. Must be a positive integer.`);
    err.status = 400;
    throw err;
  }
  return parsed;
}

/**
 * Enforces standardized pagination:
 * - page >= 1
 * - 1 <= limit <= maxLimit (default max 100)
 * - Rejects malformed values with HTTP 400
 */
function parsePagination(query, defaultLimit = 20, maxLimit = 100) {
  let page = 1;
  let limit = defaultLimit;

  if (query.page !== undefined && query.page !== null && query.page !== '') {
    const parsedPage = parseStrictPositiveInteger(query.page);
    if (parsedPage === null) {
      const err = new Error('Invalid page parameter. Must be an integer greater than or equal to 1.');
      err.status = 400;
      throw err;
    }
    page = parsedPage;
  }

  if (query.limit !== undefined && query.limit !== null && query.limit !== '') {
    const parsedLimit = parseStrictPositiveInteger(query.limit);
    if (parsedLimit === null) {
      const err = new Error('Invalid limit parameter. Must be an integer greater than or equal to 1.');
      err.status = 400;
      throw err;
    }
    limit = Math.min(parsedLimit, maxLimit);
  }

  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

module.exports = {
  validateRequired,
  isValidEmail,
  isValidPassword,
  parseStrictNumber,
  parseStrictDecimal,
  isPositiveNumber,
  parseStrictInteger,
  parseStrictPositiveInteger,
  validateId,
  parsePagination
};
