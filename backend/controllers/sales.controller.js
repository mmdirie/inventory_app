const { query, getTransactionConnection } = require('../config/db');
const { success, error } = require('../utils/response');
const { logAction } = require('../utils/logger');
const { validateRequired } = require('../validators/input.validator');
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
 * GET /api/sales
 */
async function getAllSales(req, res, next) {
  try {
    const { search, customer_id, warehouse_id, payment_status, payment_method, start_date, end_date, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const params = [];
    const where = [];

    if (search && search.trim() !== '') {
      where.push('(s.invoice_number LIKE ? OR c.name LIKE ?)');
      params.push(`%${search.trim()}%`, `%${search.trim()}%`);
    }

    if (customer_id) {
      where.push('s.customer_id = ?');
      params.push(customer_id);
    }

    if (warehouse_id) {
      where.push('s.warehouse_id = ?');
      params.push(warehouse_id);
    }

    if (payment_status) {
      where.push('s.payment_status = ?');
      params.push(payment_status);
    }

    if (payment_method) {
      where.push('s.payment_method = ?');
      params.push(payment_method);
    }

    if (start_date) {
      where.push('s.sale_date >= ?');
      params.push(start_date);
    }

    if (end_date) {
      where.push('s.sale_date <= ?');
      params.push(end_date);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const [countRow] = await query(`
      SELECT COUNT(*) as total 
      FROM sales s 
      LEFT JOIN customers c ON s.customer_id = c.id 
      ${whereClause}
    `, params);
    const total = countRow.total;

    const dataSql = `
      SELECT 
        s.*,
        COALESCE(c.name, 'Walk-in Customer') as customer_name,
        c.phone as customer_phone,
        w.name as warehouse_name,
        u.name as created_by_name,
        (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) as item_count
      FROM sales s
      LEFT JOIN customers c ON s.customer_id = c.id
      LEFT JOIN warehouses w ON s.warehouse_id = w.id
      LEFT JOIN users u ON s.created_by = u.id
      ${whereClause}
      ORDER BY s.id DESC
      LIMIT ? OFFSET ?
    `;

    const sales = await query(dataSql, [...params, parseInt(limit, 10), parseInt(offset, 10)]);

    return success(res, {
      sales,
      pagination: {
        total,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total_pages: Math.ceil(total / parseInt(limit, 10))
      }
    }, 'Sales fetched successfully');
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/sales/:id
 */
async function getSaleById(req, res, next) {
  try {
    const { id } = req.params;
    const rows = await query(`
      SELECT 
        s.*,
        COALESCE(c.name, 'Walk-in Customer') as customer_name,
        c.phone as customer_phone,
        c.email as customer_email,
        c.address as customer_address,
        c.city as customer_city,
        w.name as warehouse_name,
        w.location as warehouse_location,
        u.name as created_by_name,
        inv.id as invoice_id
      FROM sales s
      LEFT JOIN customers c ON s.customer_id = c.id
      LEFT JOIN warehouses w ON s.warehouse_id = w.id
      LEFT JOIN users u ON s.created_by = u.id
      LEFT JOIN invoices inv ON s.id = inv.sale_id
      WHERE s.id = ?
    `, [id]);

    if (!rows || rows.length === 0) {
      return error(res, 'Sale record not found', 404);
    }

    const sale = rows[0];

    const items = await query(`
      SELECT 
        si.*,
        p.name as product_name,
        p.sku as product_sku,
        p.barcode as product_barcode,
        p.unit as product_unit
      FROM sale_items si
      JOIN products p ON si.product_id = p.id
      WHERE si.sale_id = ?
    `, [id]);
    sale.items = items;

    const payments = await query(`
      SELECT * FROM payments 
      WHERE party_type = 'Customer' AND reference_id = ?
    `, [id]);
    sale.payments = payments;

    return success(res, sale, 'Sale details');
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/sales
 * Process Complete Sale / POS Transaction Atomically
 */
async function createSale(req, res, next) {
  const conn = await getTransactionConnection();
  try {
    const {
      customer_id,
      warehouse_id,
      sale_date = new Date().toISOString().slice(0, 10),
      items,
      discount = 0,
      tax = 0,
      payment_method = 'Cash',
      paid_amount = 0,
      notes
    } = req.body;

    const missing = validateRequired(req.body, ['warehouse_id']);
    if (missing.length > 0) {
      await conn.rollback();
      return error(res, `Missing required fields: ${missing.join(', ')}`, 400);
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      await conn.rollback();
      return error(res, 'At least one item is required in the sale cart', 400);
    }
    if (!['Cash', 'Bank', 'Mobile Money', 'Credit', 'Other'].includes(payment_method)) {
      await conn.rollback();
      return error(res, 'Invalid sale payment method', 400);
    }

    // Verify warehouse
    if (!Number.isSafeInteger(Number(warehouse_id)) || Number(warehouse_id) <= 0) {
      await conn.rollback();
      return error(res, 'Invalid warehouse ID', 400);
    }
    const [warehouseRows] = await conn.execute(
      "SELECT id FROM warehouses WHERE id = ? AND status = 'active' FOR UPDATE",
      [warehouse_id]
    );
    if (warehouseRows.length === 0) {
      await conn.rollback();
      return error(res, 'Warehouse not found', 404);
    }

    // Customer resolution (allow null for walk-in cash customer)
    let customer = null;
    if (customer_id) {
      if (!Number.isSafeInteger(Number(customer_id)) || Number(customer_id) <= 0) {
        await conn.rollback();
        return error(res, 'Invalid customer ID', 400);
      }
      const [custRows] = await conn.execute(
        "SELECT * FROM customers WHERE id = ? AND status = 'active' FOR UPDATE",
        [customer_id]
      );
      if (custRows.length === 0) {
        await conn.rollback();
        return error(res, 'Customer not found or inactive', 404);
      }
      customer = custRows[0];
    }

    // Lock product rows in a stable order so concurrent sales serialize, even when
    // a warehouse_stock row has not yet been created for a product.
    let subtotal = 0;
    let itemDiscountTotal = 0;
    let itemTaxTotal = 0;
    const validatedItems = [];
    const requestedByProduct = new Map();

    for (const item of items) {
      const qty = parseQuantity(item.quantity);
      const price = parseAmount(item.unit_price);
      const itemDisc = parseAmount(item.discount === undefined ? 0 : item.discount);
      const itemTax = parseAmount(item.tax === undefined ? 0 : item.tax);

      if (!Number.isSafeInteger(Number(item.product_id)) || Number(item.product_id) <= 0 ||
          qty === null || price === null || itemDisc === null || itemTax === null ||
          price > 9999999999.99 || itemDisc > 9999999999.99 || itemTax > 9999999999.99 ||
          itemDisc > qty * price || !Number.isFinite(qty * price) || qty * price > 9999999999999.99) {
        await conn.rollback();
        return error(res, 'Invalid quantity, price, discount, or tax for one or more items', 400);
      }

      const productId = Number(item.product_id);
      const combinedQuantity = (requestedByProduct.get(productId) || 0) + qty;
      if (!Number.isSafeInteger(combinedQuantity) || combinedQuantity > 2147483647) {
        await conn.rollback();
        return error(res, 'Combined product quantity exceeds the supported limit', 400);
      }
      requestedByProduct.set(productId, combinedQuantity);

      const itemTotal = Number(((qty * price) - itemDisc + itemTax).toFixed(2));
      subtotal += (qty * price);
      itemDiscountTotal += itemDisc;
      itemTaxTotal += itemTax;

      validatedItems.push({
        product_id: productId,
        quantity: qty,
        unit_price: price,
        discount: itemDisc,
        tax: itemTax,
        total: itemTotal
      });
    }

    const productIds = [...requestedByProduct.keys()].sort((a, b) => a - b);
    const [products] = await conn.execute(
      `SELECT id, name, status FROM products WHERE id IN (${productIds.map(() => '?').join(',')}) ORDER BY id FOR UPDATE`,
      productIds
    );
    if (products.length !== productIds.length || products.some(product => product.status !== 'active')) {
      await conn.rollback();
      return error(res, 'One or more products do not exist or are inactive', 400);
    }

    const [stockRows] = await conn.execute(`
      SELECT product_id, quantity FROM warehouse_stock
      WHERE warehouse_id = ? AND product_id IN (${productIds.map(() => '?').join(',')})
      ORDER BY product_id FOR UPDATE
    `, [warehouse_id, ...productIds]);
    const availableByProduct = new Map(stockRows.map(row => [Number(row.product_id), Number(row.quantity)]));
    for (const product of products) {
      const requested = requestedByProduct.get(Number(product.id));
      const available = availableByProduct.get(Number(product.id)) || 0;
      if (available < requested) {
        await conn.rollback();
        return error(
          res,
          `Insufficient stock for "${product.name}" in the selected warehouse. Requested: ${requested}, Available: ${available}`,
          400
        );
      }
    }

    const requestedDiscount = parseAmount(discount);
    const requestedTax = parseAmount(tax);
    const paidVal = parseAmount(paid_amount);
    if (requestedDiscount === null || requestedTax === null || paidVal === null ||
        requestedDiscount + itemDiscountTotal > subtotal) {
      await conn.rollback();
      return error(res, 'Sale discount, tax, or payment amount is invalid', 400);
    }
    subtotal = Number(subtotal.toFixed(2));
    const discountVal = Number((requestedDiscount + itemDiscountTotal).toFixed(2));
    const taxVal = Number((requestedTax + itemTaxTotal).toFixed(2));
    const grandTotal = Number((subtotal - discountVal + taxVal).toFixed(2));
    if (paidVal > grandTotal) {
      await conn.rollback();
      return error(res, 'Sale discount, tax, or payment amount is invalid', 400);
    }
    const remainingVal = Math.max(0, grandTotal - paidVal);

    // If remaining > 0, customer MUST be identified
    if (remainingVal > 0 && !customer) {
      await conn.rollback();
      return error(res, 'Credit or partial payment sales require selecting an identified customer', 400);
    }
    if (remainingVal > 0 && Number(customer.balance) + remainingVal > Number(customer.credit_limit)) {
      await conn.rollback();
      return error(res, 'This sale would exceed the customer credit limit', 400);
    }

    let paymentStatus = 'Unpaid';
    if (paidVal >= grandTotal) {
      paymentStatus = 'Paid';
    } else if (paidVal > 0) {
      paymentStatus = 'Partially Paid';
    }

    // Generate Invoice Number
    const [settings] = await conn.execute('SELECT invoice_prefix FROM settings LIMIT 1');
    const prefix = settings.length > 0 ? settings[0].invoice_prefix : 'INV-';
    const year = new Date().getFullYear();
    const invoiceNumber = await nextDocumentNumber(conn, 'sale', prefix);

    const userId = req.user ? req.user.id : null;

    // 2. Insert Sale
    const [saleResult] = await conn.execute(`
      INSERT INTO sales (
        invoice_number, customer_id, warehouse_id, sale_date, payment_status, payment_method,
        subtotal, discount, tax, total, paid_amount, remaining_amount, notes, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      invoiceNumber,
      customer ? customer.id : null,
      warehouse_id,
      sale_date,
      paymentStatus,
      payment_method,
      subtotal,
      discountVal,
      taxVal,
      grandTotal,
      paidVal,
      remainingVal,
      notes || null,
      userId
    ]);

    const saleId = saleResult.insertId;

    // 3. Insert Sale Items, Reduce Stock, and Record Stock Movements
    for (const item of validatedItems) {
      await conn.execute(`
        INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, discount, tax, total)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        saleId,
        item.product_id,
        item.quantity,
        item.unit_price,
        item.discount,
        item.tax,
        item.total
      ]);

      // Reduce warehouse stock
      await conn.execute(`
        UPDATE warehouse_stock 
        SET quantity = quantity - ? 
        WHERE warehouse_id = ? AND product_id = ?
      `, [item.quantity, warehouse_id, item.product_id]);

      // Reduce product total current_stock
      await conn.execute(`
        UPDATE products 
        SET current_stock = current_stock - ? 
        WHERE id = ?
      `, [item.quantity, item.product_id]);

      // Record stock movement
      await conn.execute(`
        INSERT INTO stock_movements (product_id, warehouse_id, quantity, movement_type, reference_type, reference_id, notes, user_id)
        VALUES (?, ?, ?, 'Sale', 'sale', ?, ?, ?)
      `, [
        item.product_id,
        warehouse_id,
        item.quantity,
        saleId,
        `Sale Invoice: ${invoiceNumber}`,
        userId
      ]);
    }

    // 4. Generate Invoice
    await conn.execute(`
      INSERT INTO invoices (
        invoice_number, sale_id, customer_id, invoice_date, due_date,
        subtotal, discount, tax, total, paid_amount, remaining_amount, status, notes
      ) VALUES (?, ?, ?, ?, DATE_ADD(?, INTERVAL 14 DAY), ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      invoiceNumber,
      saleId,
      customer ? customer.id : null,
      sale_date,
      sale_date,
      subtotal,
      discountVal,
      taxVal,
      grandTotal,
      paidVal,
      remainingVal,
      paymentStatus,
      notes || null
    ]);

    // 5. Record Customer Debt if unpaid balance exists
    if (remainingVal > 0 && customer) {
      await conn.execute(`
        INSERT INTO debts (
          debt_type, party_id, party_name, reference_type, reference_id,
          reference_number, total_amount, paid_amount, remaining_amount, due_date, status
        ) VALUES ('Customer', ?, ?, 'Sale', ?, ?, ?, ?, ?, DATE_ADD(?, INTERVAL 14 DAY), ?)
      `, [
        customer.id,
        customer.name,
        saleId,
        invoiceNumber,
        grandTotal,
        paidVal,
        remainingVal,
        sale_date,
        paymentStatus === 'Partially Paid' ? 'Partially Paid' : 'Pending'
      ]);

      // Increase customer balance (amount owed to us)
      await conn.execute('UPDATE customers SET balance = balance + ? WHERE id = ?', [remainingVal, customer.id]);
    }

    // 6. Record Payment if paid > 0
    if (paidVal > 0) {
      const payRef = `PAY-INV-${year}-${String(saleId).padStart(4, '0')}`;
      await conn.execute(`
        INSERT INTO payments (
          reference_number, payment_type, party_type, party_id, party_name,
          reference_id, amount, payment_method, payment_date, notes, created_by
        ) VALUES (?, 'Customer Sale', 'Customer', ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        payRef,
        customer ? customer.id : null,
        customer ? customer.name : 'Walk-in Retail Customer',
        saleId,
        paidVal,
        payment_method,
        sale_date,
        `Payment for sale: ${invoiceNumber}`,
        userId
      ]);
    }

    await conn.commit();

    await logAction({
      userId,
      userName: req.user ? req.user.name : 'System',
      action: 'Complete Sale',
      module: 'Sales',
      details: `Created Sale ${invoiceNumber}. Total: ${grandTotal}, Paid: ${paidVal}, Items: ${validatedItems.length}`,
      ip: req.ip
    });

    const [createdSale] = await query('SELECT * FROM sales WHERE id = ?', [saleId]);
    return success(res, {
      ...createdSale,
      items: validatedItems,
      invoice_number: invoiceNumber
    }, 'Sale completed successfully and invoice generated', 201);
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
}

module.exports = {
  getAllSales,
  getSaleById,
  createSale
};
