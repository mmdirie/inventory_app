const { query } = require('../config/db');
const { success, error } = require('../utils/response');
const { parsePagination } = require('../validators/input.validator');

/**
 * GET /api/invoices
 */
async function getAllInvoices(req, res, next) {
  try {
    const { search, status, start_date, end_date } = req.query;
    const { page, limit, offset } = parsePagination(req.query, 20, 100);
    const params = [];
    const where = [];

    if (search && search.trim() !== '') {
      where.push('(inv.invoice_number LIKE ? OR c.name LIKE ?)');
      params.push(`%${search.trim()}%`, `%${search.trim()}%`);
    }

    if (status) {
      where.push('inv.status = ?');
      params.push(status);
    }

    if (start_date) {
      where.push('inv.invoice_date >= ?');
      params.push(start_date);
    }

    if (end_date) {
      where.push('inv.invoice_date <= ?');
      params.push(end_date);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const [countRow] = await query(`
      SELECT COUNT(*) as total 
      FROM invoices inv 
      LEFT JOIN customers c ON inv.customer_id = c.id 
      ${whereClause}
    `, params);
    const total = countRow.total;

    const dataSql = `
      SELECT 
        inv.*,
        COALESCE(c.name, 'Walk-in Customer') as customer_name,
        c.phone as customer_phone,
        c.email as customer_email,
        s.payment_method
      FROM invoices inv
      LEFT JOIN customers c ON inv.customer_id = c.id
      LEFT JOIN sales s ON inv.sale_id = s.id
      ${whereClause}
      ORDER BY inv.id DESC
      LIMIT ? OFFSET ?
    `;

    const invoices = await query(dataSql, [...params, limit, offset]);

    return success(res, {
      invoices,
      pagination: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit)
      }
    }, 'Invoices fetched successfully');
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/invoices/:id
 */
async function getInvoiceById(req, res, next) {
  try {
    const { id } = req.params;
    const rows = await query(`
      SELECT 
        inv.*,
        COALESCE(c.name, 'Walk-in Customer') as customer_name,
        c.phone as customer_phone,
        c.email as customer_email,
        c.address as customer_address,
        c.city as customer_city,
        s.payment_method,
        s.warehouse_id,
        w.name as warehouse_name,
        u.name as cashier_name
      FROM invoices inv
      LEFT JOIN customers c ON inv.customer_id = c.id
      LEFT JOIN sales s ON inv.sale_id = s.id
      LEFT JOIN warehouses w ON s.warehouse_id = w.id
      LEFT JOIN users u ON s.created_by = u.id
      WHERE inv.id = ? OR inv.invoice_number = ?
    `, [id, id]);

    if (!rows || rows.length === 0) {
      return error(res, 'Invoice not found', 404);
    }

    const invoice = rows[0];

    // Fetch sale items
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
    `, [invoice.sale_id]);
    invoice.items = items;

    // Fetch business settings for invoice header / receipt footer
    const [settings] = await query('SELECT * FROM settings LIMIT 1');
    invoice.business = settings || {};

    return success(res, invoice, 'Invoice details');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getAllInvoices,
  getInvoiceById
};
