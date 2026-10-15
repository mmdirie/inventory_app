const { query, getTransactionConnection } = require('../config/db');
const { success, error } = require('../utils/response');
const { logAction } = require('../utils/logger');
const { validateRequired, isPositiveNumber } = require('../validators/input.validator');

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
      sort_dir = 'DESC',
      page = 1,
      limit = 20
    } = req.query;

    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const params = [];
    const whereConditions = [];

    if (search && search.trim() !== '') {
      whereConditions.push('(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ? OR p.description LIKE ?)');
      const term = `%${search.trim()}%`;
      params.push(term, term, term, term);
    }

    if (category_id) {
      whereConditions.push('p.category_id = ?');
      params.push(category_id);
    }

    if (brand_id) {
      whereConditions.push('p.brand_id = ?');
      params.push(brand_id);
    }

    if (status) {
      whereConditions.push('p.status = ?');
      params.push(status);
    }

    if (low_stock === 'true' || low_stock === '1') {
      whereConditions.push('p.current_stock <= p.min_stock_level');
    }

    let joinWarehouse = '';
    if (warehouse_id) {
      joinWarehouse = 'JOIN warehouse_stock ws ON p.id = ws.product_id AND ws.warehouse_id = ?';
      params.push(warehouse_id);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Total count query
    const countSql = `
      SELECT COUNT(DISTINCT p.id) as total
      FROM products p
      ${joinWarehouse}
      ${whereClause}
    `;
    const [countRow] = await query(countSql, params);
    const total = countRow.total;

    // Allowed sort columns
    const allowedSort = ['p.id', 'p.name', 'p.sku', 'p.barcode', 'p.current_stock', 'p.selling_price', 'p.purchase_price', 'p.created_at'];
    const safeSortBy = allowedSort.includes(sort_by) ? sort_by : 'p.id';
    const safeSortDir = sort_dir.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const dataSql = `
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
      ${joinWarehouse}
      ${whereClause}
      ORDER BY ${safeSortBy} ${safeSortDir}
      LIMIT ? OFFSET ?
    `;

    const dataParams = [...params, parseInt(limit, 10), parseInt(offset, 10)];
    const products = await query(dataSql, dataParams);

    return success(res, {
      products,
      pagination: {
        total,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total_pages: Math.ceil(total / parseInt(limit, 10))
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
    const { id } = req.params;
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
      WHERE p.id = ?
    `, [id]);

    if (!rows || rows.length === 0) {
      return error(res, 'Product not found', 404);
    }

    const product = rows[0];

    // Get stock by warehouses
    const warehouseStock = await query(`
      SELECT ws.warehouse_id, ws.quantity, w.name as warehouse_name, w.location
      FROM warehouse_stock ws
      JOIN warehouses w ON ws.warehouse_id = w.id
      WHERE ws.product_id = ?
    `, [id]);
    product.warehouse_stock = warehouseStock;

    // Get recent movements
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
    `, [barcode]);

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

    // Validate warehouse if initial_stock > 0
    let targetWhId = default_warehouse_id;
    if (!targetWhId) {
      const [defaultWh] = await conn.execute('SELECT id FROM warehouses WHERE is_default = 1 LIMIT 1');
      targetWhId = defaultWh.length > 0 ? defaultWh[0].id : 1;
    }

    const currentStock = Math.max(0, parseInt(initial_stock, 10) || 0);

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
      description || null,
      category_id || null,
      brand_id || null,
      supplier_id || null,
      targetWhId || null,
      parseFloat(purchase_price) || 0,
      parseFloat(selling_price) || 0,
      parseFloat(wholesale_price) || 0,
      parseInt(min_stock_level, 10) || 5,
      currentStock,
      unit || 'pcs',
      status || 'active'
    ]);

    const newProductId = insertResult.insertId;

    // Distribute stock to warehouse
    if (targetWhId && currentStock > 0) {
      await conn.execute(`
        INSERT INTO warehouse_stock (warehouse_id, product_id, quantity)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)
      `, [targetWhId, newProductId, currentStock]);

      // Stock movement record
      await conn.execute(`
        INSERT INTO stock_movements (product_id, warehouse_id, quantity, movement_type, reference_type, notes, user_id)
        VALUES (?, ?, ?, 'Opening Stock', 'product_creation', 'Initial inventory recorded on product creation', ?)
      `, [newProductId, targetWhId, currentStock, req.user ? req.user.id : null]);
    }

    await conn.commit();

    await logAction({
      userId: req.user ? req.user.id : null,
      userName: req.user ? req.user.name : 'System',
      action: 'Create Product',
      module: 'Products',
      details: `Created product: ${name} (SKU: ${sku}, Barcode: ${barcode}, Stock: ${currentStock})`,
      ip: req.ip
    });

    const [createdRows] = await query('SELECT * FROM products WHERE id = ?', [newProductId]);
    return success(res, createdRows, 'Product created successfully', 201);
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
    const { id } = req.params;
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
      description !== undefined ? description : existing[0].description,
      category_id !== undefined ? category_id : existing[0].category_id,
      brand_id !== undefined ? brand_id : existing[0].brand_id,
      supplier_id !== undefined ? supplier_id : existing[0].supplier_id,
      default_warehouse_id !== undefined ? default_warehouse_id : existing[0].default_warehouse_id,
      purchase_price !== undefined ? parseFloat(purchase_price) : null,
      selling_price !== undefined ? parseFloat(selling_price) : null,
      wholesale_price !== undefined ? parseFloat(wholesale_price) : null,
      min_stock_level !== undefined ? parseInt(min_stock_level, 10) : null,
      unit || null,
      status || null,
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
 * Soft delete (set status inactive) or hard delete if no transactions
 */
async function deleteProduct(req, res, next) {
  try {
    const { id } = req.params;
    const existing = await query('SELECT * FROM products WHERE id = ?', [id]);
    if (!existing || existing.length === 0) {
      return error(res, 'Product not found', 404);
    }

    // Check if product is referenced in sales or purchases
    const [salesRef] = await query('SELECT COUNT(*) as count FROM sale_items WHERE product_id = ?', [id]);
    const [purchRef] = await query('SELECT COUNT(*) as count FROM purchase_items WHERE product_id = ?', [id]);

    if (salesRef.count > 0 || purchRef.count > 0) {
      // Deactivate instead of deleting to maintain historical reporting integrity
      await query('UPDATE products SET status = "inactive" WHERE id = ?', [id]);
      await logAction({
        userId: req.user ? req.user.id : null,
        userName: req.user ? req.user.name : 'System',
        action: 'Deactivate Product',
        module: 'Products',
        details: `Product ID ${id} deactivated because it contains historical transactions.`,
        ip: req.ip
      });
      return success(res, { deactivated: true }, 'Product has linked transactions and was set to inactive status');
    }

    // Safe to hard delete
    await query('DELETE FROM warehouse_stock WHERE product_id = ?', [id]);
    await query('DELETE FROM stock_movements WHERE product_id = ?', [id]);
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
