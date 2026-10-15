const { query, getTransactionConnection } = require('../config/db');
const { success, error } = require('../utils/response');
const { logAction } = require('../utils/logger');
const { validateRequired } = require('../validators/input.validator');

/**
 * GET /api/adjustments
 */
async function getAllAdjustments(req, res, next) {
  try {
    const { product_id, warehouse_id, type, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const params = [];
    const where = [];

    if (product_id) {
      where.push('sa.product_id = ?');
      params.push(product_id);
    }

    if (warehouse_id) {
      where.push('sa.warehouse_id = ?');
      params.push(warehouse_id);
    }

    if (type) {
      where.push('sa.adjustment_type = ?');
      params.push(type);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const [countRow] = await query(`SELECT COUNT(*) as total FROM stock_adjustments sa ${whereClause}`, params);
    const total = countRow.total;

    const dataSql = `
      SELECT 
        sa.*,
        p.name as product_name,
        p.sku as product_sku,
        p.unit as product_unit,
        w.name as warehouse_name,
        u.name as created_by_name
      FROM stock_adjustments sa
      JOIN products p ON sa.product_id = p.id
      JOIN warehouses w ON sa.warehouse_id = w.id
      LEFT JOIN users u ON sa.created_by = u.id
      ${whereClause}
      ORDER BY sa.id DESC
      LIMIT ? OFFSET ?
    `;

    const adjustments = await query(dataSql, [...params, parseInt(limit, 10), parseInt(offset, 10)]);

    return success(res, {
      adjustments,
      pagination: {
        total,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total_pages: Math.ceil(total / parseInt(limit, 10))
      }
    }, 'Stock adjustments fetched');
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/adjustments
 * Perform Atomic Stock Adjustment
 */
async function createAdjustment(req, res, next) {
  const conn = await getTransactionConnection();
  try {
    const {
      product_id,
      warehouse_id,
      adjustment_type,
      adjustment_quantity,
      reason,
      adjustment_date = new Date().toISOString().slice(0, 10)
    } = req.body;

    const missing = validateRequired(req.body, ['product_id', 'warehouse_id', 'adjustment_type', 'adjustment_quantity', 'reason']);
    if (missing.length > 0) {
      await conn.rollback();
      return error(res, `Missing required fields: ${missing.join(', ')}`, 400);
    }

    const qty = parseInt(adjustment_quantity, 10);
    if (isNaN(qty) || qty <= 0) {
      await conn.rollback();
      return error(res, 'Adjustment quantity must be a positive number', 400);
    }

    if (adjustment_type !== 'Increase' && adjustment_type !== 'Decrease') {
      await conn.rollback();
      return error(res, 'Adjustment type must be either Increase or Decrease', 400);
    }

    // Lock and get current warehouse stock
    const [wsRows] = await conn.execute(`
      SELECT quantity FROM warehouse_stock 
      WHERE warehouse_id = ? AND product_id = ?
      FOR UPDATE
    `, [warehouse_id, product_id]);

    const currentQty = wsRows.length > 0 ? wsRows[0].quantity : 0;
    let newQty;

    if (adjustment_type === 'Increase') {
      newQty = currentQty + qty;
    } else {
      if (currentQty < qty) {
        await conn.rollback();
        return error(res, `Cannot decrease stock below 0. Current warehouse stock is ${currentQty}, decrease requested is ${qty}`, 400);
      }
      newQty = currentQty - qty;
    }

    const year = new Date().getFullYear();
    const [countRow] = await conn.execute(
      "SELECT COUNT(*) as cnt FROM stock_adjustments WHERE adjustment_number LIKE ?",
      [`ADJ-${year}-%`]
    );
    const adjustmentNumber = `ADJ-${year}-${String(countRow[0].cnt + 1).padStart(4, '0')}`;
    const userId = req.user ? req.user.id : null;

    // 1. Insert adjustment record
    const [adjRes] = await conn.execute(`
      INSERT INTO stock_adjustments (
        adjustment_number, product_id, warehouse_id, adjustment_type,
        current_quantity, adjustment_quantity, new_quantity, reason,
        created_by, adjustment_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      adjustmentNumber,
      product_id,
      warehouse_id,
      adjustment_type,
      currentQty,
      qty,
      newQty,
      reason.trim(),
      userId,
      adjustment_date
    ]);

    const adjId = adjRes.insertId;

    // 2. Update warehouse_stock
    await conn.execute(`
      INSERT INTO warehouse_stock (warehouse_id, product_id, quantity)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE quantity = VALUES(quantity)
    `, [warehouse_id, product_id, newQty]);

    // 3. Update product total current_stock
    const delta = adjustment_type === 'Increase' ? qty : -qty;
    await conn.execute('UPDATE products SET current_stock = current_stock + ? WHERE id = ?', [delta, product_id]);

    // 4. Create stock movement
    await conn.execute(`
      INSERT INTO stock_movements (
        product_id, warehouse_id, quantity, movement_type, reference_type, reference_id, notes, user_id
      ) VALUES (?, ?, ?, 'Adjustment', 'adjustment', ?, ?, ?)
    `, [
      product_id,
      warehouse_id,
      delta,
      adjId,
      `Adjustment ${adjustmentNumber}: ${reason}`,
      userId
    ]);

    await conn.commit();

    await logAction({
      userId,
      userName: req.user ? req.user.name : 'System',
      action: 'Stock Adjustment',
      module: 'Stock',
      details: `${adjustment_type} by ${qty} for Product #${product_id} in Warehouse #${warehouse_id} (${adjustmentNumber}).`,
      ip: req.ip
    });

    const [created] = await query('SELECT * FROM stock_adjustments WHERE id = ?', [adjId]);
    return success(res, created, 'Stock adjusted successfully', 201);
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
}

module.exports = {
  getAllAdjustments,
  createAdjustment
};
