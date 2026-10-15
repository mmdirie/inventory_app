const bcrypt = require('bcryptjs');
const { query } = require('../config/db');
const { success, error } = require('../utils/response');
const { logAction } = require('../utils/logger');
const { validateRequired, isValidEmail, isValidPassword, validateId, parsePagination } = require('../validators/input.validator');

/**
 * GET /api/users
 */
async function getAllUsers(req, res, next) {
  try {
    const { role, status, search } = req.query;
    let sql = 'SELECT id, name, email, role, phone, status, last_login, created_at, updated_at FROM users';
    const params = [];
    const where = [];

    if (search && search.trim() !== '') {
      where.push('(name LIKE ? OR email LIKE ? OR phone LIKE ?)');
      params.push(`%${search.trim()}%`, `%${search.trim()}%`, `%${search.trim()}%`);
    }

    if (role) {
      where.push('role = ?');
      params.push(role);
    }

    if (status) {
      where.push('status = ?');
      params.push(status);
    }

    if (where.length > 0) {
      sql += ` WHERE ${where.join(' AND ')}`;
    }

    sql += ' ORDER BY id ASC';

    const users = await query(sql, params);
    return success(res, users, 'Users fetched successfully');
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/users/:id
 */
async function getUserById(req, res, next) {
  try {
    const id = validateId(req.params.id);
    if (!id) {
      return error(res, 'Valid user ID is required', 400);
    }
    const rows = await query('SELECT id, name, email, role, phone, status, last_login, created_at, updated_at FROM users WHERE id = ?', [id]);
    if (!rows || rows.length === 0) {
      return error(res, 'User not found', 404);
    }

    const user = rows[0];
    const permRows = await query('SELECT permission FROM role_permissions WHERE role = ?', [user.role]);
    user.permissions = permRows.map(r => r.permission);

    return success(res, user, 'User details');
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/users
 */
async function createUser(req, res, next) {
  try {
    const { name, email, password, role = 'Sales', phone, status = 'active' } = req.body;
    const missing = validateRequired(req.body, ['name', 'email', 'password']);
    if (missing.length > 0) {
      return error(res, `Missing required fields: ${missing.join(', ')}`, 400);
    }

    if (!isValidEmail(email)) {
      return error(res, 'Invalid email address', 400);
    }

    if (!isValidPassword(password)) {
      return error(res, 'Password must be at least 8 characters long and contain both letters and numbers', 400);
    }

    const validRoles = ['Admin', 'Manager', 'Sales', 'Inventory', 'Accountant'];
    if (!validRoles.includes(role)) {
      return error(res, `Invalid role. Allowed roles: ${validRoles.join(', ')}`, 400);
    }

    const existing = await query('SELECT id FROM users WHERE email = ?', [email.trim().toLowerCase()]);
    if (existing.length > 0) {
      return error(res, 'A user with this email already exists', 409);
    }

    const hash = await bcrypt.hash(password, 10);
    const result = await query(`
      INSERT INTO users (name, email, password_hash, role, phone, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      name.trim(),
      email.trim().toLowerCase(),
      hash,
      role,
      phone || null,
      status
    ]);

    await logAction({
      userId: req.user ? req.user.id : null,
      userName: req.user ? req.user.name : 'System',
      action: 'Create User',
      module: 'Users',
      details: `Created user ${email} with role ${role}.`,
      ip: req.ip
    });

    const [created] = await query('SELECT id, name, email, role, phone, status, created_at FROM users WHERE id = ?', [result.insertId]);
    return success(res, created, 'User created successfully', 201);
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/users/:id
 */
async function updateUser(req, res, next) {
  try {
    const id = validateId(req.params.id);
    if (!id) {
      return error(res, 'Valid user ID is required', 400);
    }
    const { name, email, role, phone, status, new_password } = req.body;

    const existing = await query('SELECT * FROM users WHERE id = ?', [id]);
    if (!existing || existing.length === 0) {
      return error(res, 'User not found', 404);
    }

    if (email && email.trim().toLowerCase() !== existing[0].email) {
      if (!isValidEmail(email)) {
        return error(res, 'Invalid email address', 400);
      }
      const dup = await query('SELECT id FROM users WHERE email = ? AND id != ?', [email.trim().toLowerCase(), id]);
      if (dup.length > 0) {
        return error(res, 'Email is already used by another account', 409);
      }
    }

    let passwordHash = existing[0].password_hash;
    if (new_password && new_password.trim() !== '') {
      if (!isValidPassword(new_password)) {
        return error(res, 'Password must be at least 8 characters long and contain both letters and numbers', 400);
      }
      passwordHash = await bcrypt.hash(new_password, 10);
    }

    await query(`
      UPDATE users SET
        name = COALESCE(?, name),
        email = COALESCE(?, email),
        role = COALESCE(?, role),
        phone = ?,
        status = COALESCE(?, status),
        password_hash = ?
      WHERE id = ?
    `, [
      name ? name.trim() : null,
      email ? email.trim().toLowerCase() : null,
      role || null,
      phone !== undefined ? phone : existing[0].phone,
      status || null,
      passwordHash,
      id
    ]);

    await logAction({
      userId: req.user ? req.user.id : null,
      userName: req.user ? req.user.name : 'System',
      action: 'Update User',
      module: 'Users',
      details: `Updated user ID ${id} (${email || existing[0].email}).`,
      ip: req.ip
    });

    const [updated] = await query('SELECT id, name, email, role, phone, status, updated_at FROM users WHERE id = ?', [id]);
    return success(res, updated, 'User updated successfully');
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/users/:id/status
 */
async function toggleUserStatus(req, res, next) {
  try {
    const id = validateId(req.params.id);
    if (!id) {
      return error(res, 'Valid user ID is required', 400);
    }
    const { status } = req.body;

    if (status !== 'active' && status !== 'inactive') {
      return error(res, 'Status must be active or inactive', 400);
    }

    if (req.user && req.user.id == id && status === 'inactive') {
      return error(res, 'You cannot deactivate your own administrative account', 400);
    }

    await query('UPDATE users SET status = ? WHERE id = ?', [status, id]);

    await logAction({
      userId: req.user ? req.user.id : null,
      userName: req.user ? req.user.name : 'System',
      action: 'Toggle User Status',
      module: 'Users',
      details: `User ID ${id} status set to ${status}.`,
      ip: req.ip
    });

    return success(res, { id, status }, `User status updated to ${status}`);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/users/audit-logs
 */
async function getAuditLogs(req, res, next) {
  try {
    const { module, user_id } = req.query;
    const { page, limit, offset } = parsePagination(req.query, 50, 100);
    const params = [];
    const where = [];

    if (module) {
      where.push('module = ?');
      params.push(module);
    }

    if (user_id) {
      where.push('user_id = ?');
      params.push(user_id);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const [countRow] = await query(`SELECT COUNT(*) as total FROM audit_logs ${whereClause}`, params);
    const total = countRow.total;

    const logs = await query(`
      SELECT * FROM audit_logs 
      ${whereClause} 
      ORDER BY id DESC 
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    return success(res, {
      logs,
      pagination: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit)
      }
    }, 'Audit logs fetched');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  toggleUserStatus,
  getAuditLogs
};
