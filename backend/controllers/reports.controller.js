const { query } = require('../config/db');
const { success, error } = require('../utils/response');

/**
 * GET /api/reports/sales
 * Aggregated sales reporting
 */
async function getSalesReports(req, res, next) {
  try {
    const { start_date, end_date, group_by = 'date' } = req.query;
    const params = [];
    const where = [];

    if (start_date) {
      where.push('s.sale_date >= ?');
      params.push(start_date);
    }

    if (end_date) {
      where.push('s.sale_date <= ?');
      params.push(end_date);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    // 1. Overall Summary
    const [summary] = await query(`
      SELECT 
        COUNT(DISTINCT s.id) as total_sales_count,
        COALESCE(SUM(s.subtotal), 0) as total_subtotal,
        COALESCE(SUM(s.discount), 0) as total_discount,
        COALESCE(SUM(s.tax), 0) as total_tax,
        COALESCE(SUM(s.total), 0) as total_revenue,
        COALESCE(SUM(s.paid_amount), 0) as total_collected,
        COALESCE(SUM(s.remaining_amount), 0) as total_credit_due
      FROM sales s
      ${whereClause}
    `, params);

    // 2. Grouped Breakdown
    let breakdownSql = '';
    if (group_by === 'product') {
      breakdownSql = `
        SELECT 
          p.id as product_id,
          p.name as product_name,
          p.sku as product_sku,
          c.name as category_name,
          COALESCE(SUM(si.quantity), 0) as total_units_sold,
          COALESCE(SUM(si.total), 0) as total_revenue
        FROM sale_items si
        JOIN sales s ON si.sale_id = s.id
        JOIN products p ON si.product_id = p.id
        LEFT JOIN categories c ON p.category_id = c.id
        ${whereClause}
        GROUP BY p.id
        ORDER BY total_revenue DESC
      `;
    } else if (group_by === 'customer') {
      breakdownSql = `
        SELECT 
          COALESCE(c.id, 0) as customer_id,
          COALESCE(c.name, 'Walk-in Retail Customer') as customer_name,
          COALESCE(c.phone, '-') as customer_phone,
          COUNT(s.id) as total_orders,
          COALESCE(SUM(s.total), 0) as total_revenue,
          COALESCE(SUM(s.paid_amount), 0) as total_paid,
          COALESCE(SUM(s.remaining_amount), 0) as total_debt
        FROM sales s
        LEFT JOIN customers c ON s.customer_id = c.id
        ${whereClause}
        GROUP BY c.id, c.name, c.phone
        ORDER BY total_revenue DESC
      `;
    } else if (group_by === 'user') {
      breakdownSql = `
        SELECT 
          u.id as user_id,
          u.name as staff_name,
          u.role as staff_role,
          COUNT(s.id) as total_sales_count,
          COALESCE(SUM(s.total), 0) as total_revenue
        FROM sales s
        LEFT JOIN users u ON s.created_by = u.id
        ${whereClause}
        GROUP BY u.id, u.name, u.role
        ORDER BY total_revenue DESC
      `;
    } else if (group_by === 'month') {
      breakdownSql = `
        SELECT 
          DATE_FORMAT(s.sale_date, '%Y-%m') as period,
          COUNT(s.id) as total_orders,
          COALESCE(SUM(s.total), 0) as total_revenue,
          COALESCE(SUM(s.paid_amount), 0) as total_collected
        FROM sales s
        ${whereClause}
        GROUP BY DATE_FORMAT(s.sale_date, '%Y-%m')
        ORDER BY period DESC
      `;
    } else {
      // Default: By Date
      breakdownSql = `
        SELECT 
          s.sale_date as period,
          COUNT(s.id) as total_orders,
          COALESCE(SUM(s.total), 0) as total_revenue,
          COALESCE(SUM(s.paid_amount), 0) as total_collected,
          COALESCE(SUM(s.remaining_amount), 0) as total_credit
        FROM sales s
        ${whereClause}
        GROUP BY s.sale_date
        ORDER BY s.sale_date DESC
      `;
    }

    const breakdown = await query(breakdownSql, params);

    return success(res, {
      summary,
      group_by,
      breakdown
    }, 'Sales report generated');
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/reports/purchases
 */
async function getPurchaseReports(req, res, next) {
  try {
    const { start_date, end_date, group_by = 'date' } = req.query;
    const params = [];
    const where = [];

    if (start_date) {
      where.push('p.purchase_date >= ?');
      params.push(start_date);
    }

    if (end_date) {
      where.push('p.purchase_date <= ?');
      params.push(end_date);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const [summary] = await query(`
      SELECT 
        COUNT(DISTINCT p.id) as total_purchases_count,
        COALESCE(SUM(p.subtotal), 0) as total_subtotal,
        COALESCE(SUM(p.total), 0) as total_cost,
        COALESCE(SUM(p.paid_amount), 0) as total_paid,
        COALESCE(SUM(p.remaining_amount), 0) as total_payable
      FROM purchases p
      ${whereClause}
    `, params);

    let breakdownSql = '';
    if (group_by === 'supplier') {
      breakdownSql = `
        SELECT 
          s.id as supplier_id,
          s.name as supplier_name,
          s.company as supplier_company,
          COUNT(p.id) as total_orders,
          COALESCE(SUM(p.total), 0) as total_cost,
          COALESCE(SUM(p.paid_amount), 0) as total_paid,
          COALESCE(SUM(p.remaining_amount), 0) as total_remaining
        FROM purchases p
        JOIN suppliers s ON p.supplier_id = s.id
        ${whereClause}
        GROUP BY s.id, s.name, s.company
        ORDER BY total_cost DESC
      `;
    } else if (group_by === 'product') {
      breakdownSql = `
        SELECT 
          prod.id as product_id,
          prod.name as product_name,
          prod.sku as product_sku,
          COALESCE(SUM(pi.quantity), 0) as total_units_purchased,
          COALESCE(SUM(pi.total), 0) as total_expenditure
        FROM purchase_items pi
        JOIN purchases p ON pi.purchase_id = p.id
        JOIN products prod ON pi.product_id = prod.id
        ${whereClause}
        GROUP BY prod.id
        ORDER BY total_expenditure DESC
      `;
    } else {
      breakdownSql = `
        SELECT 
          p.purchase_date as period,
          COUNT(p.id) as total_orders,
          COALESCE(SUM(p.total), 0) as total_cost,
          COALESCE(SUM(p.paid_amount), 0) as total_paid,
          COALESCE(SUM(p.remaining_amount), 0) as total_remaining
        FROM purchases p
        ${whereClause}
        GROUP BY p.purchase_date
        ORDER BY p.purchase_date DESC
      `;
    }

    const breakdown = await query(breakdownSql, params);

    return success(res, {
      summary,
      group_by,
      breakdown
    }, 'Purchase report generated');
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/reports/inventory
 */
async function getInventoryReports(req, res, next) {
  try {
    const { warehouse_id } = req.query;

    // Overall valuation
    const [valuation] = await query(`
      SELECT 
        COUNT(*) as total_items,
        COALESCE(SUM(current_stock), 0) as total_stock_units,
        COALESCE(SUM(current_stock * purchase_price), 0) as total_cost_value,
        COALESCE(SUM(current_stock * selling_price), 0) as total_retail_value,
        COALESCE(SUM(current_stock * (selling_price - purchase_price)), 0) as estimated_current_inventory_price_spread
      FROM products
      WHERE status = 'active'
    `);

    // Stock by category
    const categoryBreakdown = await query(`
      SELECT 
        c.name as category_name,
        COUNT(p.id) as product_count,
        COALESCE(SUM(p.current_stock), 0) as total_units,
        COALESCE(SUM(p.current_stock * p.purchase_price), 0) as total_cost_value
      FROM categories c
      LEFT JOIN products p ON c.id = p.category_id AND p.status = 'active'
      GROUP BY c.id
      ORDER BY total_cost_value DESC
    `);

    // Stock by warehouse
    const warehouseBreakdown = await query(`
      SELECT 
        w.id,
        w.name as warehouse_name,
        w.location,
        COUNT(DISTINCT ws.product_id) as product_count,
        COALESCE(SUM(ws.quantity), 0) as total_units,
        COALESCE(SUM(ws.quantity * p.purchase_price), 0) as warehouse_stock_value
      FROM warehouses w
      LEFT JOIN warehouse_stock ws ON w.id = ws.warehouse_id
      LEFT JOIN products p ON ws.product_id = p.id
      WHERE w.status = 'active'
      GROUP BY w.id
    `);

    // Low stock items
    const lowStockItems = await query(`
      SELECT 
        p.id, p.name, p.sku, p.current_stock, p.min_stock_level, p.unit,
        c.name as category_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.status = 'active' AND p.current_stock <= p.min_stock_level
      ORDER BY (p.current_stock - p.min_stock_level) ASC
    `);

    return success(res, {
      valuation,
      category_breakdown: categoryBreakdown,
      warehouse_breakdown: warehouseBreakdown,
      low_stock_items: lowStockItems
    }, 'Inventory report generated');
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/reports/financial
 */
async function getFinancialReports(req, res, next) {
  try {
    const { start_date, end_date } = req.query;
    const params = [];
    const dateFilterSales = [];
    const dateFilterPurch = [];
    const dateFilterExp = [];

    if (start_date) {
      dateFilterSales.push('sale_date >= ?');
      dateFilterPurch.push('purchase_date >= ?');
      dateFilterExp.push('expense_date >= ?');
      params.push(start_date);
    }
    if (end_date) {
      dateFilterSales.push('sale_date <= ?');
      dateFilterPurch.push('purchase_date <= ?');
      dateFilterExp.push('expense_date <= ?');
      params.push(end_date);
    }

    const whereSales = dateFilterSales.length > 0 ? `WHERE ${dateFilterSales.join(' AND ')}` : '';
    const wherePurch = dateFilterPurch.length > 0 ? `WHERE ${dateFilterPurch.join(' AND ')}` : '';
    const whereExp = dateFilterExp.length > 0 ? `WHERE ${dateFilterExp.join(' AND ')}` : '';

    const [salesRow] = await query(`SELECT COALESCE(SUM(total), 0) as total_sales, COALESCE(SUM(paid_amount), 0) as collected FROM sales ${whereSales}`, params);
    const [purchRow] = await query(`SELECT COALESCE(SUM(total), 0) as total_purchases, COALESCE(SUM(paid_amount), 0) as paid_purchases FROM purchases ${wherePurch}`, params);
    const [expRow] = await query(`SELECT COALESCE(SUM(amount), 0) as total_expenses FROM expenses ${whereExp}`, params);

    // Debts
    const [custDebt] = await query('SELECT COALESCE(SUM(remaining_amount), 0) as total FROM debts WHERE debt_type = "Customer" AND status != "Paid"');
    const [supDebt] = await query('SELECT COALESCE(SUM(remaining_amount), 0) as total FROM debts WHERE debt_type = "Supplier" AND status != "Paid"');

    const totalRevenue = Number(salesRow.total_sales);
    const totalExpenses = Number(expRow.total_expenses);
    const totalPurchases = Number(purchRow.total_purchases);
    return success(res, {
      revenue: totalRevenue,
      expenses: totalExpenses,
      purchases: totalPurchases,
      profit: null,
      profit_status: 'unavailable',
      profit_note: 'Profit is not calculated: sale lines do not store historical cost, so current product purchase prices cannot reliably represent cost of goods sold.',
      collected_cash: Number(salesRow.collected),
      disbursed_purchases: Number(purchRow.paid_purchases),
      customer_debt_receivable: Number(custDebt.total),
      supplier_debt_payable: Number(supDebt.total)
    }, 'Financial report generated');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getSalesReports,
  getPurchaseReports,
  getInventoryReports,
  getFinancialReports
};
