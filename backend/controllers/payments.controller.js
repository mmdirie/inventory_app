const { query, getTransactionConnection } = require('../config/db');
const { success, error } = require('../utils/response');
const { logAction } = require('../utils/logger');
const { validateRequired } = require('../validators/input.validator');

/**
 * GET /api/payments
 */
async function getAllPayments(req, res, next) {
  try {
    const { payment_type, party_type, payment_method, start_date, end_date, search, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const params = [];
    const where = [];

    if (search && search.trim() !== '') {
      where.push('(p.reference_number LIKE ? OR p.party_name LIKE ? OR p.notes LIKE ?)');
      params.push(`%${search.trim()}%`, `%${search.trim()}%`, `%${search.trim()}%`);
    }

    if (payment_type) {
      where.push('p.payment_type = ?');
      params.push(payment_type);
    }

    if (party_type) {
      where.push('p.party_type = ?');
      params.push(party_type);
    }

    if (payment_method) {
      where.push('p.payment_method = ?');
      params.push(payment_method);
    }

    if (start_date) {
      where.push('p.payment_date >= ?');
      params.push(start_date);
    }

    if (end_date) {
      where.push('p.payment_date <= ?');
      params.push(end_date);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const [countRow] = await query(`SELECT COUNT(*) as total FROM payments p ${whereClause}`, params);
    const total = countRow.total;

    const [sumRow] = await query(`SELECT COALESCE(SUM(amount), 0) as total_amount FROM payments p ${whereClause}`, params);

    const dataSql = `
      SELECT 
        p.*,
        u.name as created_by_name
      FROM payments p
      LEFT JOIN users u ON p.created_by = u.id
      ${whereClause}
      ORDER BY p.id DESC
      LIMIT ? OFFSET ?
    `;

    const payments = await query(dataSql, [...params, parseInt(limit, 10), parseInt(offset, 10)]);

    return success(res, {
      total_amount: Number(sumRow.total_amount),
      payments,
      pagination: {
        total,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total_pages: Math.ceil(total / parseInt(limit, 10))
      }
    }, 'Payments fetched successfully');
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/payments
 * Direct payment entry (for debt settlement or standalone customer/supplier transaction)
 */
async function createPayment(req, res, next) {
  const conn = await getTransactionConnection();
  try {
    const {
      payment_type, // 'Customer Sale', 'Customer Debt', 'Supplier Purchase', 'Supplier Debt', 'Expense'
      party_type,   // 'Customer', 'Supplier', 'Expense', 'Other'
      party_id,
      party_name,
      reference_id,
      amount,
      payment_method = 'Cash',
      payment_date = new Date().toISOString().slice(0, 10),
      notes
    } = req.body;

    const missing = validateRequired(req.body, ['payment_type', 'party_type', 'amount']);
    if (missing.length > 0) {
      await conn.rollback();
      return error(res, `Missing required fields: ${missing.join(', ')}`, 400);
    }

    const amountVal = parseFloat(amount);
    if (isNaN(amountVal) || amountVal <= 0) {
      await conn.rollback();
      return error(res, 'Payment amount must be a positive number', 400);
    }

    const year = new Date().getFullYear();
    const [countRow] = await conn.execute(
      "SELECT COUNT(*) as cnt FROM payments WHERE reference_number LIKE ?",
      [`PAY-${year}-%`]
    );
    const referenceNumber = `PAY-${year}-${String(countRow[0].cnt + 1).padStart(4, '0')}`;
    const userId = req.user ? req.user.id : null;

    let resolvedPartyName = party_name || '';

    // If customer payment, update customer balance
    if (party_type === 'Customer' && party_id) {
      const [cRows] = await conn.execute('SELECT name, balance FROM customers WHERE id = ?', [party_id]);
      if (cRows.length > 0) {
        resolvedPartyName = cRows[0].name;
        // Customer paid us -> their debt balance decreases
        await conn.execute('UPDATE customers SET balance = GREATEST(0, balance - ?) WHERE id = ?', [amountVal, party_id]);
      }
    }

    // If supplier payment, update supplier balance
    if (party_type === 'Supplier' && party_id) {
      const [sRows] = await conn.execute('SELECT name, balance FROM suppliers WHERE id = ?', [party_id]);
      if (sRows.length > 0) {
        resolvedPartyName = sRows[0].name;
        // We paid supplier -> our debt balance to them decreases
        await conn.execute('UPDATE suppliers SET balance = GREATEST(0, balance - ?) WHERE id = ?', [amountVal, party_id]);
      }
    }

    const [payRes] = await conn.execute(`
      INSERT INTO payments (
        reference_number, payment_type, party_type, party_id, party_name,
        reference_id, amount, payment_method, payment_date, notes, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      referenceNumber,
      payment_type,
      party_type,
      party_id || null,
      resolvedPartyName,
      reference_id || null,
      amountVal,
      payment_method,
      payment_date,
      notes || null,
      userId
    ]);

    await conn.commit();

    await logAction({
      userId,
      userName: req.user ? req.user.name : 'System',
      action: 'Record Payment',
      module: 'Payments',
      details: `Recorded payment ${referenceNumber}: $${amountVal} (${payment_type} - ${resolvedPartyName}) via ${payment_method}.`,
      ip: req.ip
    });

    const [created] = await query('SELECT * FROM payments WHERE id = ?', [payRes.insertId]);
    return success(res, created, 'Payment recorded successfully', 201);
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
}

module.exports = {
  getAllPayments,
  createPayment
};
