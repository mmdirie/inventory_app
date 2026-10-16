const { query, getTransactionConnection } = require('../config/db');
const { success, error } = require('../utils/response');
const { logAction } = require('../utils/logger');
const { validateRequired, validateId, parsePagination } = require('../validators/input.validator');
const { nextDocumentNumber } = require('../utils/document-number');

function parseAmount(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const text = String(value).trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const amount = Number(text);
  return Number.isFinite(amount) && amount <= 9999999999999.99 ? amount : null;
}

/**
 * GET /api/debts
 */
async function getAllDebts(req, res, next) {
  try {
    const { debt_type, status, party_id } = req.query;
    const { page, limit, offset } = parsePagination(req.query, 20, 100);
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

    const debts = await query(dataSql, [...params, limit, offset]);

    return success(res, {
      summary: summaryRow,
      debts,
      pagination: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit)
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
    const id = validateId(req.params.id);
    if (!id) {
      await conn.rollback();
      return error(res, 'Valid debt ID is required', 400);
    }
    const { amount, payment_method = 'Cash', payment_date = new Date().toISOString().slice(0, 10), notes } = req.body;

    const payVal = parseAmount(amount);
    if (payVal === null || payVal <= 0 || !['Cash', 'Bank', 'Mobile Money', 'Other'].includes(payment_method)) {
      await conn.rollback();
      return error(res, 'Payment amount and method must be valid', 400);
    }

    const [debtPreviewRows] = await conn.execute(
      'SELECT debt_type, party_id, reference_type, reference_id FROM debts WHERE id = ?',
      [id]
    );
    if (debtPreviewRows.length === 0) {
      await conn.rollback();
      return error(res, 'Debt record not found', 404);
    }

    const debtPreview = debtPreviewRows[0];
    const partyTable = debtPreview.debt_type === 'Customer' ? 'customers' : 'suppliers';
    const [partyRows] = await conn.execute(
      `SELECT id FROM ${partyTable} WHERE id = ? FOR UPDATE`,
      [debtPreview.party_id]
    );
    if (partyRows.length === 0) {
      await conn.rollback();
      return error(res, 'Debt party record not found', 409);
    }

    const [debtRows] = await conn.execute('SELECT * FROM debts WHERE id = ? FOR UPDATE', [id]);
    if (debtRows.length === 0 ||
        debtRows[0].debt_type !== debtPreview.debt_type ||
        Number(debtRows[0].party_id) !== Number(debtPreview.party_id) ||
        debtRows[0].reference_type !== debtPreview.reference_type ||
        Number(debtRows[0].reference_id) !== Number(debtPreview.reference_id)) {
      await conn.rollback();
      return error(res, 'Debt changed while processing the payment; retry the request', 409);
    }

    const debt = debtRows[0];
    if (debt.remaining_amount <= 0 || debt.status === 'Paid') {
      await conn.rollback();
      return error(res, 'This debt has already been completely settled', 400);
    }

    if (payVal > Number(debt.remaining_amount)) {
      await conn.rollback();
      return error(res, `Payment amount ($${payVal}) exceeds outstanding debt ($${debt.remaining_amount})`, 400);
    }

    const newPaidAmount = Number((Number(debt.paid_amount) + payVal).toFixed(2));
    const newRemainingAmount = Number(Math.max(0, Number(debt.remaining_amount) - payVal).toFixed(2));
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
      const [sourceRows] = await conn.execute(
        'SELECT customer_id FROM sales WHERE id = ? FOR UPDATE',
        [debt.reference_id]
      );
      if (debt.reference_type !== 'Sale' || !sourceRows.length ||
          Number(sourceRows[0].customer_id) !== Number(debt.party_id)) {
        await conn.rollback();
        return error(res, 'Debt source sale is missing or does not match the customer', 409);
      }
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
      const [sourceRows] = await conn.execute(
        'SELECT supplier_id FROM purchases WHERE id = ? FOR UPDATE',
        [debt.reference_id]
      );
      if (debt.reference_type !== 'Purchase' || !sourceRows.length ||
          Number(sourceRows[0].supplier_id) !== Number(debt.party_id)) {
        await conn.rollback();
        return error(res, 'Debt source purchase is missing or does not match the supplier', 409);
      }
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
    const payRef = await nextDocumentNumber(conn, 'payment', 'PAY-');
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
