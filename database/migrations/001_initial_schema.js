const fs = require('fs');
const path = require('path');

const expectedTables = [
  'users', 'permissions', 'role_permissions', 'settings', 'categories', 'brands',
  'warehouses', 'suppliers', 'customers', 'products', 'warehouse_stock',
  'stock_movements', 'purchases', 'purchase_items', 'sales', 'sale_items',
  'invoices', 'debts', 'payments', 'expenses', 'stock_transfers',
  'stock_transfer_items', 'stock_adjustments', 'returns', 'return_items', 'audit_logs'
];

async function up(connection) {
  const [rows] = await connection.execute(`
    SELECT TABLE_NAME
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
  `);
  const existing = new Set(rows.map(row => row.TABLE_NAME).filter(table => table !== 'schema_migrations'));

  if (existing.size === 0) {
    const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
    await connection.query(schema);
    return;
  }

  const missing = expectedTables.filter(table => !existing.has(table));
  if (missing.length) {
    throw new Error(
      `Cannot baseline this partially initialized database: missing tables ${missing.join(', ')}. ` +
      'No existing tables or records were altered; reconcile this schema manually before migrating.'
    );
  }

  console.log('Existing application tables detected; recording the initial baseline without changing their data.');
}

module.exports = { up };
