const { query } = require('../config/db');
const { success, error } = require('../utils/response');
const { logAction } = require('../utils/logger');
const { validateRequired, validateId } = require('../validators/input.validator');

async function getAllWarehouses(req, res, next) {
  try {
    const { search, status } = req.query;
    let sql = `
      SELECT 
        w.*,
        COUNT(DISTINCT ws.product_id) as total_products,
        COALESCE(SUM(ws.quantity), 0) as total_units
      FROM warehouses w
      LEFT JOIN warehouse_stock ws ON w.id = ws.warehouse_id
    `;
    const params = [];
    const where = [];

    if (search && search.trim() !== '') {
      where.push('(w.name LIKE ? OR w.location LIKE ? OR w.manager LIKE ?)');
      params.push(`%${search.trim()}%`, `%${search.trim()}%`, `%${search.trim()}%`);
    }

    if (status) {
      where.push('w.status = ?');
      params.push(status);
    }

    if (where.length > 0) {
      sql += ` WHERE ${where.join(' AND ')}`;
    }

    sql += ' GROUP BY w.id ORDER BY w.is_default DESC, w.name ASC';

    const warehouses = await query(sql, params);
    return success(res, warehouses, 'Warehouses fetched successfully');
  } catch (err) {
    next(err);
  }
}

async function getWarehouseById(req, res, next) {
  try {
    const id = validateId(req.params.id);
    if (!id) {
      return error(res, 'Valid warehouse ID is required', 400);
    }
    const rows = await query('SELECT * FROM warehouses WHERE id = ?', [id]);
    if (!rows || rows.length === 0) {
      return error(res, 'Warehouse not found', 404);
    }

    const warehouse = rows[0];

    // Fetch products and stock within this warehouse
    const stock = await query(`
      SELECT 
        ws.quantity,
        p.id as product_id,
        p.sku,
        p.barcode,
        p.name as product_name,
        p.unit,
        p.purchase_price,
        p.selling_price,
        c.name as category_name
      FROM warehouse_stock ws
      JOIN products p ON ws.product_id = p.id
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE ws.warehouse_id = ?
      ORDER BY p.name ASC
    `, [id]);

    warehouse.stock = stock;
    return success(res, warehouse, 'Warehouse details');
  } catch (err) {
    next(err);
  }
}

async function createWarehouse(req, res, next) {
  try {
    const { name, location, manager, phone, description, status = 'active', is_default = 0 } = req.body;
    const missing = validateRequired(req.body, ['name', 'location']);
    if (missing.length > 0) {
      return error(res, `Missing required fields: ${missing.join(', ')}`, 400);
    }

    const existing = await query('SELECT id FROM warehouses WHERE name = ?', [name.trim()]);
    if (existing.length > 0) {
      return error(res, `Warehouse '${name}' already exists`, 409);
    }

    if (is_default) {
      await query('UPDATE warehouses SET is_default = 0');
    }

    const result = await query(
      'INSERT INTO warehouses (name, location, manager, phone, description, status, is_default) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [name.trim(), location.trim(), manager || null, phone || null, description || null, status, is_default ? 1 : 0]
    );

    const newId = result.insertId;

    await logAction({
      userId: req.user ? req.user.id : null,
      userName: req.user ? req.user.name : 'System',
      action: 'Create Warehouse',
      module: 'Warehouses',
      details: `Created warehouse: ${name.trim()} (${location.trim()})`,
      ip: req.ip
    });

    const created = await query('SELECT * FROM warehouses WHERE id = ?', [newId]);
    return success(res, created[0], 'Warehouse created successfully', 201);
  } catch (err) {
    next(err);
  }
}

async function updateWarehouse(req, res, next) {
  try {
    const id = validateId(req.params.id);
    if (!id) {
      return error(res, 'Valid warehouse ID is required', 400);
    }
    const { name, location, manager, phone, description, status, is_default } = req.body;

    const existing = await query('SELECT * FROM warehouses WHERE id = ?', [id]);
    if (!existing || existing.length === 0) {
      return error(res, 'Warehouse not found', 404);
    }

    if (name && name.trim() !== existing[0].name) {
      const dup = await query('SELECT id FROM warehouses WHERE name = ? AND id != ?', [name.trim(), id]);
      if (dup.length > 0) {
        return error(res, `Warehouse '${name}' already exists`, 409);
      }
    }

    if (is_default) {
      await query('UPDATE warehouses SET is_default = 0 WHERE id != ?', [id]);
    }

    await query(`
      UPDATE warehouses SET
        name = COALESCE(?, name),
        location = COALESCE(?, location),
        manager = COALESCE(?, manager),
        phone = COALESCE(?, phone),
        description = ?,
        status = COALESCE(?, status),
        is_default = COALESCE(?, is_default)
      WHERE id = ?
    `, [
      name ? name.trim() : null,
      location ? location.trim() : null,
      manager !== undefined ? manager : existing[0].manager,
      phone !== undefined ? phone : existing[0].phone,
      description !== undefined ? description : existing[0].description,
      status || null,
      is_default !== undefined ? (is_default ? 1 : 0) : null,
      id
    ]);

    await logAction({
      userId: req.user ? req.user.id : null,
      userName: req.user ? req.user.name : 'System',
      action: 'Update Warehouse',
      module: 'Warehouses',
      details: `Updated warehouse ID ${id}`,
      ip: req.ip
    });

    const updated = await query('SELECT * FROM warehouses WHERE id = ?', [id]);
    return success(res, updated[0], 'Warehouse updated successfully');
  } catch (err) {
    next(err);
  }
}

async function deleteWarehouse(req, res, next) {
  try {
    const id = validateId(req.params.id);
    if (!id) {
      return error(res, 'Valid warehouse ID is required', 400);
    }
    const [stockRef] = await query('SELECT SUM(quantity) as total FROM warehouse_stock WHERE warehouse_id = ?', [id]);
    if (stockRef.total && stockRef.total > 0) {
      return error(res, `Cannot delete warehouse. It currently holds ${stockRef.total} units of inventory. Transfer stock first.`, 400);
    }

    const [salesRef] = await query('SELECT COUNT(*) as count FROM sales WHERE warehouse_id = ?', [id]);
    const [purchRef] = await query('SELECT COUNT(*) as count FROM purchases WHERE warehouse_id = ?', [id]);

    if (salesRef.count > 0 || purchRef.count > 0) {
      await query('UPDATE warehouses SET status = "inactive" WHERE id = ?', [id]);
      return success(res, { deactivated: true }, 'Warehouse has transaction records and was marked inactive');
    }

    await query('DELETE FROM warehouse_stock WHERE warehouse_id = ?', [id]);
    await query('DELETE FROM warehouses WHERE id = ?', [id]);

    await logAction({
      userId: req.user ? req.user.id : null,
      userName: req.user ? req.user.name : 'System',
      action: 'Delete Warehouse',
      module: 'Warehouses',
      details: `Deleted warehouse ID ${id}`,
      ip: req.ip
    });

    return success(res, null, 'Warehouse deleted successfully');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getAllWarehouses,
  getWarehouseById,
  createWarehouse,
  updateWarehouse,
  deleteWarehouse
};
