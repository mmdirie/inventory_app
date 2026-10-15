const { query, getTransactionConnection } = require('../config/db');
const { success, error } = require('../utils/response');
const { logAction } = require('../utils/logger');
const { validateRequired } = require('../validators/input.validator');

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

    // Verify warehouse
    const [warehouseRows] = await conn.execute('SELECT * FROM warehouses WHERE id = ?', [warehouse_id]);
    if (warehouseRows.length === 0) {
      await conn.rollback();
      return error(res, 'Warehouse not found', 404);
    }

    // Customer resolution (allow null for walk-in cash customer)
    let customer = null;
    if (customer_id) {
      const [custRows] = await conn.execute('SELECT * FROM customers WHERE id = ?', [customer_id]);
      if (custRows.length > 0) {
        customer = custRows[0];
      }
    }

    // 1. Stock Check & Validation to PREVENT OVERSELLING
    let subtotal = 0;
    const validatedItems = [];

    for (const item of items) {
      const qty = parseInt(item.quantity, 10);
      const price = parseFloat(item.unit_price);
      const itemDisc = parseFloat(item.discount || 0);
      const itemTax = parseFloat(item.tax || 0);

      if (!item.product_id || isNaN(qty) || qty <= 0 || isNaN(price) || price < 0) {
        await conn.rollback();
        return error(res, 'Invalid quantity or unit price for one or more items', 400);
      }

      // Check warehouse stock with FOR UPDATE lock
      const [stockRows] = await conn.execute(`
        SELECT ws.quantity, p.name, p.current_stock
        FROM warehouse_stock ws
        JOIN products p ON ws.product_id = p.id
        WHERE ws.warehouse_id = ? AND ws.product_id = ?
        FOR UPDATE
      `, [warehouse_id, item.product_id]);

      const availableInWh = stockRows.length > 0 ? stockRows[0].quantity : 0;
      const productName = stockRows.length > 0 ? stockRows[0].name : `Product #${item.product_id}`;

      if (availableInWh < qty) {
        await conn.rollback();
        return error(
          res,
          `Insufficient stock for "${productName}" in the selected warehouse. Requested: ${qty}, Available: ${availableInWh}`,
          400
        );
      }

      const itemTotal = (qty * price) - itemDisc + itemTax;
      subtotal += (qty * price);

      validatedItems.push({
        product_id: item.product_id,
        quantity: qty,
        unit_price: price,
        discount: itemDisc,
        tax: itemTax,
        total: itemTotal
      });
    }

    const discountVal = parseFloat(discount) || 0;
    const taxVal = parseFloat(tax) || 0;
    const grandTotal = Math.max(0, subtotal - discountVal + taxVal);
    const paidVal = Math.min(grandTotal, Math.max(0, parseFloat(paid_amount) || 0));
    const remainingVal = Math.max(0, grandTotal - paidVal);

    // If remaining > 0, customer MUST be identified
    if (remainingVal > 0 && !customer) {
      await conn.rollback();
      return error(res, 'Credit or partial payment sales require selecting an identified customer', 400);
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
    const [maxSale] = await conn.execute(
      "SELECT COUNT(*) as cnt FROM sales WHERE invoice_number LIKE ?",
      [`${prefix}${year}-%`]
    );
    const seq = String(maxSale[0].cnt + 1).padStart(4, '0');
    const invoiceNumber = `${prefix}${year}-${seq}`;

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
