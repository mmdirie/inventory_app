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

function parseQuantity(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const text = String(value).trim();
  if (!/^[1-9]\d*$/.test(text)) return null;
  const quantity = Number(text);
  return Number.isSafeInteger(quantity) && quantity <= 2147483647 ? quantity : null;
}

/**
 * GET /api/returns
 */
async function getAllReturns(req, res, next) {
  try {
    const { return_type } = req.query;
    const { page, limit, offset } = parsePagination(req.query, 20, 100);
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

    const returns = await query(dataSql, [...params, limit, offset]);

    return success(res, {
      returns,
      pagination: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit)
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
    const id = validateId(req.params.id);
    if (!id) {
      return error(res, 'Valid return ID is required', 400);
    }
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
      warehouse_id,
      items,
      refund_amount = 0,
      reason,
      return_date = new Date().toISOString().slice(0, 10)
    } = req.body;
    const requestKey = String(req.get('Idempotency-Key') || req.body.idempotency_key || '').trim();

    const missing = validateRequired(req.body, ['return_type', 'reference_id', 'warehouse_id', 'reason']);
    if (missing.length > 0) {
      await conn.rollback();
      return error(res, `Missing required fields: ${missing.join(', ')}`, 400);
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      await conn.rollback();
      return error(res, 'At least one product item is required for the return', 400);
    }
    if (typeof reason !== 'string' || !reason.trim()) {
      await conn.rollback();
      return error(res, 'A return reason is required', 400);
    }

    if (!requestKey || requestKey.length > 100) {
      await conn.rollback();
      return error(res, 'An Idempotency-Key header is required (1-100 characters)', 400);
    }
    const [existingReturn] = await conn.execute('SELECT * FROM `returns` WHERE request_key = ?', [requestKey]);
    if (existingReturn.length) {
      await conn.commit();
      return success(res, existingReturn[0], 'Return request already processed');
    }

    const userId = req.user ? req.user.id : null;

    let customerId = null;
    let supplierId = null;
    let source;
    let sourceItems;

    if (return_type === 'Sale Return') {
      const [previewRows] = await conn.execute('SELECT customer_id FROM sales WHERE id = ?', [reference_id]);
      if (previewRows.length === 0) {
        await conn.rollback();
        return error(res, 'Sale record not found', 404);
      }
      customerId = previewRows[0].customer_id;
      if (customerId) {
        const [customerRows] = await conn.execute('SELECT id FROM customers WHERE id = ? FOR UPDATE', [customerId]);
        if (customerRows.length === 0) {
          await conn.rollback();
          return error(res, 'Sale customer record not found', 409);
        }
      }
      const [saleRows] = await conn.execute('SELECT * FROM sales WHERE id = ? FOR UPDATE', [reference_id]);
      if (saleRows.length === 0) {
        await conn.rollback();
        return error(res, 'Sale record not found', 404);
      }
      source = saleRows[0];
      if (Number(source.customer_id || 0) !== Number(customerId || 0)) {
        await conn.rollback();
        return error(res, 'Sale customer changed while processing the return; retry the request', 409);
      }
      customerId = source.customer_id;
      [sourceItems] = await conn.execute(`
        SELECT product_id, SUM(quantity) AS original_quantity, SUM(total) AS original_total
        FROM sale_items WHERE sale_id = ? GROUP BY product_id ORDER BY product_id
      `, [reference_id]);
    } else if (return_type === 'Purchase Return') {
      const [previewRows] = await conn.execute('SELECT supplier_id FROM purchases WHERE id = ?', [reference_id]);
      if (previewRows.length === 0) {
        await conn.rollback();
        return error(res, 'Purchase order not found', 404);
      }
      supplierId = previewRows[0].supplier_id;
      const [supplierRows] = await conn.execute('SELECT id FROM suppliers WHERE id = ? FOR UPDATE', [supplierId]);
      if (supplierRows.length === 0) {
        await conn.rollback();
        return error(res, 'Purchase supplier record not found', 409);
      }
      const [purchRows] = await conn.execute('SELECT * FROM purchases WHERE id = ? FOR UPDATE', [reference_id]);
      if (purchRows.length === 0) {
        await conn.rollback();
        return error(res, 'Purchase order not found', 404);
      }
      source = purchRows[0];
      if (Number(source.supplier_id) !== Number(supplierId)) {
        await conn.rollback();
        return error(res, 'Purchase supplier changed while processing the return; retry the request', 409);
      }
      supplierId = source.supplier_id;
      [sourceItems] = await conn.execute(`
        SELECT product_id, SUM(quantity) AS original_quantity, SUM(total) AS original_total
        FROM purchase_items WHERE purchase_id = ? GROUP BY product_id ORDER BY product_id
      `, [reference_id]);
    } else {
      await conn.rollback();
      return error(res, 'Invalid return type. Must be "Sale Return" or "Purchase Return"', 400);
    }

    const [concurrentRequest] = await conn.execute(
      'SELECT * FROM `returns` WHERE request_key = ? FOR UPDATE',
      [requestKey]
    );
    if (concurrentRequest.length) {
      await conn.commit();
      return success(res, concurrentRequest[0], 'Return request already processed');
    }

    if (Number(source.warehouse_id) !== Number(warehouse_id)) {
      await conn.rollback();
      return error(res, 'Returns must be processed through the source transaction warehouse', 400);
    }

    const warehouseId = Number(warehouse_id);
    if (!Number.isSafeInteger(warehouseId) || warehouseId <= 0) {
      await conn.rollback();
      return error(res, 'Invalid warehouse ID', 400);
    }

    const sourceByProduct = new Map(sourceItems.map(item => [Number(item.product_id), item]));
    const requestedByProduct = new Map();
    for (const item of items) {
      const productId = Number(item.product_id);
      const quantity = parseQuantity(item.quantity);
      if (!Number.isSafeInteger(productId) || productId <= 0 || quantity === null) {
        await conn.rollback();
        return error(res, 'Invalid product or quantity for return item', 400);
      }
      const combinedQuantity = (requestedByProduct.get(productId) || 0) + quantity;
      if (!Number.isSafeInteger(combinedQuantity) || combinedQuantity > 2147483647) {
        await conn.rollback();
        return error(res, 'Combined return quantity exceeds the supported limit', 400);
      }
      requestedByProduct.set(productId, combinedQuantity);
    }
    if (!sourceByProduct.size) {
      await conn.rollback();
      return error(res, 'The source transaction has no items to return', 400);
    }

    const [previousRows] = await conn.execute(`
      SELECT ri.product_id, ri.quantity
      FROM return_items ri
      JOIN \`returns\` r ON r.id = ri.return_id
      WHERE r.return_type = ? AND r.reference_id = ?
      ORDER BY ri.id
      FOR UPDATE
    `, [return_type, reference_id]);
    const previouslyReturned = new Map();
    for (const row of previousRows) {
      const productId = Number(row.product_id);
      previouslyReturned.set(productId, (previouslyReturned.get(productId) || 0) + Number(row.quantity));
    }
    let returnValue = 0;
    for (const [productId, quantity] of requestedByProduct) {
      const original = sourceByProduct.get(productId);
      if (!original) {
        await conn.rollback();
        return error(res, `Product ${productId} does not belong to the source transaction`, 400);
      }
      const available = Number(original.original_quantity) - (previouslyReturned.get(productId) || 0);
      if (quantity > available) {
        await conn.rollback();
        return error(res, `Return quantity exceeds the remaining source quantity for product ${productId}`, 400);
      }
      returnValue += Number(original.original_total) * quantity / Number(original.original_quantity);
    }
    returnValue = Number(returnValue.toFixed(2));
    const refundVal = parseAmount(refund_amount);
    if (refundVal === null || refundVal > returnValue || refundVal > Number(source.paid_amount)) {
      await conn.rollback();
      return error(res, 'Refund must be non-negative, no greater than returned value, or the amount previously paid', 400);
    }

    const returnNumber = await nextDocumentNumber(conn, 'return', 'RET-');

    // 1. Insert return header
    const [returnRes] = await conn.execute(`
      INSERT INTO \`returns\` (
        return_number, return_type, reference_id, invoice_number,
        customer_id, supplier_id, warehouse_id, return_date, refund_amount, request_key, reason, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      returnNumber,
      return_type,
      reference_id,
      source.invoice_number,
      customerId,
      supplierId,
      warehouse_id,
      return_date,
      refundVal,
      requestKey,
      reason.trim(),
      userId
    ]);

    const returnId = returnRes.insertId;

    const productIds = [...requestedByProduct.keys()].sort((a, b) => a - b);
    const [lockedProducts] = await conn.execute(
      `SELECT id FROM products WHERE id IN (${productIds.map(() => '?').join(',')}) ORDER BY id FOR UPDATE`,
      productIds
    );
    if (lockedProducts.length !== productIds.length) {
      await conn.rollback();
      return error(res, 'One or more returned products no longer exist', 400);
    }

    // 2. Process only quantities verified against the original transaction.
    for (const [productId, qty] of requestedByProduct) {
      const sourceItem = sourceByProduct.get(productId);
      const price = Number(sourceItem.original_total) / Number(sourceItem.original_quantity);
      const total = Number((Number(sourceItem.original_total) * qty / Number(sourceItem.original_quantity)).toFixed(2));

      await conn.execute(`
        INSERT INTO return_items (return_id, product_id, quantity, unit_price, total)
        VALUES (?, ?, ?, ?, ?)
      `, [returnId, productId, qty, price, total]);

      if (return_type === 'Sale Return') {
        // Customer returned product -> stock INCREASES back into warehouse
        await conn.execute(`
          INSERT INTO warehouse_stock (warehouse_id, product_id, quantity)
          VALUES (?, ?, ?)
          ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)
        `, [warehouse_id, productId, qty]);

        await conn.execute('UPDATE products SET current_stock = current_stock + ? WHERE id = ?', [qty, productId]);

        await conn.execute(`
          INSERT INTO stock_movements (product_id, warehouse_id, quantity, movement_type, reference_type, reference_id, notes, user_id)
          VALUES (?, ?, ?, 'Return', 'sale_return', ?, ?, ?)
        `, [productId, warehouse_id, qty, returnId, `Sale Return ${returnNumber} (${reason})`, userId]);

      } else {
        // We returned product to supplier -> stock DECREASES from warehouse
        const [sourceStock] = await conn.execute(`
          SELECT quantity FROM warehouse_stock 
          WHERE warehouse_id = ? AND product_id = ?
          FOR UPDATE
        `, [warehouse_id, productId]);

        const avail = sourceStock.length > 0 ? sourceStock[0].quantity : 0;
        if (avail < qty) {
          await conn.rollback();
          return error(res, `Cannot return to supplier. Available warehouse stock (${avail}) is less than return quantity (${qty})`, 400);
        }

        await conn.execute(`
          UPDATE warehouse_stock SET quantity = quantity - ? 
          WHERE warehouse_id = ? AND product_id = ?
        `, [qty, warehouse_id, productId]);

        await conn.execute('UPDATE products SET current_stock = current_stock - ? WHERE id = ?', [qty, productId]);

        await conn.execute(`
          INSERT INTO stock_movements (product_id, warehouse_id, quantity, movement_type, reference_type, reference_id, notes, user_id)
          VALUES (?, ?, ?, 'Return', 'purchase_return', ?, ?, ?)
        `, [productId, warehouse_id, -qty, returnId, `Purchase Return ${returnNumber} to Supplier (${reason})`, userId]);
      }
    }

    const oldTotal = Number(source.total);
    const oldPaid = Number(source.paid_amount);
    const oldRemaining = Number(source.remaining_amount);
    const newTotal = Number(Math.max(0, oldTotal - returnValue).toFixed(2));
    const newPaid = Number(Math.max(0, oldPaid - refundVal).toFixed(2));
    const newRemaining = Number(Math.max(0, newTotal - newPaid).toFixed(2));
    const paymentStatus = newRemaining === 0
      ? 'Paid'
      : (newPaid > 0 ? 'Partially Paid' : 'Unpaid');

    if (return_type === 'Sale Return') {
      await conn.execute(`
        UPDATE sales SET total = ?, paid_amount = ?, remaining_amount = ?, payment_status = ?
        WHERE id = ?
      `, [newTotal, newPaid, newRemaining, paymentStatus, reference_id]);
      await conn.execute(`
        UPDATE invoices SET total = ?, paid_amount = ?, remaining_amount = ?, status = ?
        WHERE sale_id = ?
      `, [newTotal, newPaid, newRemaining, paymentStatus, reference_id]);
      await conn.execute(`
        UPDATE debts
        SET total_amount = ?, paid_amount = ?, remaining_amount = ?, status = ?
        WHERE debt_type = 'Customer' AND reference_type = 'Sale' AND reference_id = ?
      `, [newTotal, newPaid, newRemaining, newRemaining === 0 ? 'Paid' : (newPaid > 0 ? 'Partially Paid' : 'Pending'), reference_id]);
      if (customerId) {
        await conn.execute(
          'UPDATE customers SET balance = GREATEST(0, balance + ?) WHERE id = ?',
          [newRemaining - oldRemaining, customerId]
        );
      }
    } else {
      await conn.execute(`
        UPDATE purchases SET total = ?, paid_amount = ?, remaining_amount = ?, payment_status = ?
        WHERE id = ?
      `, [newTotal, newPaid, newRemaining, paymentStatus, reference_id]);
      await conn.execute(`
        UPDATE debts
        SET total_amount = ?, paid_amount = ?, remaining_amount = ?, status = ?
        WHERE debt_type = 'Supplier' AND reference_type = 'Purchase' AND reference_id = ?
      `, [newTotal, newPaid, newRemaining, newRemaining === 0 ? 'Paid' : (newPaid > 0 ? 'Partially Paid' : 'Pending'), reference_id]);
      await conn.execute(
        'UPDATE suppliers SET balance = GREATEST(0, balance + ?) WHERE id = ?',
        [newRemaining - oldRemaining, supplierId]
      );
    }

    if (refundVal > 0) {
      const paymentType = return_type === 'Sale Return' ? 'Customer Refund' : 'Supplier Refund';
      const partyType = return_type === 'Sale Return' ? 'Customer' : 'Supplier';
      const partyId = return_type === 'Sale Return' ? customerId : supplierId;
      const partyRows = partyId
        ? await conn.execute(`SELECT name FROM ${partyType === 'Customer' ? 'customers' : 'suppliers'} WHERE id = ?`, [partyId])
        : [[]];
      const partyName = partyRows[0].length ? partyRows[0][0].name : (partyId ? '' : 'Walk-in Retail Customer');
      const paymentNumber = await nextDocumentNumber(conn, 'refund-payment', 'PAY-REF-');
      const method = req.body.payment_method || 'Cash';
      if (!['Cash', 'Bank', 'Mobile Money', 'Other'].includes(method)) {
        await conn.rollback();
        return error(res, 'Invalid refund payment method', 400);
      }
      await conn.execute(`
        INSERT INTO payments (
          reference_number, payment_type, party_type, party_id, party_name,
          reference_id, amount, payment_method, payment_date, notes, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        paymentNumber, paymentType, partyType, partyId, partyName, returnId,
        refundVal, method, return_date, `Refund for return ${returnNumber}`, userId
      ]);
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
