/**
 * In-memory Login Rate Limiter and Brute-force Protection Middleware
 */

const loginAttempts = new Map();

// Configuration
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_FAILED_ATTEMPTS = 5;

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of loginAttempts.entries()) {
    if (now - data.firstAttempt > WINDOW_MS) {
      loginAttempts.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();

function getClientKey(req) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const email = (req.body && typeof req.body.email === 'string') ? req.body.email.trim().toLowerCase() : '';
  return `${ip}_${email}`;
}

function loginRateLimiter(req, res, next) {
  const key = getClientKey(req);
  const now = Date.now();
  const record = loginAttempts.get(key);

  if (record) {
    if (now - record.firstAttempt < WINDOW_MS) {
      if (record.count >= MAX_FAILED_ATTEMPTS) {
        const retryAfterSeconds = Math.ceil((record.firstAttempt + WINDOW_MS - now) / 1000);
        res.setHeader('Retry-After', retryAfterSeconds);
        return res.status(429).json({
          success: false,
          message: `Too many failed login attempts. Please try again in ${Math.ceil(retryAfterSeconds / 60)} minutes.`
        });
      }
    } else {
      // Window expired, reset
      loginAttempts.delete(key);
    }
  }

  next();
}

function recordFailedLogin(req) {
  const key = getClientKey(req);
  const now = Date.now();
  const record = loginAttempts.get(key);

  if (!record || (now - record.firstAttempt >= WINDOW_MS)) {
    loginAttempts.set(key, { count: 1, firstAttempt: now });
  } else {
    record.count += 1;
  }
}

function recordSuccessfulLogin(req) {
  const key = getClientKey(req);
  loginAttempts.delete(key);
}

module.exports = {
  loginRateLimiter,
  recordFailedLogin,
  recordSuccessfulLogin
};
