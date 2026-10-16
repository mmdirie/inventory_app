const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
require('dotenv').config();

function getAdminConfiguration() {
  const name = (process.env.SEED_ADMIN_NAME || '').trim();
  const email = (process.env.SEED_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || '';
  if (!name) {
    throw new Error('Set SEED_ADMIN_NAME before bootstrapping the first administrator.');
  }
  if (!/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/.test(email)) {
    throw new Error('Set a valid SEED_ADMIN_EMAIL before bootstrapping the first administrator.');
  }
  if (password.length < 12) {
    throw new Error('SEED_ADMIN_PASSWORD must contain at least 12 characters.');
  }
  return { name, email, password };
}

async function runSeed() {
  const admin = getAdminConfiguration();
  const passwordHash = await bcrypt.hash(admin.password, 10);
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'inventory_management'
  });

  let lockAcquired = false;
  let transactionStarted = false;
  try {
    const [lockRows] = await connection.query("SELECT GET_LOCK('inventory_app_seed', 30) AS acquired");
    lockAcquired = Boolean(lockRows[0] && Number(lockRows[0].acquired) === 1);
    if (!lockAcquired) {
      throw new Error('Could not acquire the database seed lock.');
    }

    const protectedTables = [
      'users', 'permissions', 'role_permissions', 'settings', 'warehouses', 'categories', 'brands', 'suppliers',
      'customers', 'products', 'warehouse_stock', 'stock_movements', 'purchases',
      'purchase_items', 'sales', 'sale_items', 'invoices', 'debts', 'payments',
      'expenses', 'stock_transfers', 'stock_transfer_items', 'stock_adjustments',
      'returns', 'return_items', 'audit_logs', 'sale_idempotency'
    ];
    for (const table of protectedTables) {
      const [rows] = await connection.query(`SELECT 1 FROM \`${table}\` LIMIT 1`);
      if (rows.length) {
        throw new Error(
          `Bootstrap refused because ${table} already contains data. ` +
          'This command only initializes a fresh database and never changes existing records.'
        );
      }
    }

    await connection.beginTransaction();
    transactionStarted = true;

    const permissions = [
      ['dashboard.view', 'View dashboard metrics and analytics'],
      ['products.view', 'View product catalog'],
      ['products.create', 'Create new products'],
      ['products.update', 'Edit product details'],
      ['products.delete', 'Deactivate or delete products'],
      ['categories.view', 'View product categories'],
      ['categories.manage', 'Manage product categories'],
      ['brands.view', 'View product brands'],
      ['brands.manage', 'Manage product brands'],
      ['warehouses.view', 'View warehouse facilities'],
      ['warehouses.manage', 'Manage warehouses and locations'],
      ['suppliers.view', 'View suppliers'],
      ['suppliers.manage', 'Manage suppliers and balances'],
      ['customers.view', 'View customer list'],
      ['customers.manage', 'Manage customers and credit limits'],
      ['purchases.view', 'View purchase orders'],
      ['purchases.create', 'Create new purchase orders and receive stock'],
      ['sales.view', 'View sales records'],
      ['sales.create', 'Create sales and operate POS terminal'],
      ['stock.view', 'View inventory and movements'],
      ['stock.adjust', 'Perform stock adjustments'],
      ['stock.transfer', 'Initiate and manage warehouse transfers'],
      ['returns.view', 'View customer and supplier returns'],
      ['returns.create', 'Process returns and inventory reversals'],
      ['expenses.view', 'View business expenses'],
      ['expenses.manage', 'Create and manage expenses'],
      ['payments.view', 'View financial payments'],
      ['payments.manage', 'Process customer and supplier payments'],
      ['invoices.view', 'View and print sales invoices'],
      ['debts.view', 'View customer and supplier outstanding debts'],
      ['debts.manage', 'Collect and settle debts'],
      ['reports.view', 'Access sales, inventory, and financial reports'],
      ['users.manage', 'Create, edit, and deactivate user accounts'],
      ['settings.manage', 'Update organization and business configuration']
    ];

    for (const [name, description] of permissions) {
      await connection.execute(
        'INSERT INTO permissions (name, description) VALUES (?, ?)',
        [name, description]
      );
      await connection.execute(
        'INSERT INTO role_permissions (role, permission) VALUES (?, ?)',
        ['Admin', name]
      );
    }

    const managerPermissions = permissions
      .map(([name]) => name)
      .filter(name => !name.startsWith('users.') && !name.startsWith('settings.'));
    const salesPermissions = [
      'dashboard.view', 'products.view', 'customers.view', 'customers.manage',
      'categories.view', 'warehouses.view', 'sales.view', 'sales.create', 'invoices.view', 'returns.view',
      'returns.create', 'debts.view'
    ];
    const inventoryPermissions = [
      'dashboard.view', 'products.view', 'products.create', 'products.update',
      'categories.view', 'brands.view', 'warehouses.view', 'purchases.view',
      'purchases.create', 'stock.view', 'stock.adjust', 'stock.transfer',
      'suppliers.view', 'reports.view'
    ];
    const accountantPermissions = [
      'dashboard.view', 'sales.view', 'purchases.view', 'expenses.view',
      'expenses.manage', 'payments.view', 'payments.manage', 'invoices.view',
      'debts.view', 'debts.manage', 'reports.view'
    ];
    for (const [role, rolePermissions] of [
      ['Manager', managerPermissions],
      ['Sales', salesPermissions],
      ['Inventory', inventoryPermissions],
      ['Accountant', accountantPermissions]
    ]) {
      for (const permission of rolePermissions) {
        await connection.execute(
          'INSERT INTO role_permissions (role, permission) VALUES (?, ?)',
          [role, permission]
        );
      }
    }

    await connection.execute(
      'INSERT INTO users (name, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?)',
      [admin.name, admin.email, passwordHash, 'Admin', 'active']
    );

    await connection.execute(`
      INSERT INTO settings (
        business_name, currency, currency_symbol_position, tax_rate,
        invoice_prefix, purchase_prefix, invoice_number_format, date_format,
        timezone, low_stock_threshold
      ) VALUES (?, '$', 'before', 0, 'INV-', 'PO-', 'PREFIX-YEAR-SEQ', 'YYYY-MM-DD', 'UTC', 10)
    `, [process.env.BUSINESS_NAME && process.env.BUSINESS_NAME.trim() || 'My Business']);

    await connection.commit();
    transactionStarted = false;
    console.log('Fresh database initialized with role permissions, one administrator, and default settings.');
    console.log('No sample customers, suppliers, products, inventory, or transactions were inserted.');
  } catch (err) {
    if (transactionStarted) {
      await connection.rollback();
    }
    throw err;
  } finally {
    if (lockAcquired) {
      await connection.query("SELECT RELEASE_LOCK('inventory_app_seed')");
    }
    await connection.end();
  }
}

if (require.main === module) {
  runSeed().catch(err => {
    console.error('Database bootstrap failed:', err.message);
    process.exitCode = 1;
  });
}

module.exports = runSeed;
