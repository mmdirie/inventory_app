const { query } = require('../config/db');
const { success, error } = require('../utils/response');

/**
 * GET /api/barcode/lookup/:code
 */
async function lookupBarcode(req, res, next) {
  try {
    const { code } = req.params;
    const rows = await query(`
      SELECT 
        p.*,
        c.name as category_name,
        b.name as brand_name,
        w.name as default_warehouse_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN brands b ON p.brand_id = b.id
      LEFT JOIN warehouses w ON p.default_warehouse_id = w.id
      WHERE (p.barcode = ? OR p.sku = ?) AND p.status = 'active'
      LIMIT 1
    `, [code, code]);

    if (!rows || rows.length === 0) {
      return error(res, `No active product found with barcode or SKU: ${code}`, 404);
    }

    const product = rows[0];
    const warehouseStock = await query(`
      SELECT ws.warehouse_id, ws.quantity, w.name as warehouse_name
      FROM warehouse_stock ws
      JOIN warehouses w ON ws.warehouse_id = w.id
      WHERE ws.product_id = ?
    `, [product.id]);
    product.warehouse_stock = warehouseStock;

    return success(res, product, 'Product found via barcode');
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/barcode/generate-suggested
 * Generates an available unique EAN13 or Code128 numeric barcode string
 */
async function generateSuggestedBarcode(req, res, next) {
  try {
    let barcode;
    let exists = true;
    let attempts = 0;

    while (exists && attempts < 10) {
      attempts++;
      // Generate a 12-digit code and calculate check digit
      const random11 = '890' + Math.floor(10000000 + Math.random() * 90000000);
      let sum = 0;
      for (let i = 0; i < random11.length; i++) {
        const d = parseInt(random11[i], 10);
        sum += (i % 2 === 0) ? d : d * 3;
      }
      const checkDigit = (10 - (sum % 10)) % 10;
      barcode = `${random11}${checkDigit}`;

      const rows = await query('SELECT id FROM products WHERE barcode = ?', [barcode]);
      if (rows.length === 0) {
        exists = false;
      }
    }

    return success(res, { barcode }, 'Generated unique barcode candidate');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  lookupBarcode,
  generateSuggestedBarcode
};
