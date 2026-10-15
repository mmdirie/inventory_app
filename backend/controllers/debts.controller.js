const { query, getTransactionConnection } = require('../config/db');
const { success, error } = require('../utils/response');
const { logAction } = require('../utils/logger');
const { validateRequired } = require('../validators/input.validator');

/**
 * GET /api/debts
 */
async function getAllDebts(req, res, next) {
  try {
    const { debt_type, status, party_id, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const params = [];
    const where = [];

    if (debt_type) {
      where.push('d.debt_type = ?');
      params.push(debt_type);
    }

    if (status) {
      where.push('d.status = ?');
      params.push(status);
    }

    if (party_id) {
      where.push('d.party_id = ?');
      params.push(party_id);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const [countRow] = await query(`SELECT COUNT(*) as total FROM debts d ${whereClause}`, params);
    const total = countRow.total;

    const [summaryRow] = await query(`
      SELECT 
        COALESCE(SUM(total_amount), 0) as total_debt,
        COALESCE(SUM(paid_amount), 0) as total_paid,
        COALESCE(SUM(remaining_amount), 0) as total_remaining
      FROM debts d
      ${whereClause}
    `, params);

    const dataSql = `
      SELECT 
        d.*,
        CASE 
          WHEN d.due_date < CURDATE() AND d.remaining_amount > 0 THEN 1 
          ELSE 0 
        END as is_overdue
      FROM debts d
      ${whereClause}
      ORDER BY d.id DESC
      LIMIT ? OFFSET ?
    `;

    const debts = await query(dataSql, [...params, parseInt(limit, 10), parseInt(offset, 10)]);

    return success(res, {
      summary: summaryRow,
      debts,
      pagination: {
        total,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total_pages: Math.ceil(total / parseInt(limit, 10))
      }
    }, 'Debts fetched successfully');
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/debts/:id/pay
 * Settle or partially pay an existing debt
 */
async function payDebt(req, res, next) {
  const conn = await getTransactionConnection();
  try {
    const { id } = req.params;
    const { amount, payment_method = 'Cash', payment_date = new Date().toISOString().slice(0, 10), notes } = req.body;

    const payVal = parseFloat(amount);
    if (isNaN(payVal) || payVal <= 0) {
      await conn.rollback();
      return error(res, 'Payment amount must be a positive number', 400);
    }

    const [debtRows] = await conn.execute('SELECT * FROM debts WHERE id = ? FOR UPDATE', [id]);
    if (debtRows.length === 0) {
      await conn.rollback();
      return error(res, 'Debt record not found', 404);
    }

    const debt = debtRows[0];
    if (debt.remaining_amount <= 0 || debt.status === 'Paid') {
      await conn.rollback();
      return error(res, 'This debt has already been completely settled', 400);
    }

    if (payVal > debt.remaining_amount) {
      await conn.rollback();
      return error(res, `Payment amount ($${payVal}) exceeds outstanding debt ($${debt.remaining_amount})`, 400);
    }

    const newPaidAmount = parseFloat(debt.paid_amount) + payVal;
    const newRemainingAmount = Math.max(0, parseFloat(debt.remaining_amount) - payVal);
    const newStatus = newRemainingAmount === 0 ? 'Paid' : 'Partially Paid';
    const userId = req.user ? req.user.id : null;

    // 1. Update Debt record
    await conn.execute(`
      UPDATE debts SET
        paid_amount = ?,
        remaining_amount = ?,
        status = ?
      WHERE id = ?
    `, [newPaidAmount, newRemainingAmount, newStatus, id]);

    // 2. Update party balance
    if (debt.debt_type === 'Customer') {
      await conn.execute('UPDATE customers SET balance = GREATEST(0, balance - ?) WHERE id = ?', [payVal, debt.party_id]);
      
      // Update linked sale and invoice if applicable
      if (debt.reference_type === 'Sale' && debt.reference_id) {
        await conn.execute(`
          UPDATE sales 
          SET paid_amount = paid_amount + ?, remaining_amount = GREATEST(0, remaining_amount - ?), payment_status = ?
          WHERE id = ?
        `, [payVal, payVal, newStatus, debt.reference_id]);

        await conn.execute(`
          UPDATE invoices 
          SET paid_amount = paid_amount + ?, remaining_amount = GREATEST(0, remaining_amount - ?), status = ?
          WHERE sale_id = ?
        `, [payVal, payVal, newStatus, debt.reference_id]);
      }
    } else if (debt.debt_type === 'Supplier') {
      await conn.execute('UPDATE suppliers SET balance = GREATEST(0, balance - ?) WHERE id = ?', [payVal, debt.party_id]);

      // Update linked purchase
      if (debt.reference_type === 'Purchase' && debt.reference_id) {
        await conn.execute(`
          UPDATE purchases 
          SET paid_amount = paid_amount + ?, remaining_amount = GREATEST(0, remaining_amount - ?), payment_status = ?
          WHERE id = ?
        `, [payVal, payVal, newStatus, debt.reference_id]);
      }
    }

    // 3. Record Payment
    const year = new Date().getFullYear();
    const payRef = `PAY-DEBT-${year}-${String(id).padStart(4, '0')}`;
    const pType = debt.debt_type === 'Customer' ? 'Customer Debt' : 'Supplier Debt';

    await conn.execute(`
      INSERT INTO payments (
        reference_number, payment_type, party_type, party_id, party_name,
        reference_id, amount, payment_method, payment_date, notes, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      payRef,
      pType,
      debt.debt_type,
      debt.party_id,
      debt.party_name,
      debt.id,
      payVal,
      payment_method,
      payment_date,
      notes || `Debt payment for ${debt.reference_number}`,
      userId
    ]);

    await conn.commit();

    await logAction({
      userId,
      userName: req.user ? req.user.name : 'System',
      action: 'Debt Payment',
      module: 'Debts',
      details: `Paid $${payVal} on ${debt.debt_type} debt #${id} (${debt.party_name}). Remaining: $${newRemainingAmount}`,
      ip: req.ip
    });

    const [updated] = await query('SELECT * FROM debts WHERE id = ?', [id]);
    return success(res, updated, 'Debt payment processed successfully');
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
}

module.exports = {
  getAllDebts,
  payDebt
};
