const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { query } = require('../config/db');
const JWT_SECRET = require('../config/jwt-secret');
const { error } = require('../utils/response');

async function authenticateToken(req, res, next) {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return error(res, 'Access token is required. Please log in.', 401);
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return error(res, 'Invalid or expired session. Please log in again.', 401);
    }

    // Check if token has been revoked on server (e.g. via logout or password change)
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    try {
      const revokedRows = await query(
        'SELECT 1 FROM revoked_tokens WHERE token_hash = ? AND expires_at > NOW() LIMIT 1',
        [tokenHash]
      );
      if (revokedRows && revokedRows.length > 0) {
        return error(res, 'Session has been logged out or revoked. Please log in again.', 401);
      }
    } catch (dbErr) {
      // If table doesn't exist yet during initial migrations, continue gracefully
      if (dbErr.code !== 'ER_NO_SUCH_TABLE') {
        throw dbErr;
      }
    }

    // Fetch live user status and details from database
    const rows = await query('SELECT id, name, email, role, phone, status FROM users WHERE id = ?', [decoded.id]);
    if (!rows || rows.length === 0) {
      return error(res, 'User account no longer exists.', 401);
    }

    const user = rows[0];
    if (user.status !== 'active') {
      return error(res, 'This user account has been deactivated. Please contact your administrator.', 403);
    }

    // Fetch user role permissions
    const permRows = await query('SELECT permission FROM role_permissions WHERE role = ?', [user.role]);
    user.permissions = permRows.map(r => r.permission);

    req.user = user;
    req.token = token;
    req.tokenHash = tokenHash;
    req.tokenExp = decoded.exp ? new Date(decoded.exp * 1000) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    next();
  } catch (err) {
    console.error('Auth Middleware Error:', err);
    return error(res, 'Internal authentication error', 500);
  }
}

module.exports = {
  authenticateToken
};
