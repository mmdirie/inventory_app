const { query } = require('../config/db');
const { success, error } = require('../utils/response');
const { logAction } = require('../utils/logger');
const { validateRequired, validateId } = require('../validators/input.validator');

async function getAllBrands(req, res, next) {
  try {
    const { search, status } = req.query;
    let sql = `
      SELECT b.*, COUNT(p.id) as product_count
      FROM brands b
      LEFT JOIN products p ON b.id = p.brand_id AND p.status = 'active'
    `;
    const params = [];
    const where = [];

    if (search && typeof search === 'string' && search.trim() !== '') {
      where.push('(b.name LIKE ? OR b.description LIKE ?)');
      params.push(`%${search.trim()}%`, `%${search.trim()}%`);
    }

    if (status) {
      if (status !== 'active' && status !== 'inactive') {
        return error(res, 'Invalid status parameter', 400);
      }
      where.push('b.status = ?');
      params.push(status);
    }

    if (where.length > 0) {
      sql += ` WHERE ${where.join(' AND ')}`;
    }

    sql += ' GROUP BY b.id ORDER BY b.name ASC';

    const brands = await query(sql, params);
    return success(res, brands, 'Brands fetched successfully');
  } catch (err) {
    next(err);
  }
}

async function getBrandById(req, res, next) {
  try {
    const id = validateId(req.params.id, 'brand ID');
    const rows = await query('SELECT * FROM brands WHERE id = ?', [id]);
    if (!rows || rows.length === 0) {
      return error(res, 'Brand not found', 404);
    }
    return success(res, rows[0], 'Brand details');
  } catch (err) {
    next(err);
  }
}

async function createBrand(req, res, next) {
  try {
    const { name, description, status = 'active' } = req.body;
    const missing = validateRequired(req.body, ['name']);
    if (missing.length > 0) {
      return error(res, 'Brand name is required', 400);
    }

    const safeName = name.trim();
    if (safeName.length === 0) {
      return error(res, 'Brand name cannot be empty', 400);
    }

    const existing = await query('SELECT id FROM brands WHERE name = ?', [safeName]);
    if (existing.length > 0) {
      return error(res, `Brand '${safeName}' already exists`, 409);
    }

    const result = await query(
      'INSERT INTO brands (name, description, status) VALUES (?, ?, ?)',
      [safeName, description ? String(description).trim() : null, status === 'inactive' ? 'inactive' : 'active']
    );

    await logAction({
      userId: req.user ? req.user.id : null,
      userName: req.user ? req.user.name : 'System',
      action: 'Create Brand',
      module: 'Brands',
      details: `Created brand: ${safeName}`,
      ip: req.ip
    });

    const created = await query('SELECT * FROM brands WHERE id = ?', [result.insertId]);
    return success(res, created[0], 'Brand created successfully', 201);
  } catch (err) {
    next(err);
  }
}

async function updateBrand(req, res, next) {
  try {
    const id = validateId(req.params.id, 'brand ID');
    const { name, description, status } = req.body;

    const existing = await query('SELECT * FROM brands WHERE id = ?', [id]);
    if (!existing || existing.length === 0) {
      return error(res, 'Brand not found', 404);
    }

    if (name && typeof name === 'string' && name.trim() !== existing[0].name) {
      const safeName = name.trim();
      const dup = await query('SELECT id FROM brands WHERE name = ? AND id != ?', [safeName, id]);
      if (dup.length > 0) {
        return error(res, `Brand '${safeName}' already exists`, 409);
      }
    }

    await query(`
      UPDATE brands SET
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
      action: 'Update Brand',
      module: 'Brands',
      details: `Updated brand ID ${id}`,
      ip: req.ip
    });

    const updated = await query('SELECT * FROM brands WHERE id = ?', [id]);
    return success(res, updated[0], 'Brand updated successfully');
  } catch (err) {
    next(err);
  }
}

async function deleteBrand(req, res, next) {
  try {
    const id = validateId(req.params.id, 'brand ID');
    const [pRef] = await query('SELECT COUNT(*) as count FROM products WHERE brand_id = ?', [id]);
    if (pRef && pRef.count > 0) {
      return error(res, `Cannot delete brand. There are ${pRef.count} products assigned to it.`, 400);
    }

    await query('DELETE FROM brands WHERE id = ?', [id]);
    await logAction({
      userId: req.user ? req.user.id : null,
      userName: req.user ? req.user.name : 'System',
      action: 'Delete Brand',
      module: 'Brands',
      details: `Deleted brand ID ${id}`,
      ip: req.ip
    });

    return success(res, null, 'Brand deleted successfully');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getAllBrands,
  getBrandById,
  createBrand,
  updateBrand,
  deleteBrand
};
