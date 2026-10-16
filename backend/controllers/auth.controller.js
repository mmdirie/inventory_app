const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../config/db');
const JWT_SECRET = require('../config/jwt-secret');
const { success, error } = require('../utils/response');
const { logAction } = require('../utils/logger');
const { validateRequired, isValidEmail, isValidPassword } = require('../validators/input.validator');
const { recordFailedLogin, recordSuccessfulLogin } = require('../middleware/rate-limit.middleware');

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

/**
 * POST /api/auth/login
 */
async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    const missing = validateRequired(req.body, ['email', 'password']);
    if (missing.length > 0) {
      return error(res, `Missing required fields: ${missing.join(', ')}`, 400);
    }

    if (!isValidEmail(email)) {
      recordFailedLogin(req);
      return error(res, 'Invalid email or password', 401);
    }

    const rows = await query('SELECT * FROM users WHERE email = ?', [email.trim().toLowerCase()]);
    if (!rows || rows.length === 0) {
      recordFailedLogin(req);
      return error(res, 'Invalid email or password', 401);
    }

    const user = rows[0];
    if (user.status !== 'active') {
      recordFailedLogin(req);
      return error(res, 'Account is inactive. Please contact your system administrator.', 403);
    }

    const match = await bcrypt.compare(String(password), user.password_hash);
    if (!match) {
      recordFailedLogin(req);
      return error(res, 'Invalid email or password', 401);
    }

    // Login successful - reset rate limit counter
    recordSuccessfulLogin(req);

    // Update last login
    await query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);

    // Fetch user permissions
    const permRows = await query('SELECT permission FROM role_permissions WHERE role = ?', [user.role]);
    const permissions = permRows.map(r => r.permission);

    // Generate JWT
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    // Audit log
    await logAction({
      userId: user.id,
      userName: user.name,
      action: 'User Login',
      module: 'Auth',
      details: `User ${user.email} (${user.role}) logged in successfully.`,
      ip: req.ip
    });

    return success(res, {
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
        status: user.status,
        permissions
      }
    }, 'Login successful');
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/auth/logout
 * Server-side token revocation
 */
async function logout(req, res, next) {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      let expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      try {
        const decoded = jwt.decode(token);
        if (decoded && decoded.exp) {
          expiresAt = new Date(decoded.exp * 1000);
        }
      } catch (e) {}

      try {
        await query(
          'INSERT INTO revoked_tokens (token_hash, expires_at) VALUES (?, ?) ON DUPLICATE KEY UPDATE expires_at = VALUES(expires_at)',
          [tokenHash, expiresAt]
        );
      } catch (dbErr) {
        if (dbErr.code !== 'ER_NO_SUCH_TABLE') {
          console.error('Error inserting revoked token:', dbErr);
        }
      }
    }

    if (req.user) {
      await logAction({
        userId: req.user.id,
        userName: req.user.name,
        action: 'User Logout',
        module: 'Auth',
        details: `User ${req.user.email} logged out.`,
        ip: req.ip
      });
    }

    return success(res, null, 'Logged out successfully');
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/auth/me
 */
async function getProfile(req, res, next) {
  try {
    return success(res, {
      user: req.user
    }, 'Current user profile');
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/auth/profile
 */
async function updateProfile(req, res, next) {
  try {
    const { name, phone } = req.body;
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return error(res, 'Name cannot be empty', 400);
    }

    const safeName = name.trim();
    const safePhone = phone ? String(phone).trim() : null;

    await query('UPDATE users SET name = ?, phone = ? WHERE id = ?', [safeName, safePhone, req.user.id]);

    await logAction({
      userId: req.user.id,
      userName: safeName,
      action: 'Profile Updated',
      module: 'Auth',
      details: `User profile updated. Name: ${safeName}`,
      ip: req.ip
    });

    const updated = await query('SELECT id, name, email, role, phone, status FROM users WHERE id = ?', [req.user.id]);
    return success(res, { user: updated[0] }, 'Profile updated successfully');
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/auth/change-password
 */
async function changePassword(req, res, next) {
  try {
    const { current_password, new_password } = req.body;
    const missing = validateRequired(req.body, ['current_password', 'new_password']);
    if (missing.length > 0) {
      return error(res, `Missing fields: ${missing.join(', ')}`, 400);
    }

    if (!isValidPassword(new_password)) {
      return error(res, 'New password must be at least 8 characters long and contain both letters and numbers', 400);
    }

    const rows = await query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
    if (!rows || rows.length === 0) {
      return error(res, 'User not found', 404);
    }

    const match = await bcrypt.compare(String(current_password), rows[0].password_hash);
    if (!match) {
      return error(res, 'Current password is incorrect', 400);
    }

    const newHash = await bcrypt.hash(String(new_password), 10);
    await query('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, req.user.id]);

    // Invalidate current token so old session is revoked
    if (req.tokenHash && req.tokenExp) {
      try {
        await query(
          'INSERT INTO revoked_tokens (token_hash, expires_at) VALUES (?, ?) ON DUPLICATE KEY UPDATE expires_at = VALUES(expires_at)',
          [req.tokenHash, req.tokenExp]
        );
      } catch (dbErr) {
        if (dbErr.code !== 'ER_NO_SUCH_TABLE') {
          console.error('Error recording revoked token:', dbErr);
        }
      }
    }

    await logAction({
      userId: req.user.id,
      userName: req.user.name,
      action: 'Password Changed',
      module: 'Auth',
      details: 'User password was successfully updated and current session invalidated.',
      ip: req.ip
    });

    return success(res, null, 'Password changed successfully. Please log in with your new password.');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  login,
  logout,
  getProfile,
  updateProfile,
  changePassword
};
