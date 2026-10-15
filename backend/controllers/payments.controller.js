const { query, getTransactionConnection } = require('../config/db');
const { success, error } = require('../utils/response');
const { logAction } = require('../utils/logger');
const { validateRequired, parsePagination } = require('../validators/input.validator');
const { nextDocumentNumber } = require('../utils/document-number');

function parseAmount(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const text = String(value).trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const amount = Number(text);
  return Number.isFinite(amount) && amount <= 9999999999999.99 ? amount : null;
}

/**
 * GET /api/payments
 */
async function getAllPayments(req, res, next) {
  try {
    const { payment_type, party_type, payment_method, start_date, end_date, search } = req.query;
    const { page, limit, offset } = parsePagination(req.query, 20, 100);
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

    const payments = await query(dataSql, [...params, limit, offset]);

    return success(res, {
      total_amount: Number(sumRow.total_amount),
      payments,
      pagination: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit)
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

    const amountVal = parseAmount(amount);
    const paymentTypes = ['Customer Sale', 'Customer Debt', 'Supplier Purchase', 'Supplier Debt', 'Customer Refund', 'Supplier Refund', 'Standalone', 'Expense'];
    const paymentMethods = ['Cash', 'Bank', 'Mobile Money', 'Other'];
    if (amountVal === null || amountVal <= 0) {
      await conn.rollback();
      return error(res, 'Payment amount must be a positive number', 400);
    }
    if (!paymentTypes.includes(payment_type) || !paymentMethods.includes(payment_method)) {
      await conn.rollback();
      return error(res, 'Invalid payment type or payment method', 400);
    }
    if (!['Customer', 'Supplier', 'Expense', 'Other'].includes(party_type)) {
      await conn.rollback();
      return error(res, 'Invalid payment party type', 400);
    }
    const userId = req.user ? req.user.id : null;
    let resolvedPartyName = party_name || '';
    const referenceId = reference_id === undefined || reference_id === '' ? null : Number(reference_id);
    const partyId = party_id === undefined || party_id === '' ? null : Number(party_id);
    if (referenceId !== null && (!Number.isSafeInteger(referenceId) || referenceId <= 0)) {
      await conn.rollback();
      return error(res, 'Invalid payment reference ID', 400);
    }
    if (['Customer', 'Supplier'].includes(party_type)) {
      if (!Number.isSafeInteger(partyId) || partyId <= 0) {
        await conn.rollback();
        return error(res, 'A valid customer or supplier is required', 400);
      }
      const table = party_type === 'Customer' ? 'customers' : 'suppliers';
      const [partyRows] = await conn.execute(`SELECT name FROM ${table} WHERE id = ? FOR UPDATE`, [partyId]);
      if (!partyRows.length) {
        await conn.rollback();
        return error(res, `${party_type} not found`, 404);
      }
      resolvedPartyName = partyRows[0].name;
    } else if (party_id !== undefined && party_id !== null && party_id !== '') {
      await conn.rollback();
      return error(res, 'Only customer and supplier payments may include a party ID', 400);
    }
    if (['Expense', 'Other'].includes(party_type) && !String(party_name || '').trim()) {
      await conn.rollback();
      return error(res, 'A party name is required for this payment', 400);
    }

    const isDebtSettlement = payment_type === 'Customer Debt' || payment_type === 'Supplier Debt';
    const isSaleOrPurchaseSettlement = payment_type === 'Customer Sale' || payment_type === 'Supplier Purchase';
    const isRefundSettlement = payment_type === 'Customer Refund' || payment_type === 'Supplier Refund';
    if ((isDebtSettlement || isSaleOrPurchaseSettlement || isRefundSettlement) && referenceId === null) {
      await conn.rollback();
      return error(res, 'A linked reference is required for this payment type', 400);
    }
    if (payment_type === 'Standalone' && referenceId !== null) {
      await conn.rollback();
      return error(res, 'Standalone payments cannot reference a debt or transaction', 400);
    }
    if (payment_type === 'Expense' && referenceId !== null) {
      await conn.rollback();
      return error(res, 'Expense payments cannot reference a debt or sales transaction', 400);
    }

    let referenceNumber;
    let linkedReference = referenceId;
    if (isRefundSettlement) {
      const expectedParty = payment_type === 'Customer Refund' ? 'Customer' : 'Supplier';
      if (party_type !== expectedParty) {
        await conn.rollback();
        return error(res, 'Payment party type does not match the refund type', 400);
      }
      const destinationType = payment_type === 'Customer Refund' ? 'Sale Return' : 'Purchase Return';
      const [returnRows] = await conn.execute(
        'SELECT * FROM `returns` WHERE id = ? AND return_type = ? FOR UPDATE',
        [referenceId, destinationType]
      );
      if (!returnRows.length) {
        await conn.rollback();
        return error(res, 'Refund reference does not match the selected party or return type', 404);
      }
      const linkedPartyId = payment_type === 'Customer Refund' ? Number(returnRows[0].customer_id) : Number(returnRows[0].supplier_id);
      if (!Number.isSafeInteger(linkedPartyId) || linkedPartyId <= 0 || linkedPartyId !== partyId) {
        await conn.rollback();
        return error(res, 'Refund reference does not match the selected party', 400);
      }
      if (amountVal > Number(returnRows[0].refund_amount)) {
        await conn.rollback();
        return error(res, 'Refund amount exceeds the recorded return refund amount', 400);
      }
    } else if (isDebtSettlement) {
      const debtType = payment_type === 'Customer Debt' ? 'Customer' : 'Supplier';
      if (party_type !== debtType) {
        await conn.rollback();
        return error(res, 'Payment party type does not match the debt type', 400);
      }
      const [debtRows] = await conn.execute('SELECT * FROM debts WHERE id = ? FOR UPDATE', [referenceId]);
      if (!debtRows.length || debtRows[0].debt_type !== debtType || Number(debtRows[0].party_id) !== partyId) {
        await conn.rollback();
        return error(res, 'Debt reference does not match the selected party', 400);
      }
      const debt = debtRows[0];
      const expectedReferenceType = debtType === 'Customer' ? 'Sale' : 'Purchase';
      if (debt.reference_type !== expectedReferenceType) {
        await conn.rollback();
        return error(res, 'Debt reference type does not match its party type', 409);
      }
      const sourceTable = debtType === 'Customer' ? 'sales' : 'purchases';
      const sourcePartyColumn = debtType === 'Customer' ? 'customer_id' : 'supplier_id';
      const [sourceRows] = await conn.execute(
        `SELECT id FROM ${sourceTable} WHERE id = ? AND ${sourcePartyColumn} = ? FOR UPDATE`,
        [debt.reference_id, partyId]
      );
      if (!sourceRows.length) {
        await conn.rollback();
        return error(res, 'Debt source transaction is missing or does not match the selected party', 409);
      }
      if (amountVal > Number(debt.remaining_amount)) {
        await conn.rollback();
        return error(res, 'Payment amount exceeds the outstanding debt', 400);
      }
      const paid = Number((Number(debt.paid_amount) + amountVal).toFixed(2));
      const remaining = Number((Number(debt.remaining_amount) - amountVal).toFixed(2));
      const status = remaining === 0 ? 'Paid' : 'Partially Paid';
      await conn.execute(
        'UPDATE debts SET paid_amount = ?, remaining_amount = ?, status = ? WHERE id = ?',
        [paid, remaining, status, debt.id]
      );
      if (debtType === 'Customer') {
        await conn.execute('UPDATE customers SET balance = GREATEST(0, balance - ?) WHERE id = ?', [amountVal, partyId]);
        if (debt.reference_type === 'Sale') {
          await conn.execute(`
            UPDATE sales SET paid_amount = paid_amount + ?, remaining_amount = remaining_amount - ?, payment_status = ?
            WHERE id = ? AND customer_id = ?
          `, [amountVal, amountVal, status, debt.reference_id, partyId]);
          await conn.execute(`
            UPDATE invoices SET paid_amount = paid_amount + ?, remaining_amount = remaining_amount - ?, status = ?
            WHERE sale_id = ? AND customer_id = ?
          `, [amountVal, amountVal, status, debt.reference_id, partyId]);
        }
      } else {
        await conn.execute('UPDATE suppliers SET balance = GREATEST(0, balance - ?) WHERE id = ?', [amountVal, partyId]);
        if (debt.reference_type === 'Purchase') {
          await conn.execute(`
            UPDATE purchases SET paid_amount = paid_amount + ?, remaining_amount = remaining_amount - ?, payment_status = ?
            WHERE id = ? AND supplier_id = ?
          `, [amountVal, amountVal, status, debt.reference_id, partyId]);
        }
      }
    } else if (isSaleOrPurchaseSettlement) {
      const isCustomer = payment_type === 'Customer Sale';
      const expectedParty = isCustomer ? 'Customer' : 'Supplier';
      if (party_type !== expectedParty) {
        await conn.rollback();
        return error(res, 'Payment party type does not match the transaction type', 400);
      }
      const table = isCustomer ? 'sales' : 'purchases';
      const partyColumn = isCustomer ? 'customer_id' : 'supplier_id';
      const [transactionRows] = await conn.execute(`SELECT * FROM ${table} WHERE id = ? FOR UPDATE`, [referenceId]);
      if (!transactionRows.length || Number(transactionRows[0][partyColumn]) !== partyId) {
        await conn.rollback();
        return error(res, 'Payment reference does not match the selected party', 400);
      }
      const transaction = transactionRows[0];
      if (amountVal > Number(transaction.remaining_amount)) {
        await conn.rollback();
        return error(res, 'Payment amount exceeds the outstanding transaction balance', 400);
      }
      const remaining = Number((Number(transaction.remaining_amount) - amountVal).toFixed(2));
      const status = remaining === 0 ? 'Paid' : 'Partially Paid';
      await conn.execute(`
        UPDATE ${table} SET paid_amount = paid_amount + ?, remaining_amount = ?, payment_status = ?
        WHERE id = ?
      `, [amountVal, remaining, status, referenceId]);
      if (isCustomer) {
        await conn.execute('UPDATE customers SET balance = GREATEST(0, balance - ?) WHERE id = ?', [amountVal, partyId]);
        await conn.execute('UPDATE invoices SET paid_amount = paid_amount + ?, remaining_amount = ?, status = ? WHERE sale_id = ?', [amountVal, remaining, status, referenceId]);
        await conn.execute(`
          UPDATE debts SET paid_amount = paid_amount + ?, remaining_amount = GREATEST(0, remaining_amount - ?), status = ?
          WHERE debt_type = 'Customer' AND reference_type = 'Sale' AND reference_id = ?
        `, [amountVal, amountVal, status, referenceId]);
      } else {
        await conn.execute('UPDATE suppliers SET balance = GREATEST(0, balance - ?) WHERE id = ?', [amountVal, partyId]);
        await conn.execute(`
          UPDATE debts SET paid_amount = paid_amount + ?, remaining_amount = GREATEST(0, remaining_amount - ?), status = ?
          WHERE debt_type = 'Supplier' AND reference_type = 'Purchase' AND reference_id = ?
        `, [amountVal, amountVal, status, referenceId]);
      }
    } else if (payment_type === 'Expense' && party_type !== 'Expense') {
      await conn.rollback();
      return error(res, 'Expense payments must use the Expense party type', 400);
    } else if (payment_type === 'Standalone' && party_type === 'Expense') {
      await conn.rollback();
      return error(res, 'Use the Expense payment type for expense payments', 400);
    } else if (!['Expense', 'Standalone'].includes(payment_type)) {
      await conn.rollback();
      return error(res, 'Unsupported payment type', 400);
    }

    referenceNumber = await nextDocumentNumber(conn, 'payment', 'PAY-');

    const [payRes] = await conn.execute(`
      INSERT INTO payments (
        reference_number, payment_type, party_type, party_id, party_name,
        reference_id, amount, payment_method, payment_date, notes, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      referenceNumber,
      payment_type,
      party_type,
      partyId,
      resolvedPartyName,
      isDebtSettlement ? referenceId : linkedReference,
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
