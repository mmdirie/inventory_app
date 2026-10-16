const { query } = require('../config/db');
const { success, error } = require('../utils/response');
const { logAction } = require('../utils/logger');
const { validateRequired, validateId, parseStrictNumber } = require('../validators/input.validator');

async function getAllCustomers(req, res, next) {
  try {
    const { search, customer_type, status } = req.query;
    let sql = `
      SELECT c.*, 
        COUNT(DISTINCT s.id) as total_orders_count,
        COALESCE(SUM(s.total), 0) as total_purchased_amount
      FROM customers c
      LEFT JOIN sales s ON c.id = s.customer_id
    `;
    const params = [];
    const where = [];

    if (search && search.trim() !== '') {
      where.push('(c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ? OR c.city LIKE ?)');
      params.push(`%${search.trim()}%`, `%${search.trim()}%`, `%${search.trim()}%`, `%${search.trim()}%`);
    }

    if (customer_type) {
      where.push('c.customer_type = ?');
      params.push(customer_type);
    }

    if (status) {
      where.push('c.status = ?');
      params.push(status);
    }

    if (where.length > 0) {
      sql += ` WHERE ${where.join(' AND ')}`;
    }

    sql += ' GROUP BY c.id ORDER BY c.name ASC';

    const customers = await query(sql, params);
    return success(res, customers, 'Customers fetched successfully');
  } catch (err) {
    next(err);
  }
}

async function getCustomerById(req, res, next) {
  try {
    const id = validateId(req.params.id);
    if (!id) {
      return error(res, 'Valid customer ID is required', 400);
    }
    const rows = await query('SELECT * FROM customers WHERE id = ?', [id]);
    if (!rows || rows.length === 0) {
      return error(res, 'Customer not found', 404);
    }

    const customer = rows[0];

    // Sales
    const sales = await query(`
      SELECT s.*, w.name as warehouse_name
      FROM sales s
      LEFT JOIN warehouses w ON s.warehouse_id = w.id
      WHERE s.customer_id = ?
      ORDER BY s.id DESC
      LIMIT 20
    `, [id]);
    customer.sales = sales;

    // Payments
    const payments = await query(`
      SELECT * FROM payments 
      WHERE party_type = 'Customer' AND party_id = ?
      ORDER BY id DESC
      LIMIT 20
    `, [id]);
    customer.payments = payments;

    // Debts
    const debts = await query(`
      SELECT * FROM debts 
      WHERE debt_type = 'Customer' AND party_id = ?
      ORDER BY id DESC
    `, [id]);
    customer.debts = debts;

    return success(res, customer, 'Customer details');
  } catch (err) {
    next(err);
  }
}

async function createCustomer(req, res, next) {
  try {
    const {
      name,
      phone,
      email,
      address,
      city,
      customer_type = 'Retail',
      credit_limit = 0,
      notes,
      status = 'active'
    } = req.body;

    const missing = validateRequired(req.body, ['name']);
    if (missing.length > 0) {
      return error(res, 'Customer name is required', 400);
    }

    const creditVal = parseStrictNumber(credit_limit, 0);
    if (credit_limit !== undefined && creditVal === null) {
      return error(res, 'Credit limit must be a valid non-negative number', 400);
    }

    const result = await query(`
      INSERT INTO customers (name, phone, email, address, city, customer_type, credit_limit, balance, notes, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0.00, ?, ?)
    `, [
      name.trim(),
      phone || null,
      email || null,
      address || null,
      city || null,
      customer_type,
      creditVal !== null ? creditVal : 0,
      notes || null,
      status
    ]);

    await logAction({
      userId: req.user ? req.user.id : null,
      userName: req.user ? req.user.name : 'System',
      action: 'Create Customer',
      module: 'Customers',
      details: `Created customer: ${name.trim()} (${customer_type})`,
      ip: req.ip
    });

    const created = await query('SELECT * FROM customers WHERE id = ?', [result.insertId]);
    return success(res, created[0], 'Customer created successfully', 201);
  } catch (err) {
    next(err);
  }
}

async function updateCustomer(req, res, next) {
  try {
    const id = validateId(req.params.id);
    if (!id) {
      return error(res, 'Valid customer ID is required', 400);
    }
    const { name, phone, email, address, city, customer_type, credit_limit, notes, status } = req.body;

    let creditVal = null;
    if (credit_limit !== undefined) {
      creditVal = parseStrictNumber(credit_limit, 0);
      if (creditVal === null) {
        return error(res, 'Credit limit must be a valid non-negative number', 400);
      }
    }

    const existing = await query('SELECT * FROM customers WHERE id = ?', [id]);
    if (!existing || existing.length === 0) {
      return error(res, 'Customer not found', 404);
    }

    await query(`
      UPDATE customers SET
        name = COALESCE(?, name),
        phone = ?,
        email = ?,
        address = ?,
        city = ?,
        customer_type = COALESCE(?, customer_type),
        credit_limit = COALESCE(?, credit_limit),
        notes = ?,
        status = COALESCE(?, status)
      WHERE id = ?
    `, [
      name ? name.trim() : null,
      phone !== undefined ? phone : existing[0].phone,
      email !== undefined ? email : existing[0].email,
      address !== undefined ? address : existing[0].address,
      city !== undefined ? city : existing[0].city,
      customer_type || null,
      creditVal !== null ? creditVal : null,
      notes !== undefined ? notes : existing[0].notes,
      status || null,
      id
    ]);

    await logAction({
      userId: req.user ? req.user.id : null,
      userName: req.user ? req.user.name : 'System',
      action: 'Update Customer',
      module: 'Customers',
      details: `Updated customer ID ${id}`,
      ip: req.ip
    });

    const updated = await query('SELECT * FROM customers WHERE id = ?', [id]);
    return success(res, updated[0], 'Customer updated successfully');
  } catch (err) {
    next(err);
  }
}

async function deleteCustomer(req, res, next) {
  try {
    const id = validateId(req.params.id);
    if (!id) {
      return error(res, 'Valid customer ID is required', 400);
    }
    const [sRef] = await query('SELECT COUNT(*) as count FROM sales WHERE customer_id = ?', [id]);
    if (sRef.count > 0) {
      await query('UPDATE customers SET status = "inactive" WHERE id = ?', [id]);
      return success(res, { deactivated: true }, 'Customer has purchase history and was set to inactive');
    }

    await query('DELETE FROM customers WHERE id = ?', [id]);
    return success(res, null, 'Customer deleted successfully');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getAllCustomers,
  getCustomerById,
  createCustomer,
  updateCustomer,
  deleteCustomer
};
