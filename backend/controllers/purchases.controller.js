const { query, getTransactionConnection } = require('../config/db');
const { success, error } = require('../utils/response');
const { logAction } = require('../utils/logger');
const { validateRequired } = require('../validators/input.validator');
const { nextDocumentNumber } = require('../utils/document-number');

/**
 * GET /api/purchases
 */
async function getAllPurchases(req, res, next) {
  try {
    const { search, supplier_id, warehouse_id, payment_status, start_date, end_date, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const params = [];
    const where = [];

    if (search && search.trim() !== '') {
      where.push('(p.invoice_number LIKE ? OR s.name LIKE ?)');
      params.push(`%${search.trim()}%`, `%${search.trim()}%`);
    }

    if (supplier_id) {
      where.push('p.supplier_id = ?');
      params.push(supplier_id);
    }

    if (warehouse_id) {
      where.push('p.warehouse_id = ?');
      params.push(warehouse_id);
    }

    if (payment_status) {
      where.push('p.payment_status = ?');
      params.push(payment_status);
    }

    if (start_date) {
      where.push('p.purchase_date >= ?');
      params.push(start_date);
    }

    if (end_date) {
      where.push('p.purchase_date <= ?');
      params.push(end_date);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const [countRow] = await query(`
      SELECT COUNT(*) as total 
      FROM purchases p 
      LEFT JOIN suppliers s ON p.supplier_id = s.id 
      ${whereClause}
    `, params);
    const total = countRow.total;

    const dataSql = `
      SELECT 
        p.*,
        s.name as supplier_name,
        w.name as warehouse_name,
        u.name as created_by_name,
        (SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = p.id) as item_count
      FROM purchases p
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      LEFT JOIN warehouses w ON p.warehouse_id = w.id
      LEFT JOIN users u ON p.created_by = u.id
      ${whereClause}
      ORDER BY p.id DESC
      LIMIT ? OFFSET ?
    `;

    const purchases = await query(dataSql, [...params, parseInt(limit, 10), parseInt(offset, 10)]);

    return success(res, {
      purchases,
      pagination: {
        total,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total_pages: Math.ceil(total / parseInt(limit, 10))
      }
    }, 'Purchases fetched successfully');
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/purchases/:id
 */
async function getPurchaseById(req, res, next) {
  try {
    const { id } = req.params;
    const rows = await query(`
      SELECT 
        p.*,
        s.name as supplier_name,
        s.phone as supplier_phone,
        s.email as supplier_email,
        s.address as supplier_address,
        w.name as warehouse_name,
        w.location as warehouse_location,
        u.name as created_by_name
      FROM purchases p
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      LEFT JOIN warehouses w ON p.warehouse_id = w.id
      LEFT JOIN users u ON p.created_by = u.id
      WHERE p.id = ?
    `, [id]);

    if (!rows || rows.length === 0) {
      return error(res, 'Purchase order not found', 404);
    }

    const purchase = rows[0];

    const items = await query(`
      SELECT 
        pi.*,
        p.name as product_name,
        p.sku as product_sku,
        p.barcode as product_barcode,
        p.unit as product_unit
      FROM purchase_items pi
      JOIN products p ON pi.product_id = p.id
      WHERE pi.purchase_id = ?
    `, [id]);
    purchase.items = items;

    // Payments linked
    const payments = await query(`
      SELECT * FROM payments 
      WHERE party_type = 'Supplier' AND reference_id = ?
    `, [id]);
    purchase.payments = payments;

    return success(res, purchase, 'Purchase details');
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/purchases
 * Complete Purchase with Atomic Database Transaction:
 * 1. Create Purchase
 * 2. Create Purchase Items
 * 3. Increase Warehouse Stock
 * 4. Increase Product Current Stock
 * 5. Record Stock Movement ('Purchase')
 * 6. Record Supplier Debt & Balance if remaining > 0
 * 7. Record Payment if paid > 0
 */
async function createPurchase(req, res, next) {
  const conn = await getTransactionConnection();
  try {
    const {
      supplier_id,
      warehouse_id,
      purchase_date,
      items,
      discount = 0,
      tax = 0,
      paid_amount = 0,
      payment_method = 'Bank',
      notes
    } = req.body;

    const missing = validateRequired(req.body, ['supplier_id', 'warehouse_id', 'purchase_date']);
    if (missing.length > 0) {
      await conn.rollback();
      return error(res, `Missing required fields: ${missing.join(', ')}`, 400);
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      await conn.rollback();
      return error(res, 'At least one item is required in the purchase order', 400);
    }

    // Verify supplier and warehouse exist
    const [supplierRows] = await conn.execute('SELECT * FROM suppliers WHERE id = ?', [supplier_id]);
    if (supplierRows.length === 0) {
      await conn.rollback();
      return error(res, 'Supplier not found', 404);
    }
    const supplier = supplierRows[0];

    const [warehouseRows] = await conn.execute('SELECT * FROM warehouses WHERE id = ?', [warehouse_id]);
    if (warehouseRows.length === 0) {
      await conn.rollback();
      return error(res, 'Warehouse not found', 404);
    }

    // Generate unique invoice/PO number
    const [settings] = await conn.execute('SELECT purchase_prefix FROM settings LIMIT 1');
    const prefix = settings.length > 0 ? settings[0].purchase_prefix : 'PO-';
    const year = new Date().getFullYear();
    const invoiceNumber = await nextDocumentNumber(conn, 'purchase', prefix, year);

    // Calculate subtotal
    let subtotal = 0;
    const validatedItems = [];

    for (const item of items) {
      const qty = parseInt(item.quantity, 10);
      const price = parseFloat(item.purchase_price);
      const itemDisc = parseFloat(item.discount || 0);
      const itemTax = parseFloat(item.tax || 0);

      if (!item.product_id || isNaN(qty) || qty <= 0 || isNaN(price) || price < 0) {
        await conn.rollback();
        return error(res, 'Invalid quantity or price for one or more purchase items', 400);
      }

      const itemTotal = (qty * price) - itemDisc + itemTax;
      subtotal += (qty * price);

      validatedItems.push({
        product_id: item.product_id,
        quantity: qty,
        purchase_price: price,
        discount: itemDisc,
        tax: itemTax,
        total: itemTotal
      });
    }

    const discountVal = parseFloat(discount) || 0;
    const taxVal = parseFloat(tax) || 0;
    const grandTotal = subtotal - discountVal + taxVal;
    const paidVal = Math.min(grandTotal, Math.max(0, parseFloat(paid_amount) || 0));
    const remainingVal = Math.max(0, grandTotal - paidVal);

    let paymentStatus = 'Unpaid';
    if (paidVal >= grandTotal) {
      paymentStatus = 'Paid';
    } else if (paidVal > 0) {
      paymentStatus = 'Partially Paid';
    }

    const userId = req.user ? req.user.id : null;

    // 1. Insert Purchase
    const [purchResult] = await conn.execute(`
      INSERT INTO purchases (
        invoice_number, supplier_id, warehouse_id, purchase_date, payment_status,
        subtotal, discount, tax, total, paid_amount, remaining_amount, notes, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      invoiceNumber,
      supplier_id,
      warehouse_id,
      purchase_date,
      paymentStatus,
      subtotal,
      discountVal,
      taxVal,
      grandTotal,
      paidVal,
      remainingVal,
      notes || null,
      userId
    ]);

    const purchaseId = purchResult.insertId;

    // 2. Insert items & Update Stock
    for (const item of validatedItems) {
      await conn.execute(`
        INSERT INTO purchase_items (purchase_id, product_id, quantity, purchase_price, discount, tax, total)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        purchaseId,
        item.product_id,
        item.quantity,
        item.purchase_price,
        item.discount,
        item.tax,
        item.total
      ]);

      // Update / Insert warehouse_stock
      await conn.execute(`
        INSERT INTO warehouse_stock (warehouse_id, product_id, quantity)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)
      `, [warehouse_id, item.product_id, item.quantity]);

      // Update product current_stock and optionally update last purchase price
      await conn.execute(`
        UPDATE products 
        SET current_stock = current_stock + ?,
            purchase_price = ?
        WHERE id = ?
      `, [item.quantity, item.purchase_price, item.product_id]);

      // Record stock movement
      await conn.execute(`
        INSERT INTO stock_movements (product_id, warehouse_id, quantity, movement_type, reference_type, reference_id, notes, user_id)
        VALUES (?, ?, ?, 'Purchase', 'purchase', ?, ?, ?)
      `, [item.product_id, warehouse_id, item.quantity, purchaseId, `Purchase PO: ${invoiceNumber}`, userId]);
    }

    // 3. Record Supplier Debt if remaining > 0
    if (remainingVal > 0) {
      await conn.execute(`
        INSERT INTO debts (debt_type, party_id, party_name, reference_type, reference_id, reference_number, total_amount, paid_amount, remaining_amount, due_date, status)
        VALUES ('Supplier', ?, ?, 'Purchase', ?, ?, ?, ?, ?, DATE_ADD(?, INTERVAL 30 DAY), ?)
      `, [
        supplier_id,
        supplier.name,
        purchaseId,
        invoiceNumber,
        grandTotal,
        paidVal,
        remainingVal,
        purchase_date,
        paymentStatus === 'Partially Paid' ? 'Partially Paid' : 'Pending'
      ]);

      // Increase supplier balance (amount owed to supplier)
      await conn.execute('UPDATE suppliers SET balance = balance + ? WHERE id = ?', [remainingVal, supplier_id]);
    }

    // 4. Record Payment if paid > 0
    if (paidVal > 0) {
      const payRef = `PAY-PO-${year}-${String(purchaseId).padStart(4, '0')}`;
      await conn.execute(`
        INSERT INTO payments (reference_number, payment_type, party_type, party_id, party_name, reference_id, amount, payment_method, payment_date, notes, created_by)
        VALUES (?, 'Supplier Purchase', 'Supplier', ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        payRef,
        supplier_id,
        supplier.name,
        purchaseId,
        paidVal,
        payment_method || 'Bank',
        purchase_date,
        `Payment for PO: ${invoiceNumber}`,
        userId
      ]);
    }

    await conn.commit();

    await logAction({
      userId,
      userName: req.user ? req.user.name : 'System',
      action: 'Create Purchase',
      module: 'Purchases',
      details: `Created Purchase ${invoiceNumber} for supplier ${supplier.name}. Total: ${grandTotal}, Paid: ${paidVal}`,
      ip: req.ip
    });

    const [created] = await query('SELECT * FROM purchases WHERE id = ?', [purchaseId]);
    return success(res, created, 'Purchase order created successfully and stock updated', 201);
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
}

module.exports = {
  getAllPurchases,
  getPurchaseById,
  createPurchase
};
