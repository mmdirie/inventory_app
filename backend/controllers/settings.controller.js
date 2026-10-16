const { query } = require('../config/db');
const { success, error } = require('../utils/response');
const { logAction } = require('../utils/logger');
const { parseStrictDecimal, parseStrictPositiveInteger } = require('../validators/input.validator');

/**
 * GET /api/settings
 */
async function getSettings(req, res, next) {
  try {
    const rows = await query('SELECT * FROM settings LIMIT 1');
    if (!rows || rows.length === 0) {
      return success(res, {}, 'Settings');
    }
    return success(res, rows[0], 'Application settings');
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/settings
 */
async function updateSettings(req, res, next) {
  try {
    const {
      business_name,
      business_logo,
      phone,
      email,
      address,
      currency,
      currency_symbol_position,
      tax_rate,
      invoice_prefix,
      purchase_prefix,
      invoice_number_format,
      date_format,
      timezone,
      low_stock_threshold,
      receipt_footer
    } = req.body;

    const parsedTaxRate = tax_rate === undefined ? null : parseStrictDecimal(tax_rate, { min: 0, max: 1000 });
    const parsedLowStock = low_stock_threshold === undefined ? null : parseStrictPositiveInteger(low_stock_threshold);

    if ((tax_rate !== undefined && parsedTaxRate === null) || (low_stock_threshold !== undefined && parsedLowStock === null)) {
      return error(res, 'Tax rate and low stock threshold must be valid numeric values.', 400);
    }

    const existing = await query('SELECT id FROM settings LIMIT 1');
    if (existing.length === 0) {
      await query(`
        INSERT INTO settings (
          business_name, business_logo, phone, email, address,
          currency, currency_symbol_position, tax_rate, invoice_prefix, purchase_prefix,
          invoice_number_format, date_format, timezone, low_stock_threshold, receipt_footer
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        business_name || 'My Business',
        business_logo || '',
        phone || null,
        email || null,
        address || null,
        currency || '$',
        currency_symbol_position || 'before',
        parsedTaxRate ?? 0,
        invoice_prefix || 'INV-',
        purchase_prefix || 'PO-',
        invoice_number_format || 'PREFIX-YEAR-SEQ',
        date_format || 'YYYY-MM-DD',
        timezone || 'UTC',
        parsedLowStock ?? 10,
        receipt_footer || ''
      ]);
    } else {
      await query(`
        UPDATE settings SET
          business_name = COALESCE(?, business_name),
          business_logo = COALESCE(?, business_logo),
          phone = COALESCE(?, phone),
          email = COALESCE(?, email),
          address = COALESCE(?, address),
          currency = COALESCE(?, currency),
          currency_symbol_position = COALESCE(?, currency_symbol_position),
          tax_rate = COALESCE(?, tax_rate),
          invoice_prefix = COALESCE(?, invoice_prefix),
          purchase_prefix = COALESCE(?, purchase_prefix),
          invoice_number_format = COALESCE(?, invoice_number_format),
          date_format = COALESCE(?, date_format),
          timezone = COALESCE(?, timezone),
          low_stock_threshold = COALESCE(?, low_stock_threshold),
          receipt_footer = COALESCE(?, receipt_footer)
        WHERE id = ?
      `, [
        business_name || null,
        business_logo || null,
        phone || null,
        email || null,
        address || null,
        currency || null,
        currency_symbol_position || null,
        parsedTaxRate,
        invoice_prefix || null,
        purchase_prefix || null,
        invoice_number_format || null,
        date_format || null,
        timezone || null,
        parsedLowStock,
        receipt_footer || null,
        existing[0].id
      ]);
    }

    await logAction({
      userId: req.user ? req.user.id : null,
      userName: req.user ? req.user.name : 'System',
      action: 'Update Settings',
      module: 'Settings',
      details: 'Business organization configuration parameters updated.',
      ip: req.ip
    });

    const [updated] = await query('SELECT * FROM settings LIMIT 1');
    return success(res, updated, 'Business settings updated successfully');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getSettings,
  updateSettings
};
