const { query, getTransactionConnection } = require('../config/db');
const { success, error } = require('../utils/response');
const { logAction } = require('../utils/logger');
const {
  validateRequired,
  parseStrictNumber,
  parseStrictInteger,
  validateId,
  parsePagination
} = require('../validators/input.validator');

/**
 * GET /api/products
 * Search, filter, pagination, sort
 */
async function getAllProducts(req, res, next) {
  try {
    const {
      search,
      category_id,
      brand_id,
      warehouse_id,
      status,
      low_stock,
      sort_by = 'p.id',
      sort_dir = 'DESC'
    } = req.query;

    const { page, limit, offset } = parsePagination(req.query, 20, 100);
    const params = [];
    const joinParams = [];
    const whereConditions = [];

    if (search && typeof search === 'string' && search.trim() !== '') {
      whereConditions.push('(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ? OR p.description LIKE ?)');
      const term = `%${search.trim()}%`;
      params.push(term, term, term, term);
    }

    if (category_id) {
      const catId = parseStrictInteger(category_id);
      if (catId === null) {
        return error(res, 'Invalid category_id parameter', 400);
      }
      whereConditions.push('p.category_id = ?');
      params.push(catId);
    }

    if (brand_id) {
      const bId = parseStrictInteger(brand_id);
      if (bId === null) {
        return error(res, 'Invalid brand_id parameter', 400);
      }
      whereConditions.push('p.brand_id = ?');
      params.push(bId);
    }

    if (status) {
      if (status !== 'active' && status !== 'inactive') {
        return error(res, 'Invalid status parameter. Must be "active" or "inactive"', 400);
      }
      whereConditions.push('p.status = ?');
      params.push(status);
    }

    if (low_stock === 'true' || low_stock === '1') {
      whereConditions.push('p.current_stock <= p.min_stock_level');
    }

    let joinWarehouse = '';
    if (warehouse_id) {
      const whId = parseStrictInteger(warehouse_id);
      if (whId === null) {
        return error(res, 'Invalid warehouse_id parameter', 400);
      }
      joinWarehouse = 'JOIN warehouse_stock ws ON p.id = ws.product_id AND ws.warehouse_id = ?';
      joinParams.push(whId);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Total count query
    const countSql = `
      SELECT COUNT(DISTINCT p.id) as total
      FROM products p
      ${joinWarehouse}
      ${whereClause}
    `;
    const [countRow] = await query(countSql, [...joinParams, ...params]);
    const total = countRow ? countRow.total : 0;

    // Allowed sort columns
    const allowedSort = ['p.id', 'p.name', 'p.sku', 'p.barcode', 'p.current_stock', 'p.selling_price', 'p.purchase_price', 'p.created_at'];
    const safeSortBy = allowedSort.includes(sort_by) ? sort_by : 'p.id';
    const safeSortDir = sort_dir.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const dataSql = `
      SELECT 
        p.*,
        ${warehouse_id ? 'ws.quantity as warehouse_quantity,' : ''}
        c.name as category_name,
        b.name as brand_name,
        s.name as supplier_name,
        w.name as default_warehouse_name,
        (p.current_stock <= p.min_stock_level) as is_low_stock
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN brands b ON p.brand_id = b.id
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      LEFT JOIN warehouses w ON p.default_warehouse_id = w.id
      ${joinWarehouse}
      ${whereClause}
      ORDER BY ${safeSortBy} ${safeSortDir}
      LIMIT ? OFFSET ?
    `;

    const products = await query(dataSql, [...joinParams, ...params, limit, offset]);

    return success(res, {
      products,
      pagination: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit) || 1
      }
    }, 'Products fetched successfully');
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/products/:id
 */
async function getProductById(req, res, next) {
  try {
    const id = validateId(req.params.id, 'product ID');

    const rows = await query(`
      SELECT 
        p.*,
        c.name as category_name,
        b.name as brand_name,
        s.name as supplier_name,
        w.name as default_warehouse_name,
        (p.current_stock <= p.min_stock_level) as is_low_stock
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN brands b ON p.brand_id = b.id
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      LEFT JOIN warehouses w ON p.default_warehouse_id = w.id
      WHERE p.id = ?
    `, [id]);

    if (!rows || rows.length === 0) {
      return error(res, 'Product not found', 404);
    }

    const product = rows[0];

    // Fetch warehouse-specific stock levels
    const warehouseStock = await query(`
      SELECT ws.warehouse_id, ws.quantity, w.name as warehouse_name, w.location
      FROM warehouse_stock ws
      JOIN warehouses w ON ws.warehouse_id = w.id
      WHERE ws.product_id = ?
      ORDER BY ws.warehouse_id ASC
    `, [id]);
    product.warehouse_stock = warehouseStock;

    // Fetch recent stock movements
    const movements = await query(`
      SELECT sm.*, w.name as warehouse_name, u.name as user_name
      FROM stock_movements sm
      LEFT JOIN warehouses w ON sm.warehouse_id = w.id
      LEFT JOIN users u ON sm.user_id = u.id
      WHERE sm.product_id = ?
      ORDER BY sm.id DESC
      LIMIT 10
    `, [id]);
    product.recent_movements = movements;

    return success(res, product, 'Product details');
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/products/barcode/:barcode
 */
async function getProductByBarcode(req, res, next) {
  try {
    const { barcode } = req.params;
    if (!barcode || typeof barcode !== 'string') {
      return error(res, 'Barcode parameter is required', 400);
    }

    const rows = await query(`
      SELECT 
        p.*,
        c.name as category_name,
        b.name as brand_name,
        s.name as supplier_name,
        w.name as default_warehouse_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN brands b ON p.brand_id = b.id
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      LEFT JOIN warehouses w ON p.default_warehouse_id = w.id
      WHERE p.barcode = ? AND p.status = 'active'
    `, [barcode.trim()]);

    if (!rows || rows.length === 0) {
      return error(res, 'No active product found matching this barcode', 404);
    }

    const product = rows[0];
    const warehouseStock = await query(`
      SELECT ws.warehouse_id, ws.quantity, w.name as warehouse_name
      FROM warehouse_stock ws
      JOIN warehouses w ON ws.warehouse_id = w.id
      WHERE ws.product_id = ?
    `, [product.id]);
    product.warehouse_stock = warehouseStock;

    return success(res, product, 'Product found');
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/products
 */
async function createProduct(req, res, next) {
  const conn = await getTransactionConnection();
  try {
    const {
      sku,
      barcode,
      name,
      description,
      category_id,
      brand_id,
      supplier_id,
      default_warehouse_id,
      purchase_price = 0,
      selling_price = 0,
      wholesale_price = 0,
      min_stock_level = 5,
      initial_stock = 0,
      unit = 'pcs',
      status = 'active'
    } = req.body;

    const missing = validateRequired(req.body, ['sku', 'barcode', 'name']);
    if (missing.length > 0) {
      await conn.rollback();
      return error(res, `Missing required fields: ${missing.join(', ')}`, 400);
    }

    // Validate numeric prices and stock strictly
    const pPrice = parseStrictNumber(purchase_price);
    const sPrice = parseStrictNumber(selling_price);
    const wPrice = parseStrictNumber(wholesale_price !== undefined ? wholesale_price : 0);
    const minStock = parseStrictInteger(min_stock_level !== undefined ? min_stock_level : 5);
    const initStock = parseStrictInteger(initial_stock !== undefined ? initial_stock : 0);

    if (pPrice === null || pPrice < 0 || pPrice > 9999999999.99) {
      await conn.rollback();
      return error(res, 'Purchase price must be a non-negative number', 400);
    }
    if (sPrice === null || sPrice < 0 || sPrice > 9999999999.99) {
      await conn.rollback();
      return error(res, 'Selling price must be a non-negative number', 400);
    }
    if (wPrice === null || wPrice < 0 || wPrice > 9999999999.99) {
      await conn.rollback();
      return error(res, 'Wholesale price must be a non-negative number', 400);
    }
    if (minStock === null || minStock < 0 || minStock > 2147483647) {
      await conn.rollback();
      return error(res, 'Minimum stock level must be a non-negative integer', 400);
    }
    if (initStock === null || initStock < 0 || initStock > 2147483647) {
      await conn.rollback();
      return error(res, 'Initial stock must be a non-negative integer', 400);
    }

    // Check duplicate SKU or Barcode
    const [existingSku] = await conn.execute('SELECT id FROM products WHERE sku = ?', [sku.trim()]);
    if (existingSku.length > 0) {
      await conn.rollback();
      return error(res, `Product with SKU '${sku}' already exists`, 409);
    }

    const [existingBarcode] = await conn.execute('SELECT id FROM products WHERE barcode = ?', [barcode.trim()]);
    if (existingBarcode.length > 0) {
      await conn.rollback();
      return error(res, `Product with Barcode '${barcode}' already exists`, 409);
    }

    let targetWhId = null;
    if (default_warehouse_id !== undefined && default_warehouse_id !== null && String(default_warehouse_id).trim() !== '') {
      targetWhId = parseStrictInteger(default_warehouse_id);
      if (targetWhId === null || targetWhId <= 0) {
        await conn.rollback();
        return error(res, 'Invalid default warehouse ID', 400);
      }
      const [warehouseRows] = await conn.execute(
        "SELECT id FROM warehouses WHERE id = ? AND status = 'active'",
        [targetWhId]
      );
      if (warehouseRows.length === 0) {
        await conn.rollback();
        return error(res, 'Selected warehouse not found or inactive', 400);
      }
    } else {
      const [defaultWh] = await conn.execute(
        "SELECT id FROM warehouses WHERE is_default = 1 AND status = 'active' LIMIT 1"
      );
      targetWhId = defaultWh.length > 0 ? Number(defaultWh[0].id) : null;
    }
    if (initStock > 0 && !targetWhId) {
      await conn.rollback();
      return error(res, 'Create an active warehouse before recording initial stock', 400);
    }

    const [insertResult] = await conn.execute(`
      INSERT INTO products (
        sku, barcode, name, description, category_id, brand_id, supplier_id,
        default_warehouse_id, purchase_price, selling_price, wholesale_price,
        min_stock_level, current_stock, unit, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      sku.trim(),
      barcode.trim(),
      name.trim(),
      description ? String(description).trim() : null,
      category_id ? parseStrictInteger(category_id) : null,
      brand_id ? parseStrictInteger(brand_id) : null,
      supplier_id ? parseStrictInteger(supplier_id) : null,
      targetWhId || null,
      pPrice,
      sPrice,
      wPrice,
      minStock,
      initStock,
      unit ? String(unit).trim() : 'pcs',
      status === 'inactive' ? 'inactive' : 'active'
    ]);

    const newProductId = insertResult.insertId;

    // Distribute stock to warehouse
    if (targetWhId && initStock > 0) {
      await conn.execute(`
        INSERT INTO warehouse_stock (warehouse_id, product_id, quantity)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)
      `, [targetWhId, newProductId, initStock]);

      // Stock movement record
      await conn.execute(`
        INSERT INTO stock_movements (product_id, warehouse_id, quantity, movement_type, reference_type, notes, user_id)
        VALUES (?, ?, ?, 'Opening Stock', 'product_creation', 'Initial inventory recorded on product creation', ?)
      `, [newProductId, targetWhId, initStock, req.user ? req.user.id : null]);
    }

    await conn.commit();

    await logAction({
      userId: req.user ? req.user.id : null,
      userName: req.user ? req.user.name : 'System',
      action: 'Create Product',
      module: 'Products',
      details: `Created product: ${name} (SKU: ${sku}, Barcode: ${barcode}, Stock: ${initStock})`,
      ip: req.ip
    });

    const createdRows = await query('SELECT * FROM products WHERE id = ?', [newProductId]);
    if (createdRows.length === 0) {
      throw new Error('Product was created but could not be reloaded.');
    }
    return success(res, createdRows[0], 'Product created successfully', 201);
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
}

/**
 * PUT /api/products/:id
 */
async function updateProduct(req, res, next) {
  try {
    const id = validateId(req.params.id, 'product ID');
    const {
      sku,
      barcode,
      name,
      description,
      category_id,
      brand_id,
      supplier_id,
      default_warehouse_id,
      purchase_price,
      selling_price,
      wholesale_price,
      min_stock_level,
      unit,
      status
    } = req.body;

    const existing = await query('SELECT * FROM products WHERE id = ?', [id]);
    if (!existing || existing.length === 0) {
      return error(res, 'Product not found', 404);
    }

    // Validate numeric prices and stock strictly if provided
    let pPrice = null;
    let sPrice = null;
    let wPrice = null;
    let minStock = null;

    if (purchase_price !== undefined) {
      pPrice = parseStrictNumber(purchase_price);
      if (pPrice === null || pPrice < 0 || pPrice > 9999999999.99) {
        return error(res, 'Purchase price must be a non-negative number', 400);
      }
    }
    if (selling_price !== undefined) {
      sPrice = parseStrictNumber(selling_price);
      if (sPrice === null || sPrice < 0 || sPrice > 9999999999.99) {
        return error(res, 'Selling price must be a non-negative number', 400);
      }
    }
    if (wholesale_price !== undefined) {
      wPrice = parseStrictNumber(wholesale_price);
      if (wPrice === null || wPrice < 0 || wPrice > 9999999999.99) {
        return error(res, 'Wholesale price must be a non-negative number', 400);
      }
    }
    if (min_stock_level !== undefined) {
      minStock = parseStrictInteger(min_stock_level);
      if (minStock === null || minStock < 0 || minStock > 2147483647) {
        return error(res, 'Minimum stock level must be a non-negative integer', 400);
      }
    }

    // Check unique SKU
    if (sku && sku.trim() !== existing[0].sku) {
      const dup = await query('SELECT id FROM products WHERE sku = ? AND id != ?', [sku.trim(), id]);
      if (dup.length > 0) {
        return error(res, `Another product already uses SKU '${sku}'`, 409);
      }
    }

    // Check unique Barcode
    if (barcode && barcode.trim() !== existing[0].barcode) {
      const dup = await query('SELECT id FROM products WHERE barcode = ? AND id != ?', [barcode.trim(), id]);
      if (dup.length > 0) {
        return error(res, `Another product already uses Barcode '${barcode}'`, 409);
      }
    }

    await query(`
      UPDATE products SET
        sku = COALESCE(?, sku),
        barcode = COALESCE(?, barcode),
        name = COALESCE(?, name),
        description = ?,
        category_id = ?,
        brand_id = ?,
        supplier_id = ?,
        default_warehouse_id = ?,
        purchase_price = COALESCE(?, purchase_price),
        selling_price = COALESCE(?, selling_price),
        wholesale_price = COALESCE(?, wholesale_price),
        min_stock_level = COALESCE(?, min_stock_level),
        unit = COALESCE(?, unit),
        status = COALESCE(?, status)
      WHERE id = ?
    `, [
      sku ? sku.trim() : null,
      barcode ? barcode.trim() : null,
      name ? name.trim() : null,
      description !== undefined ? (description ? String(description).trim() : null) : existing[0].description,
      category_id !== undefined ? (category_id ? parseStrictInteger(category_id) : null) : existing[0].category_id,
      brand_id !== undefined ? (brand_id ? parseStrictInteger(brand_id) : null) : existing[0].brand_id,
      supplier_id !== undefined ? (supplier_id ? parseStrictInteger(supplier_id) : null) : existing[0].supplier_id,
      default_warehouse_id !== undefined ? (default_warehouse_id ? parseStrictInteger(default_warehouse_id) : null) : existing[0].default_warehouse_id,
      pPrice,
      sPrice,
      wPrice,
      minStock,
      unit ? String(unit).trim() : null,
      status ? (status === 'inactive' ? 'inactive' : 'active') : null,
      id
    ]);

    await logAction({
      userId: req.user ? req.user.id : null,
      userName: req.user ? req.user.name : 'System',
      action: 'Update Product',
      module: 'Products',
      details: `Updated product ID ${id} (${name || existing[0].name})`,
      ip: req.ip
    });

    const updated = await query('SELECT * FROM products WHERE id = ?', [id]);
    return success(res, updated[0], 'Product updated successfully');
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/products/:id
 */
async function deleteProduct(req, res, next) {
  try {
    const id = validateId(req.params.id, 'product ID');
    const existing = await query('SELECT * FROM products WHERE id = ?', [id]);
    if (!existing || existing.length === 0) {
      return error(res, 'Product not found', 404);
    }

    // Preserve inventory and transaction history by deactivating linked products.
    const [salesRef] = await query('SELECT COUNT(*) as count FROM sale_items WHERE product_id = ?', [id]);
    const [purchRef] = await query('SELECT COUNT(*) as count FROM purchase_items WHERE product_id = ?', [id]);
    const [warehouseStockRef] = await query(
      'SELECT COUNT(*) as count FROM warehouse_stock WHERE product_id = ? AND quantity <> 0',
      [id]
    );
    const [movementRef] = await query('SELECT COUNT(*) as count FROM stock_movements WHERE product_id = ?', [id]);
    const [returnRef] = await query('SELECT COUNT(*) as count FROM return_items WHERE product_id = ?', [id]);
    const [adjustmentRef] = await query('SELECT COUNT(*) as count FROM stock_adjustments WHERE product_id = ?', [id]);
    const [transferRef] = await query('SELECT COUNT(*) as count FROM stock_transfer_items WHERE product_id = ?', [id]);

    if (Number(existing[0].current_stock) !== 0 ||
        salesRef.count > 0 ||
        purchRef.count > 0 ||
        warehouseStockRef.count > 0 ||
        movementRef.count > 0 ||
        returnRef.count > 0 ||
        adjustmentRef.count > 0 ||
        transferRef.count > 0) {
      await query('UPDATE products SET status = "inactive" WHERE id = ?', [id]);
      await logAction({
        userId: req.user ? req.user.id : null,
        userName: req.user ? req.user.name : 'System',
        action: 'Deactivate Product',
        module: 'Products',
        details: `Product ID ${id} deactivated because it has stock or linked history.`,
        ip: req.ip
      });
      return success(res, { deactivated: true }, 'Product has stock or linked history and was set to inactive status');
    }

    // Only products with no stock or linked history can be permanently removed.
    await query('DELETE FROM warehouse_stock WHERE product_id = ?', [id]);
    await query('DELETE FROM products WHERE id = ?', [id]);

    await logAction({
      userId: req.user ? req.user.id : null,
      userName: req.user ? req.user.name : 'System',
      action: 'Delete Product',
      module: 'Products',
      details: `Product ID ${id} (${existing[0].name}) deleted permanently.`,
      ip: req.ip
    });

    return success(res, null, 'Product deleted successfully');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getAllProducts,
  getProductById,
  getProductByBarcode,
  createProduct,
  updateProduct,
  deleteProduct
};
