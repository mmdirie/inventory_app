const { query } = require('../config/db');
const { success, error } = require('../utils/response');
const { parsePagination } = require('../validators/input.validator');

/**
 * GET /api/stock
 * Current stock aggregated with warehouse distributions
 */
async function getStockOverview(req, res, next) {
  try {
    const { search, category_id, warehouse_id, low_stock } = req.query;
    const { page, limit, offset } = parsePagination(req.query, 20, 100);
    const params = [];
    const where = ['p.status = "active"'];

    if (search && search.trim() !== '') {
      where.push('(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)');
      params.push(`%${search.trim()}%`, `%${search.trim()}%`, `%${search.trim()}%`);
    }

    if (category_id) {
      where.push('p.category_id = ?');
      params.push(category_id);
    }

    if (low_stock === 'true' || low_stock === '1') {
      where.push('p.current_stock <= p.min_stock_level');
    }

    let joinWh = '';
    if (warehouse_id) {
      joinWh = 'JOIN warehouse_stock ws_filter ON p.id = ws_filter.product_id AND ws_filter.warehouse_id = ?';
      params.push(warehouse_id);
    }

    const whereClause = `WHERE ${where.join(' AND ')}`;

    const [countRow] = await query(`
      SELECT COUNT(DISTINCT p.id) as total 
      FROM products p 
      ${joinWh}
      ${whereClause}
    `, params);
    const total = countRow.total;

    const stockSql = `
      SELECT 
        p.id,
        p.sku,
        p.barcode,
        p.name,
        p.unit,
        p.purchase_price,
        p.selling_price,
        p.min_stock_level,
        p.current_stock,
        (p.current_stock * p.purchase_price) as total_cost_value,
        (p.current_stock * p.selling_price) as total_retail_value,
        (p.current_stock <= p.min_stock_level) as is_low_stock,
        c.name as category_name,
        b.name as brand_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN brands b ON p.brand_id = b.id
      ${joinWh}
      ${whereClause}
      ORDER BY is_low_stock DESC, p.current_stock ASC
      LIMIT ? OFFSET ?
    `;

    const products = await query(stockSql, [...params, limit, offset]);

    // Fetch warehouse distribution for these products
    if (products.length > 0) {
      const productIds = products.map(p => p.id);
      const whDistribution = await query(`
        SELECT ws.product_id, ws.warehouse_id, ws.quantity, w.name as warehouse_name
        FROM warehouse_stock ws
        JOIN warehouses w ON ws.warehouse_id = w.id
        WHERE ws.product_id IN (${productIds.join(',')})
      `);

      const map = {};
      for (const row of whDistribution) {
        if (!map[row.product_id]) map[row.product_id] = [];
        map[row.product_id].push({
          warehouse_id: row.warehouse_id,
          warehouse_name: row.warehouse_name,
          quantity: row.quantity
        });
      }

      for (const prod of products) {
        prod.warehouses = map[prod.id] || [];
      }
    }

    // Overall summary metrics
    const [summary] = await query(`
      SELECT 
        COALESCE(SUM(current_stock), 0) as total_quantity,
        COALESCE(SUM(current_stock * purchase_price), 0) as total_cost_value,
        COALESCE(SUM(current_stock * selling_price), 0) as total_retail_value,
        COUNT(CASE WHEN current_stock <= min_stock_level THEN 1 END) as low_stock_count
      FROM products
      WHERE status = 'active'
    `);

    return success(res, {
      summary,
      products,
      pagination: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit)
      }
    }, 'Stock overview fetched');
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/stock/movements
 * Complete history of inventory movements
 */
async function getStockMovements(req, res, next) {
  try {
    const {
      product_id,
      warehouse_id,
      movement_type,
      start_date,
      end_date
    } = req.query;

    const { page, limit, offset } = parsePagination(req.query, 25, 100);
    const params = [];
    const where = [];

    if (product_id) {
      where.push('sm.product_id = ?');
      params.push(product_id);
    }

    if (warehouse_id) {
      where.push('sm.warehouse_id = ?');
      params.push(warehouse_id);
    }

    if (movement_type) {
      where.push('sm.movement_type = ?');
      params.push(movement_type);
    }

    if (start_date) {
      where.push('DATE(sm.created_at) >= ?');
      params.push(start_date);
    }

    if (end_date) {
      where.push('DATE(sm.created_at) <= ?');
      params.push(end_date);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const [countRow] = await query(`
      SELECT COUNT(*) as total 
      FROM stock_movements sm 
      ${whereClause}
    `, params);
    const total = countRow.total;

    const dataSql = `
      SELECT 
        sm.*,
        p.name as product_name,
        p.sku as product_sku,
        p.unit as product_unit,
        w.name as warehouse_name,
        u.name as user_name
      FROM stock_movements sm
      JOIN products p ON sm.product_id = p.id
      JOIN warehouses w ON sm.warehouse_id = w.id
      LEFT JOIN users u ON sm.user_id = u.id
      ${whereClause}
      ORDER BY sm.id DESC
      LIMIT ? OFFSET ?
    `;

    const movements = await query(dataSql, [...params, limit, offset]);

    return success(res, {
      movements,
      pagination: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit)
      }
    }, 'Stock movements fetched');
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/stock/low
 * Low stock alerts
 */
async function getLowStockAlerts(req, res, next) {
  try {
    const rows = await query(`
      SELECT 
        p.id,
        p.sku,
        p.barcode,
        p.name,
        p.current_stock,
        p.min_stock_level,
        p.unit,
        p.purchase_price,
        p.selling_price,
        c.name as category_name,
        w.name as default_warehouse_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN warehouses w ON p.default_warehouse_id = w.id
      WHERE p.status = 'active' AND p.current_stock <= p.min_stock_level
      ORDER BY (p.current_stock - p.min_stock_level) ASC
    `);

    return success(res, rows, 'Low stock alerts fetched');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getStockOverview,
  getStockMovements,
  getLowStockAlerts
};
