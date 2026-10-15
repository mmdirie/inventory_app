const { query } = require('../config/db');
const { success, error } = require('../utils/response');
const { logAction } = require('../utils/logger');

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

    const existing = await query('SELECT id FROM settings LIMIT 1');
    if (existing.length === 0) {
      await query(`
        INSERT INTO settings (
          business_name, business_logo, phone, email, address,
          currency, currency_symbol_position, tax_rate, invoice_prefix, purchase_prefix,
          invoice_number_format, date_format, timezone, low_stock_threshold, receipt_footer
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        business_name || 'Apex Commercial Supplies Ltd',
        business_logo || '',
        phone || null,
        email || null,
        address || null,
        currency || '$',
        currency_symbol_position || 'before',
        parseFloat(tax_rate) || 0,
        invoice_prefix || 'INV-',
        purchase_prefix || 'PO-',
        invoice_number_format || 'PREFIX-YEAR-SEQ',
        date_format || 'YYYY-MM-DD',
        timezone || 'UTC',
        parseInt(low_stock_threshold, 10) || 10,
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
        tax_rate !== undefined ? parseFloat(tax_rate) : null,
        invoice_prefix || null,
        purchase_prefix || null,
        invoice_number_format || null,
        date_format || null,
        timezone || null,
        low_stock_threshold !== undefined ? parseInt(low_stock_threshold, 10) : null,
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
