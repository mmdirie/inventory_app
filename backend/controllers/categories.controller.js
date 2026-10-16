const { query } = require('../config/db');
const { success, error } = require('../utils/response');
const { logAction } = require('../utils/logger');
const { validateRequired, validateId } = require('../validators/input.validator');

async function getAllCategories(req, res, next) {
  try {
    const { search, status } = req.query;
    let sql = `
      SELECT c.*, COUNT(p.id) as product_count
      FROM categories c
      LEFT JOIN products p ON c.id = p.category_id AND p.status = 'active'
    `;
    const params = [];
    const where = [];

    if (search && typeof search === 'string' && search.trim() !== '') {
      where.push('(c.name LIKE ? OR c.description LIKE ?)');
      params.push(`%${search.trim()}%`, `%${search.trim()}%`);
    }

    if (status) {
      if (status !== 'active' && status !== 'inactive') {
        return error(res, 'Invalid status parameter', 400);
      }
      where.push('c.status = ?');
      params.push(status);
    }

    if (where.length > 0) {
      sql += ` WHERE ${where.join(' AND ')}`;
    }

    sql += ' GROUP BY c.id ORDER BY c.name ASC';

    const categories = await query(sql, params);
    return success(res, categories, 'Categories fetched successfully');
  } catch (err) {
    next(err);
  }
}

async function getCategoryById(req, res, next) {
  try {
    const id = validateId(req.params.id, 'category ID');
    const rows = await query('SELECT * FROM categories WHERE id = ?', [id]);
    if (!rows || rows.length === 0) {
      return error(res, 'Category not found', 404);
    }
    return success(res, rows[0], 'Category details');
  } catch (err) {
    next(err);
  }
}

async function createCategory(req, res, next) {
  try {
    const { name, description, status = 'active' } = req.body;
    const missing = validateRequired(req.body, ['name']);
    if (missing.length > 0) {
      return error(res, 'Category name is required', 400);
    }

    const safeName = name.trim();
    if (safeName.length === 0) {
      return error(res, 'Category name cannot be empty', 400);
    }

    const existing = await query('SELECT id FROM categories WHERE name = ?', [safeName]);
    if (existing.length > 0) {
      return error(res, `Category '${safeName}' already exists`, 409);
    }

    const result = await query(
      'INSERT INTO categories (name, description, status) VALUES (?, ?, ?)',
      [safeName, description ? String(description).trim() : null, status === 'inactive' ? 'inactive' : 'active']
    );

    await logAction({
      userId: req.user ? req.user.id : null,
      userName: req.user ? req.user.name : 'System',
      action: 'Create Category',
      module: 'Categories',
      details: `Created category: ${safeName}`,
      ip: req.ip
    });

    const created = await query('SELECT * FROM categories WHERE id = ?', [result.insertId]);
    return success(res, created[0], 'Category created successfully', 201);
  } catch (err) {
    next(err);
  }
}

async function updateCategory(req, res, next) {
  try {
    const id = validateId(req.params.id, 'category ID');
    const { name, description, status } = req.body;

    const existing = await query('SELECT * FROM categories WHERE id = ?', [id]);
    if (!existing || existing.length === 0) {
      return error(res, 'Category not found', 404);
    }

    if (name && typeof name === 'string' && name.trim() !== existing[0].name) {
      const safeName = name.trim();
      const dup = await query('SELECT id FROM categories WHERE name = ? AND id != ?', [safeName, id]);
      if (dup.length > 0) {
        return error(res, `Category name '${safeName}' is already in use`, 409);
      }
    }

    await query(`
      UPDATE categories SET
        name = COALESCE(?, name),
        description = ?,
        status = COALESCE(?, status)
      WHERE id = ?
    `, [
      name && typeof name === 'string' ? name.trim() : null,
      description !== undefined ? (description ? String(description).trim() : null) : existing[0].description,
      status ? (status === 'inactive' ? 'inactive' : 'active') : null,
      id
    ]);

    await logAction({
      userId: req.user ? req.user.id : null,
      userName: req.user ? req.user.name : 'System',
      action: 'Update Category',
      module: 'Categories',
      details: `Updated category ID ${id}`,
      ip: req.ip
    });

    const updated = await query('SELECT * FROM categories WHERE id = ?', [id]);
    return success(res, updated[0], 'Category updated successfully');
  } catch (err) {
    next(err);
  }
}

async function deleteCategory(req, res, next) {
  try {
    const id = validateId(req.params.id, 'category ID');
    const [pRef] = await query('SELECT COUNT(*) as count FROM products WHERE category_id = ?', [id]);
    if (pRef && pRef.count > 0) {
      return error(res, `Cannot delete category. There are ${pRef.count} products assigned to it.`, 400);
    }

    await query('DELETE FROM categories WHERE id = ?', [id]);
    await logAction({
      userId: req.user ? req.user.id : null,
      userName: req.user ? req.user.name : 'System',
      action: 'Delete Category',
      module: 'Categories',
      details: `Deleted category ID ${id}`,
      ip: req.ip
    });

    return success(res, null, 'Category deleted successfully');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getAllCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory
};
