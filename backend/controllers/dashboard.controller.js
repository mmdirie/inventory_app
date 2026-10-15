const { query } = require('../config/db');
const { success } = require('../utils/response');

async function getDashboardStats(req, res, next) {
  try {
    // 1. Basic Counts
    const [pCount] = await query('SELECT COUNT(*) as total FROM products WHERE status = "active"');
    const [cCount] = await query('SELECT COUNT(*) as total FROM categories WHERE status = "active"');
    const [custCount] = await query('SELECT COUNT(*) as total FROM customers WHERE status = "active"');
    const [supCount] = await query('SELECT COUNT(*) as total FROM suppliers WHERE status = "active"');
    const [whCount] = await query('SELECT COUNT(*) as total FROM warehouses WHERE status = "active"');

    // 2. Sales Totals
    const [salesTot] = await query(`
      SELECT 
        COUNT(*) as total_count,
        COALESCE(SUM(total), 0) as total_amount,
        COALESCE(SUM(paid_amount), 0) as total_paid
      FROM sales
    `);

    // 3. Today's Sales
    const [todaySales] = await query(`
      SELECT 
        COUNT(*) as count,
        COALESCE(SUM(total), 0) as amount
      FROM sales 
      WHERE sale_date = CURDATE()
    `);

    // 4. Purchase Totals
    const [purchTot] = await query(`
      SELECT 
        COUNT(*) as total_count,
        COALESCE(SUM(total), 0) as total_amount,
        COALESCE(SUM(paid_amount), 0) as total_paid
      FROM purchases
    `);

    // 5. Today's Purchases
    const [todayPurch] = await query(`
      SELECT 
        COUNT(*) as count,
        COALESCE(SUM(total), 0) as amount
      FROM purchases 
      WHERE purchase_date = CURDATE()
    `);

    // 6. Expenses
    const [expTot] = await query('SELECT COALESCE(SUM(amount), 0) as total FROM expenses');

    // 7. Debts (Customer & Supplier)
    const [custDebt] = await query('SELECT COALESCE(SUM(remaining_amount), 0) as total FROM debts WHERE debt_type = "Customer" AND status IN ("Pending", "Partially Paid", "Overdue")');
    const [supDebt] = await query('SELECT COALESCE(SUM(remaining_amount), 0) as total FROM debts WHERE debt_type = "Supplier" AND status IN ("Pending", "Partially Paid", "Overdue")');

    // 8. Stock Value (Calculated: current_stock * purchase_price)
    const [stockVal] = await query(`
      SELECT 
        COALESCE(SUM(current_stock * purchase_price), 0) as total_cost_value,
        COALESCE(SUM(current_stock * selling_price), 0) as total_retail_value,
        COALESCE(SUM(current_stock), 0) as total_units
      FROM products 
      WHERE status = "active"
    `);

    // 9. Low Stock Products (current_stock <= min_stock_level)
    const lowStockItems = await query(`
      SELECT 
        p.id, p.sku, p.name, p.current_stock, p.min_stock_level, p.unit,
        c.name as category_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.status = "active" AND p.current_stock <= p.min_stock_level
      ORDER BY (p.current_stock - p.min_stock_level) ASC
      LIMIT 10
    `);

    // 10. Recent Sales
    const recentSales = await query(`
      SELECT 
        s.id, s.invoice_number, s.sale_date, s.total, s.payment_status, s.payment_method,
        COALESCE(c.name, 'Walk-in Customer') as customer_name
      FROM sales s
      LEFT JOIN customers c ON s.customer_id = c.id
      ORDER BY s.id DESC
      LIMIT 5
    `);

    // 11. Recent Purchases
    const recentPurchases = await query(`
      SELECT 
        p.id, p.invoice_number, p.purchase_date, p.total, p.payment_status,
        s.name as supplier_name
      FROM purchases p
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      ORDER BY p.id DESC
      LIMIT 5
    `);

    // 12. Recent Payments
    const recentPayments = await query(`
      SELECT 
        id, reference_number, payment_type, party_name, amount, payment_method, payment_date
      FROM payments
      ORDER BY id DESC
      LIMIT 5
    `);

    // 13. Last 7 Days Sales & Purchases Chart Data
    const chartDays = await query(`
      SELECT 
        d.date,
        COALESCE(s.sales_amount, 0) as sales,
        COALESCE(p.purchases_amount, 0) as purchases
      FROM (
        SELECT CURDATE() - INTERVAL (a.a + (10 * b.a)) DAY as date
        FROM (SELECT 0 as a UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6) as a
        CROSS JOIN (SELECT 0 as a) as b
      ) d
      LEFT JOIN (
        SELECT sale_date, SUM(total) as sales_amount 
        FROM sales 
        WHERE sale_date >= CURDATE() - INTERVAL 6 DAY 
        GROUP BY sale_date
      ) s ON d.date = s.sale_date
      LEFT JOIN (
        SELECT purchase_date, SUM(total) as purchases_amount 
        FROM purchases 
        WHERE purchase_date >= CURDATE() - INTERVAL 6 DAY 
        GROUP BY purchase_date
      ) p ON d.date = p.purchase_date
      ORDER BY d.date ASC
    `);

    // Profit calculation: Revenue (Total Sales) - Total Expenses - (Cost of Goods sold or Purchases)
    const totalRevenue = Number(salesTot.total_amount);
    const totalExpenses = Number(expTot.total);
    const totalPurchases = Number(purchTot.total_amount);

    return success(res, {
      counts: {
        products: pCount.total,
        categories: cCount.total,
        customers: custCount.total,
        suppliers: supCount.total,
        warehouses: whCount.total
      },
      sales: {
        total_count: salesTot.total_count,
        total_amount: totalRevenue,
        total_paid: Number(salesTot.total_paid),
        today_count: todaySales.count,
        today_amount: Number(todaySales.amount)
      },
      purchases: {
        total_count: purchTot.total_count,
        total_amount: totalPurchases,
        total_paid: Number(purchTot.total_paid),
        today_count: todayPurch.count,
        today_amount: Number(todayPurch.amount)
      },
      finance: {
        total_revenue: totalRevenue,
        total_expenses: totalExpenses,
        net_margin: totalRevenue - totalExpenses,
        customer_debt: Number(custDebt.total),
        supplier_debt: Number(supDebt.total)
      },
      stock: {
        total_units: Number(stockVal.total_units),
        stock_cost_value: Number(stockVal.total_cost_value),
        stock_retail_value: Number(stockVal.total_retail_value),
        low_stock_count: lowStockItems.length,
        low_stock_items: lowStockItems
      },
      recent_sales: recentSales,
      recent_purchases: recentPurchases,
      recent_payments: recentPayments,
      chart_data: chartDays
    }, 'Dashboard stats fetched successfully');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getDashboardStats
};
