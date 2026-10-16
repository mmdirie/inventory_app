const { query } = require('../config/db');
const { success, error } = require('../utils/response');
const { logAction } = require('../utils/logger');
const { validateRequired, validateId } = require('../validators/input.validator');

async function getAllSuppliers(req, res, next) {
  try {
    const { search, status } = req.query;
    let sql = `
      SELECT s.*, 
        COUNT(DISTINCT p.id) as total_purchases_count,
        COALESCE(SUM(p.total), 0) as total_purchased_amount
      FROM suppliers s
      LEFT JOIN purchases p ON s.id = p.supplier_id
    `;
    const params = [];
    const where = [];

    if (search && search.trim() !== '') {
      where.push('(s.name LIKE ? OR s.company LIKE ? OR s.phone LIKE ? OR s.email LIKE ?)');
      params.push(`%${search.trim()}%`, `%${search.trim()}%`, `%${search.trim()}%`, `%${search.trim()}%`);
    }

    if (status) {
      where.push('s.status = ?');
      params.push(status);
    }

    if (where.length > 0) {
      sql += ` WHERE ${where.join(' AND ')}`;
    }

    sql += ' GROUP BY s.id ORDER BY s.name ASC';

    const suppliers = await query(sql, params);
    return success(res, suppliers, 'Suppliers fetched successfully');
  } catch (err) {
    next(err);
  }
}

async function getSupplierById(req, res, next) {
  try {
    const id = validateId(req.params.id);
    if (!id) {
      return error(res, 'Valid supplier ID is required', 400);
    }
    const rows = await query('SELECT * FROM suppliers WHERE id = ?', [id]);
    if (!rows || rows.length === 0) {
      return error(res, 'Supplier not found', 404);
    }

    const supplier = rows[0];

    // Purchases
    const purchases = await query(`
      SELECT p.*, w.name as warehouse_name
      FROM purchases p
      LEFT JOIN warehouses w ON p.warehouse_id = w.id
      WHERE p.supplier_id = ?
      ORDER BY p.id DESC
      LIMIT 20
    `, [id]);
    supplier.purchases = purchases;

    // Payments
    const payments = await query(`
      SELECT * FROM payments 
      WHERE party_type = 'Supplier' AND party_id = ?
      ORDER BY id DESC
      LIMIT 20
    `, [id]);
    supplier.payments = payments;

    // Debts
    const debts = await query(`
      SELECT * FROM debts 
      WHERE debt_type = 'Supplier' AND party_id = ?
      ORDER BY id DESC
    `, [id]);
    supplier.debts = debts;

    return success(res, supplier, 'Supplier details');
  } catch (err) {
    next(err);
  }
}

async function createSupplier(req, res, next) {
  try {
    const { name, company, phone, email, address, city, country, tax_number, notes, status = 'active' } = req.body;
    const missing = validateRequired(req.body, ['name']);
    if (missing.length > 0) {
      return error(res, 'Supplier name is required', 400);
    }

    const result = await query(`
      INSERT INTO suppliers (name, company, phone, email, address, city, country, tax_number, balance, notes, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0.00, ?, ?)
    `, [
      name.trim(),
      company || null,
      phone || null,
      email || null,
      address || null,
      city || null,
      country || null,
      tax_number || null,
      notes || null,
      status
    ]);

    await logAction({
      userId: req.user ? req.user.id : null,
      userName: req.user ? req.user.name : 'System',
      action: 'Create Supplier',
      module: 'Suppliers',
      details: `Created supplier: ${name.trim()} (${company || ''})`,
      ip: req.ip
    });

    const created = await query('SELECT * FROM suppliers WHERE id = ?', [result.insertId]);
    return success(res, created[0], 'Supplier created successfully', 201);
  } catch (err) {
    next(err);
  }
}

async function updateSupplier(req, res, next) {
  try {
    const id = validateId(req.params.id);
    if (!id) {
      return error(res, 'Valid supplier ID is required', 400);
    }
    const { name, company, phone, email, address, city, country, tax_number, notes, status } = req.body;

    const existing = await query('SELECT * FROM suppliers WHERE id = ?', [id]);
    if (!existing || existing.length === 0) {
      return error(res, 'Supplier not found', 404);
    }

    await query(`
      UPDATE suppliers SET
        name = COALESCE(?, name),
        company = ?,
        phone = ?,
        email = ?,
        address = ?,
        city = ?,
        country = ?,
        tax_number = ?,
        notes = ?,
        status = COALESCE(?, status)
      WHERE id = ?
    `, [
      name ? name.trim() : null,
      company !== undefined ? company : existing[0].company,
      phone !== undefined ? phone : existing[0].phone,
      email !== undefined ? email : existing[0].email,
      address !== undefined ? address : existing[0].address,
      city !== undefined ? city : existing[0].city,
      country !== undefined ? country : existing[0].country,
      tax_number !== undefined ? tax_number : existing[0].tax_number,
      notes !== undefined ? notes : existing[0].notes,
      status || null,
      id
    ]);

    await logAction({
      userId: req.user ? req.user.id : null,
      userName: req.user ? req.user.name : 'System',
      action: 'Update Supplier',
      module: 'Suppliers',
      details: `Updated supplier ID ${id}`,
      ip: req.ip
    });

    const updated = await query('SELECT * FROM suppliers WHERE id = ?', [id]);
    return success(res, updated[0], 'Supplier updated successfully');
  } catch (err) {
    next(err);
  }
}

async function deleteSupplier(req, res, next) {
  try {
    const id = validateId(req.params.id);
    if (!id) {
      return error(res, 'Valid supplier ID is required', 400);
    }
    const [pRef] = await query('SELECT COUNT(*) as count FROM purchases WHERE supplier_id = ?', [id]);
    if (pRef.count > 0) {
      await query('UPDATE suppliers SET status = "inactive" WHERE id = ?', [id]);
      return success(res, { deactivated: true }, 'Supplier has recorded purchases and was deactivated');
    }

    await query('DELETE FROM suppliers WHERE id = ?', [id]);
    return success(res, null, 'Supplier deleted successfully');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getAllSuppliers,
  getSupplierById,
  createSupplier,
  updateSupplier,
  deleteSupplier
};
