const { query, getTransactionConnection } = require('../config/db');
const { success, error } = require('../utils/response');
const { logAction } = require('../utils/logger');
const { validateRequired } = require('../validators/input.validator');

/**
 * GET /api/returns
 */
async function getAllReturns(req, res, next) {
  try {
    const { return_type, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const params = [];
    const where = [];

    if (return_type) {
      where.push('r.return_type = ?');
      params.push(return_type);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const [countRow] = await query(`SELECT COUNT(*) as total FROM \`returns\` r ${whereClause}`, params);
    const total = countRow.total;

    const dataSql = `
      SELECT 
        r.*,
        c.name as customer_name,
        s.name as supplier_name,
        w.name as warehouse_name,
        u.name as created_by_name,
        (SELECT COUNT(*) FROM return_items ri WHERE ri.return_id = r.id) as item_count
      FROM \`returns\` r
      LEFT JOIN customers c ON r.customer_id = c.id
      LEFT JOIN suppliers s ON r.supplier_id = s.id
      JOIN warehouses w ON r.warehouse_id = w.id
      LEFT JOIN users u ON r.created_by = u.id
      ${whereClause}
      ORDER BY r.id DESC
      LIMIT ? OFFSET ?
    `;

    const returns = await query(dataSql, [...params, parseInt(limit, 10), parseInt(offset, 10)]);

    return success(res, {
      returns,
      pagination: {
        total,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total_pages: Math.ceil(total / parseInt(limit, 10))
      }
    }, 'Returns fetched');
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/returns/:id
 */
async function getReturnById(req, res, next) {
  try {
    const { id } = req.params;
    const rows = await query(`
      SELECT 
        r.*,
        c.name as customer_name,
        s.name as supplier_name,
        w.name as warehouse_name,
        u.name as created_by_name
      FROM \`returns\` r
      LEFT JOIN customers c ON r.customer_id = c.id
      LEFT JOIN suppliers s ON r.supplier_id = s.id
      JOIN warehouses w ON r.warehouse_id = w.id
      LEFT JOIN users u ON r.created_by = u.id
      WHERE r.id = ?
    `, [id]);

    if (!rows || rows.length === 0) {
      return error(res, 'Return record not found', 404);
    }

    const ret = rows[0];

    const items = await query(`
      SELECT 
        ri.*,
        p.name as product_name,
        p.sku as product_sku,
        p.barcode as product_barcode,
        p.unit as product_unit
      FROM return_items ri
      JOIN products p ON ri.product_id = p.id
      WHERE ri.return_id = ?
    `, [id]);

    ret.items = items;
    return success(res, ret, 'Return details');
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/returns
 * Atomic Return processing for Sales or Purchases
 */
async function createReturn(req, res, next) {
  const conn = await getTransactionConnection();
  try {
    const {
      return_type, // 'Sale Return' or 'Purchase Return'
      reference_id, // sale_id or purchase_id
      invoice_number,
      warehouse_id,
      items,
      refund_amount = 0,
      reason,
      return_date = new Date().toISOString().slice(0, 10)
    } = req.body;

    const missing = validateRequired(req.body, ['return_type', 'reference_id', 'warehouse_id', 'reason']);
    if (missing.length > 0) {
      await conn.rollback();
      return error(res, `Missing required fields: ${missing.join(', ')}`, 400);
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      await conn.rollback();
      return error(res, 'At least one product item is required for the return', 400);
    }

    const year = new Date().getFullYear();
    const [countRow] = await conn.execute(
      "SELECT COUNT(*) as cnt FROM `returns` WHERE return_number LIKE ?",
      [`RET-${year}-%`]
    );
    const returnNumber = `RET-${year}-${String(countRow[0].cnt + 1).padStart(4, '0')}`;
    const userId = req.user ? req.user.id : null;

    let customerId = null;
    let supplierId = null;

    if (return_type === 'Sale Return') {
      const [saleRows] = await conn.execute('SELECT * FROM sales WHERE id = ?', [reference_id]);
      if (saleRows.length === 0) {
        await conn.rollback();
        return error(res, 'Sale record not found', 404);
      }
      customerId = saleRows[0].customer_id;
    } else if (return_type === 'Purchase Return') {
      const [purchRows] = await conn.execute('SELECT * FROM purchases WHERE id = ?', [reference_id]);
      if (purchRows.length === 0) {
        await conn.rollback();
        return error(res, 'Purchase order not found', 404);
      }
      supplierId = purchRows[0].supplier_id;
    } else {
      await conn.rollback();
      return error(res, 'Invalid return type. Must be "Sale Return" or "Purchase Return"', 400);
    }

    const refundVal = parseFloat(refund_amount) || 0;

    // 1. Insert return header
    const [returnRes] = await conn.execute(`
      INSERT INTO \`returns\` (
        return_number, return_type, reference_id, invoice_number,
        customer_id, supplier_id, warehouse_id, return_date, refund_amount, reason, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      returnNumber,
      return_type,
      reference_id,
      invoice_number || `REF-${reference_id}`,
      customerId,
      supplierId,
      warehouse_id,
      return_date,
      refundVal,
      reason.trim(),
      userId
    ]);

    const returnId = returnRes.insertId;

    // 2. Process return items
    for (const item of items) {
      const qty = parseInt(item.quantity, 10);
      const price = parseFloat(item.unit_price || 0);
      const total = qty * price;

      if (!item.product_id || isNaN(qty) || qty <= 0) {
        await conn.rollback();
        return error(res, 'Invalid product or quantity for return item', 400);
      }

      await conn.execute(`
        INSERT INTO return_items (return_id, product_id, quantity, unit_price, total)
        VALUES (?, ?, ?, ?, ?)
      `, [returnId, item.product_id, qty, price, total]);

      if (return_type === 'Sale Return') {
        // Customer returned product -> stock INCREASES back into warehouse
        await conn.execute(`
          INSERT INTO warehouse_stock (warehouse_id, product_id, quantity)
          VALUES (?, ?, ?)
          ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)
        `, [warehouse_id, item.product_id, qty]);

        await conn.execute('UPDATE products SET current_stock = current_stock + ? WHERE id = ?', [qty, item.product_id]);

        await conn.execute(`
          INSERT INTO stock_movements (product_id, warehouse_id, quantity, movement_type, reference_type, reference_id, notes, user_id)
          VALUES (?, ?, ?, 'Return', 'sale_return', ?, ?, ?)
        `, [item.product_id, warehouse_id, qty, returnId, `Sale Return ${returnNumber} (${reason})`, userId]);

      } else {
        // We returned product to supplier -> stock DECREASES from warehouse
        const [sourceStock] = await conn.execute(`
          SELECT quantity FROM warehouse_stock 
          WHERE warehouse_id = ? AND product_id = ?
          FOR UPDATE
        `, [warehouse_id, item.product_id]);

        const avail = sourceStock.length > 0 ? sourceStock[0].quantity : 0;
        if (avail < qty) {
          await conn.rollback();
          return error(res, `Cannot return to supplier. Available warehouse stock (${avail}) is less than return quantity (${qty})`, 400);
        }

        await conn.execute(`
          UPDATE warehouse_stock SET quantity = quantity - ? 
          WHERE warehouse_id = ? AND product_id = ?
        `, [qty, warehouse_id, item.product_id]);

        await conn.execute('UPDATE products SET current_stock = current_stock - ? WHERE id = ?', [qty, item.product_id]);

        await conn.execute(`
          INSERT INTO stock_movements (product_id, warehouse_id, quantity, movement_type, reference_type, reference_id, notes, user_id)
          VALUES (?, ?, ?, 'Return', 'purchase_return', ?, ?, ?)
        `, [item.product_id, warehouse_id, -qty, returnId, `Purchase Return ${returnNumber} to Supplier (${reason})`, userId]);
      }
    }

    // 3. Balance adjustments
    if (return_type === 'Sale Return' && customerId && refundVal > 0) {
      // If customer had an outstanding balance, reduce it, otherwise record cash/bank payout
      await conn.execute('UPDATE customers SET balance = GREATEST(0, balance - ?) WHERE id = ?', [refundVal, customerId]);
    } else if (return_type === 'Purchase Return' && supplierId && refundVal > 0) {
      // Reduce supplier debt balance
      await conn.execute('UPDATE suppliers SET balance = GREATEST(0, balance - ?) WHERE id = ?', [refundVal, supplierId]);
    }

    await conn.commit();

    await logAction({
      userId,
      userName: req.user ? req.user.name : 'System',
      action: 'Process Return',
      module: 'Returns',
      details: `Processed ${return_type} ${returnNumber} (Refund: ${refundVal}, Items: ${items.length}).`,
      ip: req.ip
    });

    const [created] = await query('SELECT * FROM `returns` WHERE id = ?', [returnId]);
    return success(res, created, `${return_type} processed successfully and inventory updated`, 201);
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
}

module.exports = {
  getAllReturns,
  getReturnById,
  createReturn
};
