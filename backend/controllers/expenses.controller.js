const { query } = require('../config/db');
const { success, error } = require('../utils/response');
const { logAction } = require('../utils/logger');
const { validateRequired, validateId, parsePagination, parseStrictNumber } = require('../validators/input.validator');

const PAYMENT_METHODS = new Set(['Cash', 'Bank', 'Mobile Money', 'Other']);

function isValidExpenseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const year = Number(value.slice(0, 4));
  const date = new Date(`${value}T00:00:00.000Z`);
  return year >= 1000 && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * GET /api/expenses
 */
async function getAllExpenses(req, res, next) {
  try {
    const { category, payment_method, start_date, end_date, search } = req.query;
    const { page, limit, offset } = parsePagination(req.query, 20, 100);
    const params = [];
    const where = [];

    if (search && search.trim() !== '') {
      where.push('(e.category LIKE ? OR e.description LIKE ?)');
      params.push(`%${search.trim()}%`, `%${search.trim()}%`);
    }

    if (category) {
      where.push('e.category = ?');
      params.push(category);
    }

    if (payment_method) {
      where.push('e.payment_method = ?');
      params.push(payment_method);
    }

    if (start_date) {
      where.push('e.expense_date >= ?');
      params.push(start_date);
    }

    if (end_date) {
      where.push('e.expense_date <= ?');
      params.push(end_date);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const [countRow] = await query(`SELECT COUNT(*) as total FROM expenses e ${whereClause}`, params);
    const total = countRow.total;

    const [sumRow] = await query(`SELECT COALESCE(SUM(amount), 0) as total_amount FROM expenses e ${whereClause}`, params);
    const totalAmount = sumRow.total_amount;

    const dataSql = `
      SELECT 
        e.*,
        u.name as created_by_name
      FROM expenses e
      LEFT JOIN users u ON e.created_by = u.id
      ${whereClause}
      ORDER BY e.expense_date DESC, e.id DESC
      LIMIT ? OFFSET ?
    `;

    const expenses = await query(dataSql, [...params, limit, offset]);

    return success(res, {
      total_amount: Number(totalAmount),
      expenses,
      pagination: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit)
      }
    }, 'Expenses fetched successfully');
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/expenses
 */
async function createExpense(req, res, next) {
  try {
    const { category, description, amount, payment_method = 'Cash', expense_date = new Date().toISOString().slice(0, 10), notes } = req.body;
    const missing = validateRequired(req.body, ['category', 'description', 'amount']);
    if (missing.length > 0) {
      return error(res, `Missing required fields: ${missing.join(', ')}`, 400);
    }

    if (typeof category !== 'string' || typeof description !== 'string') {
      return error(res, 'Expense category and description must be text', 400);
    }

    const amountVal = parseStrictNumber(amount, 0.01);
    if (amountVal === null) {
      return error(res, 'Expense amount must be a positive number', 400);
    }
    if (!PAYMENT_METHODS.has(payment_method)) {
      return error(res, 'Invalid expense payment method', 400);
    }
    if (!isValidExpenseDate(expense_date)) {
      return error(res, 'Expense date must be a valid date in YYYY-MM-DD format', 400);
    }

    const userId = req.user ? req.user.id : null;

    const result = await query(`
      INSERT INTO expenses (category, description, amount, payment_method, expense_date, created_by, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      category.trim(),
      description.trim(),
      amountVal,
      payment_method,
      expense_date,
      userId,
      notes || null
    ]);

    await logAction({
      userId,
      userName: req.user ? req.user.name : 'System',
      action: 'Create Expense',
      module: 'Expenses',
      details: `Created expense: ${category} - $${amountVal} (${description})`,
      ip: req.ip
    });

    const created = await query('SELECT * FROM expenses WHERE id = ?', [result.insertId]);
    return success(res, created[0], 'Expense recorded successfully', 201);
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/expenses/:id
 */
async function updateExpense(req, res, next) {
  try {
    const id = validateId(req.params.id);
    if (!id) {
      return error(res, 'Valid expense ID is required', 400);
    }
    const { category, description, amount, payment_method, expense_date, notes } = req.body;

    if (category !== undefined && typeof category !== 'string') {
      return error(res, 'Expense category must be text', 400);
    }
    if (description !== undefined && typeof description !== 'string') {
      return error(res, 'Expense description must be text', 400);
    }
    let amountVal = null;
    if (amount !== undefined) {
      amountVal = parseStrictNumber(amount, 0.01);
      if (amountVal === null) {
        return error(res, 'Expense amount must be a positive number', 400);
      }
    }
    if (payment_method !== undefined && !PAYMENT_METHODS.has(payment_method)) {
      return error(res, 'Invalid expense payment method', 400);
    }
    if (expense_date !== undefined && !isValidExpenseDate(expense_date)) {
      return error(res, 'Expense date must be a valid date in YYYY-MM-DD format', 400);
    }

    const existing = await query('SELECT * FROM expenses WHERE id = ?', [id]);
    if (!existing || existing.length === 0) {
      return error(res, 'Expense record not found', 404);
    }

    await query(`
      UPDATE expenses SET
        category = COALESCE(?, category),
        description = COALESCE(?, description),
        amount = COALESCE(?, amount),
        payment_method = COALESCE(?, payment_method),
        expense_date = COALESCE(?, expense_date),
        notes = ?
      WHERE id = ?
    `, [
      category ? category.trim() : null,
      description ? description.trim() : null,
      amountVal !== null ? amountVal : null,
      payment_method || null,
      expense_date || null,
      notes !== undefined ? notes : existing[0].notes,
      id
    ]);

    await logAction({
      userId: req.user ? req.user.id : null,
      userName: req.user ? req.user.name : 'System',
      action: 'Update Expense',
      module: 'Expenses',
      details: `Updated expense ID ${id}`,
      ip: req.ip
    });

    const updated = await query('SELECT * FROM expenses WHERE id = ?', [id]);
    return success(res, updated[0], 'Expense updated successfully');
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/expenses/:id
 */
async function deleteExpense(req, res, next) {
  try {
    const id = validateId(req.params.id);
    if (!id) {
      return error(res, 'Valid expense ID is required', 400);
    }
    const existing = await query('SELECT * FROM expenses WHERE id = ?', [id]);
    if (!existing || existing.length === 0) {
      return error(res, 'Expense record not found', 404);
    }

    await query('DELETE FROM expenses WHERE id = ?', [id]);

    await logAction({
      userId: req.user ? req.user.id : null,
      userName: req.user ? req.user.name : 'System',
      action: 'Delete Expense',
      module: 'Expenses',
      details: `Deleted expense ID ${id} (${existing[0].description} - $${existing[0].amount})`,
      ip: req.ip
    });

    return success(res, null, 'Expense deleted successfully');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getAllExpenses,
  createExpense,
  updateExpense,
  deleteExpense
};
