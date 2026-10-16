const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const test = require('node:test');
require('dotenv').config();

const projectRoot = path.join(__dirname, '..');
const testDatabaseBase = process.env.TEST_DB_NAME || '';
const configuredDatabase = process.env.DB_NAME || 'inventory_management';
const testDatabaseAllowed =
  /^inventory_app_test_[a-zA-Z0-9_]+$/.test(testDatabaseBase) &&
  testDatabaseBase.length <= 35 &&
  testDatabaseBase.toLowerCase() !== configuredDatabase.toLowerCase();

function databaseConnection(database) {
  return mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database
  });
}

function runDatabaseScript(script, database, extraEnv = {}) {
  const result = spawnSync(process.execPath, [script], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, DB_NAME: database, ...extraEnv }
  });
  assert.equal(
    result.status,
    0,
    `${script} failed for isolated test database:\n${result.stdout}\n${result.stderr}`
  );
}

function makeSale(customerId, warehouseId, productId, quantity, price, paidAmount) {
  return {
    customer_id: customerId,
    warehouse_id: warehouseId,
    sale_date: new Date().toISOString().slice(0, 10),
    payment_method: 'Cash',
    paid_amount: paidAmount,
    items: [{ product_id: productId, quantity, unit_price: price }]
  };
}

test('HTML escaping renders script-like input as inert text', () => {
  const source = fs.readFileSync(path.join(projectRoot, 'public', 'js', 'ui.js'), 'utf8');
  const context = {};
  const UI = vm.runInNewContext(`${source}\nUI`, context);
  const hostileValue = '<img src=x onerror="globalThis.pwned=true">';
  const rendered = UI.escape(hostileValue);

  assert.equal(rendered, '&lt;img src=x onerror=&quot;globalThis.pwned=true&quot;&gt;');
  assert.doesNotMatch(rendered, /<\s*img\b/i);
  assert.equal(context.pwned, undefined);
});

test('API client reports HTTP status when an error response is not JSON', async () => {
  const source = fs.readFileSync(path.join(projectRoot, 'public', 'js', 'api.js'), 'utf8');
  const api = vm.runInNewContext(`${source}\nAPI`, {
    localStorage: { getItem: () => null },
    URLSearchParams,
    fetch: async () => ({
      status: 502,
      ok: false,
      json: async () => { throw new SyntaxError('Unexpected token <'); }
    }),
    window: { location: { pathname: '/dashboard.html' } },
    console: { error: () => {} }
  });

  await assert.rejects(api.get('/health'), /Request failed with status 502/);
});

test('Sales History provides an authenticated Create Sale entry point', () => {
  const history = fs.readFileSync(path.join(projectRoot, 'frontend', 'sales', 'list.html'), 'utf8');
  const register = fs.readFileSync(path.join(projectRoot, 'frontend', 'sales', 'index.html'), 'utf8');

  assert.match(history, /id="create-sale-link"[^>]*href="\/sales\/index\.html"/);
  assert.match(history, /id="start-date-filter"/);
  assert.match(history, /id="end-date-filter"/);
  assert.match(history, /let salesRequestId = 0/);
  assert.match(history, /fa-cash-register mr-2[^<]*<\/i>\s*Create Sale/);
  assert.match(register, /async function submitSaleTransaction\(\)/);
  assert.match(register, /API\.post\('\/sales', payload, \{ 'Idempotency-Key': pendingSaleKey \}\)/);
  assert.match(register, /API\.get\(`\/barcode\/lookup\/\$\{encodeURIComponent\(code\)\}`\)/);
  assert.doesNotMatch(register, /\.catch\(\(\) => null\)/);
});

test('strict numeric parsing rejects malformed trade values before they reach the database', () => {
  const validatorPath = path.join(projectRoot, 'backend', 'validators', 'input.validator.js');
  const { parseStrictNumber, parseStrictDecimal, parseStrictPositiveInteger } = require(validatorPath);

  assert.equal(parseStrictNumber('12abc'), null);
  assert.equal(parseStrictDecimal('12abc', { min: 0 }), null);
  assert.equal(parseStrictPositiveInteger('12abc'), null);
  assert.equal(parseStrictNumber('12.50'), 12.5);
  assert.equal(parseStrictPositiveInteger('7'), 7);
});

test('suggested EAN-13 barcodes contain twelve payload digits and a valid check digit', () => {
  const { createEan13Candidate } = require('../backend/utils/barcode');
  const barcode = createEan13Candidate();
  const weightedSum = [...barcode].reduce(
    (sum, digit, index) => sum + Number(digit) * (index % 2 === 0 ? 1 : 3),
    0
  );

  assert.match(barcode, /^890\d{10}$/);
  assert.equal(barcode.length, 13);
  assert.equal(weightedSum % 10, 0);
});

test('barcode manager escapes database values in all rendered catalog views', () => {
  const source = fs.readFileSync(path.join(projectRoot, 'frontend', 'barcode', 'index.html'), 'utf8');

  assert.match(source, /UI\.escape\(p\.name\)/);
  assert.match(source, /UI\.escape\(prod\.name\)/);
  assert.match(source, /UI\.escape\(w\.warehouse_name\)/);
  assert.match(source, /UI\.escape\(err\.message/);
  assert.doesNotMatch(source, /(?:<[^>]*>|<\/[^>]*>)\$\{(?:p|prod|w)\.(?:name|sku|barcode|warehouse_name)\}/);
  assert.doesNotMatch(source, /<div class="title">\$\{subtext\}/);
});

test('isolated database migrations preserve data and transactional workflows remain consistent', {
  skip: testDatabaseAllowed
    ? false
    : 'Set TEST_DB_NAME to a distinct inventory_app_test_* database name to enable MySQL integration tests.'
}, async t => {
  const suffix = `${process.pid}_${crypto.randomBytes(4).toString('hex')}`;
  const emptyDb = `${testDatabaseBase}_${suffix}_empty`;
  const existingDb = `${testDatabaseBase}_${suffix}_existing`;
  const partialDb = `${testDatabaseBase}_${suffix}_partial`;
  const appDb = `${testDatabaseBase}_${suffix}_app`;
  const databaseNames = [emptyDb, existingDb, partialDb, appDb];
  const admin = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || ''
  });
  let server;
  let appPool;

  try {
    for (const database of databaseNames) {
      assert.ok(database.length <= 64, 'generated isolated database name exceeds MySQL limit');
      assert.match(database, /^inventory_app_test_[a-zA-Z0-9_]+$/);
      assert.notEqual(database.toLowerCase(), configuredDatabase.toLowerCase());
    }

    await t.test('empty migration creates schema and records versions', async () => {
      runDatabaseScript('database/migrate.js', emptyDb);
      const connection = await databaseConnection(emptyDb);
      try {
        const [versions] = await connection.execute(
          'SELECT version FROM schema_migrations ORDER BY version'
        );
        assert.deepEqual(versions.map(row => row.version), [
          '001_initial_schema.js',
          '002_document_sequences.js',
          '003_return_idempotency_and_refunds.js',
          '004_revoked_tokens.js',
          '005_pos_sale_idempotency.js'
        ]);
        const [tables] = await connection.execute(
          "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales'"
        );
        assert.equal(tables.length, 1);
      } finally {
        await connection.end();
      }

      runDatabaseScript('database/seed.js', emptyDb, {
        SEED_ADMIN_NAME: 'Isolated Test Administrator',
        SEED_ADMIN_EMAIL: 'bootstrap@example.invalid',
        SEED_ADMIN_PASSWORD: 'isolated-bootstrap-password-2026'
      });
      const seeded = await databaseConnection(emptyDb);
      try {
        const [[userCount]] = await seeded.execute('SELECT COUNT(*) AS total FROM users');
        const [[permissionCount]] = await seeded.execute('SELECT COUNT(*) AS total FROM permissions');
        const [[settingsCount]] = await seeded.execute('SELECT COUNT(*) AS total FROM settings');
        const [[productCount]] = await seeded.execute('SELECT COUNT(*) AS total FROM products');
        const [[customerCount]] = await seeded.execute('SELECT COUNT(*) AS total FROM customers');
        const [[supplierCount]] = await seeded.execute('SELECT COUNT(*) AS total FROM suppliers');
        const [[warehouseCount]] = await seeded.execute('SELECT COUNT(*) AS total FROM warehouses');
        const [[salesCount]] = await seeded.execute('SELECT COUNT(*) AS total FROM sales');
        assert.equal(Number(userCount.total), 1);
        assert.equal(Number(permissionCount.total), 34);
        assert.equal(Number(settingsCount.total), 1);
        assert.equal(Number(productCount.total), 0);
        assert.equal(Number(customerCount.total), 0);
        assert.equal(Number(supplierCount.total), 0);
        assert.equal(Number(warehouseCount.total), 0);
        assert.equal(Number(salesCount.total), 0);
        const [posPermissions] = await seeded.execute(
          "SELECT permission FROM role_permissions WHERE role = 'Sales' AND permission IN ('categories.view', 'warehouses.view') ORDER BY permission"
        );
        assert.deepEqual(posPermissions.map(row => row.permission), ['categories.view', 'warehouses.view']);
      } finally {
        await seeded.end();
      }
    });

    await t.test('migration baselines an existing database without changing records', async () => {
      runDatabaseScript('database/setup.js', existingDb);
      const connection = await databaseConnection(existingDb);
      let categoryId;
      const migrationYear = new Date().getFullYear();
      try {
        await connection.execute(`
          ALTER TABLE payments
          MODIFY payment_type ENUM(
            'Customer Sale', 'Customer Debt', 'Supplier Purchase', 'Supplier Debt', 'Expense'
          ) NOT NULL
        `);
        await connection.execute('ALTER TABLE \`returns\` DROP INDEX uq_returns_request_key, DROP COLUMN request_key');
        await connection.execute('DROP TABLE document_sequences');
        const [insert] = await connection.execute(
          "INSERT INTO categories (name, description, status) VALUES ('Preserve Me', 'Migration fixture', 'active')"
        );
        categoryId = insert.insertId;
        const setupResult = spawnSync(process.execPath, ['database/setup.js'], {
          cwd: projectRoot,
          encoding: 'utf8',
          env: { ...process.env, DB_NAME: existingDb }
        });
        assert.notEqual(setupResult.status, 0, 'fresh setup must refuse a populated database');
        assert.match(`${setupResult.stdout}\n${setupResult.stderr}`, /Fresh setup refused/);
        await connection.execute(`
          INSERT INTO payments
            (reference_number, payment_type, party_type, party_name, amount, payment_method, payment_date)
          VALUES (?, 'Expense', 'Other', 'Legacy payment', 1, 'Cash', CURDATE())
        `, [`PAY-${migrationYear}-0042`]);
      } finally {
        await connection.end();
      }

      runDatabaseScript('database/migrate.js', existingDb);
      const verify = await databaseConnection(existingDb);
      try {
        const [rows] = await verify.execute('SELECT name, description FROM categories WHERE id = ?', [categoryId]);
        assert.deepEqual(rows, [{ name: 'Preserve Me', description: 'Migration fixture' }]);
        const [returnColumns] = await verify.execute(`
          SELECT COLUMN_NAME FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'returns' AND COLUMN_NAME = 'request_key'
        `);
        assert.equal(returnColumns.length, 1);
        const [sequenceTable] = await verify.execute(`
          SELECT TABLE_NAME FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'document_sequences'
        `);
        assert.equal(sequenceTable.length, 1);
        const [sequenceRows] = await verify.execute(
          'SELECT last_value FROM document_sequences WHERE sequence_name = ? AND sequence_year = ?',
          ['payment', migrationYear]
        );
        assert.equal(Number(sequenceRows[0].last_value), 42);
      } finally {
        await verify.end();
      }
    });

    await t.test('partial schemas stop without changing legacy records', async () => {
      await admin.query(`CREATE DATABASE \`${partialDb}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
      const partialConnection = await databaseConnection(partialDb);
      try {
        await partialConnection.execute(
          'CREATE TABLE legacy_marker (id INT PRIMARY KEY, value VARCHAR(50) NOT NULL) ENGINE=InnoDB'
        );
        await partialConnection.execute(
          "INSERT INTO legacy_marker (id, value) VALUES (1, 'Keep this row')"
        );
      } finally {
        await partialConnection.end();
      }

      const migrationResult = spawnSync(process.execPath, ['database/migrate.js'], {
        cwd: projectRoot,
        encoding: 'utf8',
        env: { ...process.env, DB_NAME: partialDb }
      });
      assert.notEqual(migrationResult.status, 0, 'partial schema migration must stop for manual reconciliation');
      assert.match(`${migrationResult.stdout}\n${migrationResult.stderr}`, /partially initialized database/);
      const verify = await databaseConnection(partialDb);
      try {
        const [[row]] = await verify.execute('SELECT value FROM legacy_marker WHERE id = 1');
        assert.equal(row.value, 'Keep this row');
        const [salesTable] = await verify.execute(`
          SELECT TABLE_NAME FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales'
        `);
        assert.equal(salesTable.length, 0);
      } finally {
        await verify.end();
      }
    });

    await t.test('sales, returns, and linked payments validate stock and balances atomically', async () => {
      runDatabaseScript('database/migrate.js', appDb);
      process.env.DB_NAME = appDb;
      process.env.NODE_ENV = 'test';
      process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');

      const app = require(path.join(projectRoot, 'backend', 'server.js'));
      const dbModule = require(path.join(projectRoot, 'backend', 'config', 'db.js'));
      appPool = dbModule.pool;
      const [poolDatabase] = await dbModule.query('SELECT DATABASE() AS database_name');
      assert.equal(poolDatabase.database_name, appDb, 'integration tests must use their isolated database');
      server = app.listen(0);
      await once(server, 'listening');
      const port = server.address().port;
      const connection = await databaseConnection(appDb);
      let customerId;
      let supplierId;
      let warehouseId;
      let saleProductId;
      let concurrentProductId;
      let creditProductId;
      let productIds;
      let token;

      try {
        await connection.execute(
          "INSERT INTO users (name, email, password_hash, role, status) VALUES ('Test Admin', 'test-admin@example.invalid', 'unused', 'Admin', 'active')"
        );
        const [[user]] = await connection.execute('SELECT id FROM users WHERE email = ?', ['test-admin@example.invalid']);
        await connection.execute(
          "INSERT INTO role_permissions (role, permission) VALUES ('Admin', 'products.create'), ('Admin', 'customers.manage'), ('Admin', 'suppliers.manage'), ('Admin', 'sales.create'), ('Admin', 'sales.view'), ('Admin', 'returns.create'), ('Admin', 'payments.manage'), ('Admin', 'debts.manage')"
        );
        await connection.execute(
          "INSERT INTO settings (business_name, tax_rate, invoice_prefix) VALUES ('Isolated Test Business', 0, 'TEST-INV-')"
        );
        token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '5m' });
        const newCustomerResponse = await fetch(`http://127.0.0.1:${port}/api/customers`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ name: 'New Test Customer' })
        });
        const newCustomerResult = await newCustomerResponse.json();
        assert.equal(newCustomerResponse.status, 201, newCustomerResult.message);
        assert.equal(newCustomerResult.data.name, 'New Test Customer');

        const newSupplierResponse = await fetch(`http://127.0.0.1:${port}/api/suppliers`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ name: 'New Test Supplier' })
        });
        const newSupplierResult = await newSupplierResponse.json();
        assert.equal(newSupplierResponse.status, 201, newSupplierResult.message);
        assert.equal(newSupplierResult.data.name, 'New Test Supplier');
        supplierId = newSupplierResult.data.id;

        const emptyStockProduct = await fetch(`http://127.0.0.1:${port}/api/products`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            sku: 'TEST-NO-WAREHOUSE',
            barcode: 'TEST-BAR-NO-WAREHOUSE',
            name: 'Product without a warehouse',
            initial_stock: 0
          })
        });
        const emptyStockResult = await emptyStockProduct.json();
        assert.equal(emptyStockProduct.status, 201, emptyStockResult.message);
        assert.equal(emptyStockResult.data.default_warehouse_id, null);

        const initialStockWithoutWarehouse = await fetch(`http://127.0.0.1:${port}/api/products`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            sku: 'TEST-STOCK-NO-WAREHOUSE',
            barcode: 'TEST-BAR-STOCK-NO-WAREHOUSE',
            name: 'Stocked product without a warehouse',
            initial_stock: 1
          })
        });
        assert.equal(initialStockWithoutWarehouse.status, 400);

        const [warehouseInsert] = await connection.execute(
          "INSERT INTO warehouses (name, location, status) VALUES ('Test Warehouse', 'Isolated test fixture', 'active')"
        );
        warehouseId = warehouseInsert.insertId;
        const [customerInsert] = await connection.execute(
          "INSERT INTO customers (name, customer_type, credit_limit, balance, status) VALUES ('Test Customer', 'Retail', 100000, 0, 'active')"
        );
        customerId = customerInsert.insertId;

        const products = [
          ['TEST-SALE', 'TEST-BAR-SALE', 'Sale Test Product', 10],
          ['TEST-CONCURRENT', 'TEST-BAR-CONCURRENT', 'Concurrent Test Product', 5],
          ['TEST-CREDIT', 'TEST-BAR-CREDIT', 'Credit Test Product', 20],
          ['TEST-UNRELATED', 'TEST-BAR-UNRELATED', 'Unrelated Test Product', 10]
        ];
        productIds = [];
        for (const [sku, barcode, name, quantity] of products) {
          const [productInsert] = await connection.execute(
            `INSERT INTO products
              (sku, barcode, name, selling_price, purchase_price, current_stock, status)
             VALUES (?, ?, ?, ?, 5, ?, 'active')`,
            [sku, barcode, name, sku === 'TEST-CREDIT' ? 50 : 10, quantity]
          );
          productIds.push(productInsert.insertId);
          await connection.execute(
            'INSERT INTO warehouse_stock (warehouse_id, product_id, quantity) VALUES (?, ?, ?)',
            [warehouseId, productInsert.insertId, quantity]
          );
        }
        [saleProductId, concurrentProductId, creditProductId] = productIds;
        token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '5m' });
      } finally {
        await connection.end();
      }

      async function request(method, route, body, headers = {}) {
        const requestHeaders = { ...headers };
        if (method === 'POST' && route === '/sales' && !requestHeaders['Idempotency-Key']) {
          requestHeaders['Idempotency-Key'] = crypto.randomUUID();
        }
        const response = await fetch(`http://127.0.0.1:${port}/api${route}`, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...requestHeaders
          },
          body: body === undefined ? undefined : JSON.stringify(body)
        });
        return { status: response.status, body: await response.json() };
      }

      const categoryResponse = await request('POST', '/categories', { name: 'E2E Category' });
      assert.equal(categoryResponse.status, 201, categoryResponse.body.message);
      const categoryId = categoryResponse.body.data.id;
      const brandResponse = await request('POST', '/brands', { name: 'E2E Brand' });
      assert.equal(brandResponse.status, 201, brandResponse.body.message);
      const brandId = brandResponse.body.data.id;

      const stockedProductResponse = await request('POST', '/products', {
        sku: 'TEST-STOCKED-DELETE',
        barcode: 'TEST-BAR-STOCKED-DELETE',
        name: 'Stocked Product Delete Protection',
        category_id: categoryId,
        brand_id: brandId,
        supplier_id: supplierId,
        default_warehouse_id: warehouseId,
        purchase_price: 5,
        selling_price: 10,
        initial_stock: 2
      });
      assert.equal(stockedProductResponse.status, 201, stockedProductResponse.body.message);
      const stockedProductId = stockedProductResponse.body.data.id;
      const stockedProductDetails = await request('GET', `/products/${stockedProductId}`);
      assert.equal(stockedProductDetails.status, 200);
      assert.equal(Number(stockedProductDetails.body.data.category_id), categoryId);
      assert.equal(Number(stockedProductDetails.body.data.brand_id), brandId);
      assert.equal(Number(stockedProductDetails.body.data.supplier_id), supplierId);
      assert.equal(Number(stockedProductDetails.body.data.warehouse_stock[0].quantity), 2);

      const updatedProduct = await request('PUT', `/products/${stockedProductId}`, {
        name: 'Updated Stocked Product',
        barcode: 'TEST-BAR-STOCKED-UPDATED',
        selling_price: 12
      });
      assert.equal(updatedProduct.status, 200, updatedProduct.body.message);
      assert.equal(updatedProduct.body.data.name, 'Updated Stocked Product');
      assert.equal(Number(updatedProduct.body.data.selling_price), 12);
      assert.equal(Number(updatedProduct.body.data.category_id), categoryId);
      assert.equal(Number(updatedProduct.body.data.brand_id), brandId);

      const stockedDelete = await request('DELETE', `/products/${stockedProductId}`);
      assert.equal(stockedDelete.status, 200, stockedDelete.body.message);
      assert.equal(stockedDelete.body.data.deactivated, true);
      const stockPreservation = await databaseConnection(appDb);
      try {
        const [[product]] = await stockPreservation.execute(
          'SELECT status, current_stock FROM products WHERE id = ?',
          [stockedProductId]
        );
        const [[warehouseBalance]] = await stockPreservation.execute(
          'SELECT quantity FROM warehouse_stock WHERE product_id = ? AND warehouse_id = ?',
          [stockedProductId, warehouseId]
        );
        const [[movementCount]] = await stockPreservation.execute(
          'SELECT COUNT(*) AS total FROM stock_movements WHERE product_id = ?',
          [stockedProductId]
        );
        assert.deepEqual(
          [product.status, Number(product.current_stock), Number(warehouseBalance.quantity), Number(movementCount.total)],
          ['inactive', 2, 2, 1]
        );
      } finally {
        await stockPreservation.end();
      }
      const referencedCategoryDelete = await request('DELETE', `/categories/${categoryId}`);
      assert.equal(referencedCategoryDelete.status, 400);

      const balanceOnlyProductResponse = await request('POST', '/products', {
        sku: 'TEST-BALANCE-ONLY',
        barcode: 'TEST-BAR-BALANCE-ONLY',
        name: 'Warehouse Balance Only Product',
        default_warehouse_id: warehouseId,
        initial_stock: 0
      });
      assert.equal(balanceOnlyProductResponse.status, 201, balanceOnlyProductResponse.body.message);
      const balanceOnlyProductId = balanceOnlyProductResponse.body.data.id;
      const balanceOnlyFixture = await databaseConnection(appDb);
      try {
        await balanceOnlyFixture.execute(
          'INSERT INTO warehouse_stock (warehouse_id, product_id, quantity) VALUES (?, ?, 1)',
          [warehouseId, balanceOnlyProductId]
        );
      } finally {
        await balanceOnlyFixture.end();
      }
      const balanceOnlyDelete = await request('DELETE', `/products/${balanceOnlyProductId}`);
      assert.equal(balanceOnlyDelete.status, 200, balanceOnlyDelete.body.message);
      assert.equal(balanceOnlyDelete.body.data.deactivated, true);
      const preservedBalance = await databaseConnection(appDb);
      try {
        const [[product]] = await preservedBalance.execute(
          'SELECT status FROM products WHERE id = ?',
          [balanceOnlyProductId]
        );
        const [[balance]] = await preservedBalance.execute(
          'SELECT quantity FROM warehouse_stock WHERE product_id = ? AND warehouse_id = ?',
          [balanceOnlyProductId, warehouseId]
        );
        assert.deepEqual([product.status, Number(balance.quantity)], ['inactive', 1]);
      } finally {
        await preservedBalance.end();
      }

      const emptyProductResponse = await request('POST', '/products', {
        sku: 'TEST-EMPTY-DELETE',
        barcode: 'TEST-BAR-EMPTY-DELETE',
        name: 'Empty Product Safe Delete',
        default_warehouse_id: warehouseId,
        initial_stock: 0
      });
      assert.equal(emptyProductResponse.status, 201, emptyProductResponse.body.message);
      const emptyProductDelete = await request('DELETE', `/products/${emptyProductResponse.body.data.id}`);
      assert.equal(emptyProductDelete.status, 200, emptyProductDelete.body.message);
      const deletedProductRead = await request('GET', `/products/${emptyProductResponse.body.data.id}`);
      assert.equal(deletedProductRead.status, 404);

      const purchaseProductResponse = await request('POST', '/products', {
        sku: 'TEST-PURCHASE-STOCK',
        barcode: 'TEST-BAR-PURCHASE-STOCK',
        name: 'Purchase Workflow Product',
        category_id: categoryId,
        brand_id: brandId,
        supplier_id: supplierId,
        default_warehouse_id: warehouseId,
        purchase_price: 5,
        selling_price: 10,
        initial_stock: 0
      });
      assert.equal(purchaseProductResponse.status, 201, purchaseProductResponse.body.message);
      const purchaseProductId = purchaseProductResponse.body.data.id;
      const purchaseResponse = await request('POST', '/purchases', {
        supplier_id: supplierId,
        warehouse_id: warehouseId,
        purchase_date: '2026-01-02',
        items: [{ product_id: purchaseProductId, quantity: 4, purchase_price: 5 }],
        paid_amount: 20,
        payment_method: 'Cash'
      });
      assert.equal(purchaseResponse.status, 201, purchaseResponse.body.message);
      const purchaseId = purchaseResponse.body.data.id;
      const purchaseDetails = await request('GET', `/purchases/${purchaseId}`);
      assert.equal(purchaseDetails.status, 200);
      assert.equal(Number(purchaseDetails.body.data.supplier_id), supplierId);
      assert.equal(Number(purchaseDetails.body.data.warehouse_id), warehouseId);
      assert.equal(purchaseDetails.body.data.items.length, 1);
      assert.equal(Number(purchaseDetails.body.data.items[0].product_id), purchaseProductId);
      assert.equal(Number(purchaseDetails.body.data.items[0].quantity), 4);
      assert.equal(purchaseDetails.body.data.payments.length, 1);

      const purchaseStock = await databaseConnection(appDb);
      try {
        const [[product]] = await purchaseStock.execute(
          'SELECT current_stock FROM products WHERE id = ?',
          [purchaseProductId]
        );
        const [[warehouseBalance]] = await purchaseStock.execute(
          'SELECT quantity FROM warehouse_stock WHERE product_id = ? AND warehouse_id = ?',
          [purchaseProductId, warehouseId]
        );
        const [[movement]] = await purchaseStock.execute(
          "SELECT quantity FROM stock_movements WHERE product_id = ? AND reference_type = 'purchase' AND reference_id = ?",
          [purchaseProductId, purchaseId]
        );
        assert.deepEqual(
          [Number(product.current_stock), Number(warehouseBalance.quantity), Number(movement.quantity)],
          [4, 4, 4]
        );
      } finally {
        await purchaseStock.end();
      }

      const purchaseSale = await request('POST', '/sales', makeSale(
        customerId, warehouseId, purchaseProductId, 1, 10, 10
      ));
      assert.equal(purchaseSale.status, 201, purchaseSale.body.message);
      const purchaseReturn = await request('POST', '/returns', {
        return_type: 'Purchase Return',
        reference_id: purchaseId,
        warehouse_id: warehouseId,
        items: [{ product_id: purchaseProductId, quantity: 1 }],
        refund_amount: 5,
        payment_method: 'Cash',
        reason: 'Isolated supplier return'
      }, { 'Idempotency-Key': crypto.randomUUID() });
      assert.equal(purchaseReturn.status, 201, purchaseReturn.body.message);
      const purchaseReconciliation = await databaseConnection(appDb);
      try {
        const [[purchase]] = await purchaseReconciliation.execute(
          'SELECT total, paid_amount, remaining_amount FROM purchases WHERE id = ?',
          [purchaseId]
        );
        const [[product]] = await purchaseReconciliation.execute(
          'SELECT current_stock FROM products WHERE id = ?',
          [purchaseProductId]
        );
        const [[warehouseBalance]] = await purchaseReconciliation.execute(
          'SELECT quantity FROM warehouse_stock WHERE product_id = ? AND warehouse_id = ?',
          [purchaseProductId, warehouseId]
        );
        const [[refund]] = await purchaseReconciliation.execute(
          "SELECT amount FROM payments WHERE payment_type = 'Supplier Refund' AND reference_id = ?",
          [purchaseReturn.body.data.id]
        );
        assert.deepEqual(
          [Number(purchase.total), Number(purchase.paid_amount), Number(purchase.remaining_amount),
            Number(product.current_stock), Number(warehouseBalance.quantity), Number(refund.amount)],
          [15, 15, 0, 2, 2, 5]
        );
      } finally {
        await purchaseReconciliation.end();
      }

      const invalidExpenseDate = await request('POST', '/expenses', {
        category: 'E2E',
        description: 'Reject invalid expense date',
        amount: 1,
        expense_date: '2026-02-30'
      });
      assert.equal(invalidExpenseDate.status, 400);
      const invalidExpenseMethod = await request('POST', '/expenses', {
        category: 'E2E',
        description: 'Reject unsupported expense payment method',
        amount: 1,
        payment_method: 'Cheque'
      });
      assert.equal(invalidExpenseMethod.status, 400);

      const expenseResponse = await request('POST', '/expenses', {
        category: 'E2E Travel',
        description: 'E2E supplier transport',
        amount: 20,
        payment_method: 'Cash',
        expense_date: '2025-12-31'
      });
      assert.equal(expenseResponse.status, 201, expenseResponse.body.message);
      const expenseId = expenseResponse.body.data.id;
      const expenseUpdate = await request('PUT', `/expenses/${expenseId}`, {
        amount: 22.5,
        payment_method: 'Bank',
        expense_date: '2026-01-01'
      });
      assert.equal(expenseUpdate.status, 200, expenseUpdate.body.message);
      assert.equal(Number(expenseUpdate.body.data.amount), 22.5);
      const filteredExpenses = await request(
        'GET',
        '/expenses?search=supplier%20transport&payment_method=Bank&start_date=2026-01-01&end_date=2026-01-01'
      );
      assert.equal(filteredExpenses.status, 200, filteredExpenses.body.message);
      assert.equal(filteredExpenses.body.data.expenses.length, 1);
      assert.equal(Number(filteredExpenses.body.data.total_amount), 22.5);
      const expenseDelete = await request('DELETE', `/expenses/${expenseId}`);
      assert.equal(expenseDelete.status, 200, expenseDelete.body.message);
      const deletedExpenseSearch = await request('GET', '/expenses?search=supplier%20transport');
      assert.equal(deletedExpenseSearch.status, 200);
      assert.equal(deletedExpenseSearch.body.data.expenses.length, 0);

      const readRoutes = [
        '/dashboard/stats',
        '/products?search=TEST',
        '/categories?search=E2E',
        '/brands?search=E2E',
        '/warehouses?status=active',
        '/suppliers?search=New',
        '/customers?search=New',
        '/purchases',
        '/sales',
        '/stock',
        '/stock/movements',
        '/stock/low',
        '/transfers',
        '/adjustments',
        '/returns',
        '/expenses',
        '/payments',
        '/invoices',
        '/debts',
        '/reports/sales',
        '/reports/purchases',
        '/reports/inventory',
        '/reports/financial',
        '/users',
        '/users/audit-logs',
        '/settings',
        '/barcode/lookup/TEST-BAR-SALE',
        '/barcode/generate-suggested'
      ];
      for (const route of readRoutes) {
        const response = await request('GET', route);
        assert.equal(response.status, 200, `${route}: ${response.body.message}`);
      }

      const unauthorizedSale = await fetch(`http://127.0.0.1:${port}/api/sales`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(makeSale(customerId, warehouseId, saleProductId, 1, 10, 10))
      });
      assert.equal(unauthorizedSale.status, 401);
      const permissionConnection = await databaseConnection(appDb);
      let limitedUserId;
      try {
        const [limitedUserInsert] = await permissionConnection.execute(
          "INSERT INTO users (name, email, password_hash, role, status) VALUES ('Limited User', 'limited-user@example.invalid', 'unused', 'Sales', 'active')"
        );
        limitedUserId = limitedUserInsert.insertId;
        await permissionConnection.execute(
          "DELETE FROM role_permissions WHERE role = 'Sales' AND permission = 'dashboard.view'"
        );
      } finally {
        await permissionConnection.end();
      }
      const limitedToken = jwt.sign({ id: limitedUserId }, process.env.JWT_SECRET, { expiresIn: '5m' });
      const forbiddenDashboard = await fetch(`http://127.0.0.1:${port}/api/dashboard/stats`, {
        headers: { Authorization: `Bearer ${limitedToken}` }
      });
      assert.equal(forbiddenDashboard.status, 403, 'dashboard access requires the dashboard.view permission');

      const saleWithoutKey = await fetch(`http://127.0.0.1:${port}/api/sales`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(makeSale(customerId, warehouseId, saleProductId, 1, 10, 10))
      });
      assert.equal(saleWithoutKey.status, 400);

      const warehouseProducts = await request('GET', `/products?warehouse_id=${warehouseId}&status=active`);
      assert.equal(warehouseProducts.status, 200);
      const listedProduct = warehouseProducts.body.data.products.find(product => product.id === saleProductId);
      assert.equal(Number(listedProduct.warehouse_quantity), 10);

      const salePayload = {
        ...makeSale(customerId, warehouseId, saleProductId, 6, 10, 60),
        items: [
          { product_id: saleProductId, quantity: 3, unit_price: 10 },
          { product_id: saleProductId, quantity: 3, unit_price: 10 }
        ]
      };
      const saleIdempotencyKey = crypto.randomUUID();
      const saleResponse = await request('POST', '/sales', salePayload, {
        'Idempotency-Key': saleIdempotencyKey
      });
      assert.equal(saleResponse.status, 201, saleResponse.body.message);
      const saleId = saleResponse.body.data.id;
      const dateFilteredSales = await request(
        'GET',
        `/sales?start_date=${salePayload.sale_date}&end_date=${salePayload.sale_date}`
      );
      assert.equal(dateFilteredSales.status, 200);
      assert.ok(dateFilteredSales.body.data.sales.some(sale => sale.id === saleId));
      const invalidDateFilter = await request('GET', '/sales?start_date=2026-02-30');
      assert.equal(invalidDateFilter.status, 400);
      const reversedDateFilter = await request(
        'GET',
        `/sales?start_date=${salePayload.sale_date}&end_date=2000-01-01`
      );
      assert.equal(reversedDateFilter.status, 400);

      const repeatedSale = await request('POST', '/sales', salePayload, {
        'Idempotency-Key': saleIdempotencyKey
      });
      assert.equal(repeatedSale.status, 200, repeatedSale.body.message);
      assert.equal(repeatedSale.body.data.id, saleId, 'retry must return the original sale');
      const reusedKey = await request('POST', '/sales', {
        ...salePayload,
        notes: 'Different request'
      }, { 'Idempotency-Key': saleIdempotencyKey });
      assert.equal(reusedKey.status, 409);

      const idempotencyConnection = await databaseConnection(appDb);
      try {
        await idempotencyConnection.execute(
          'UPDATE sale_idempotency SET sale_id = NULL WHERE idempotency_key = ?',
          [saleIdempotencyKey]
        );
      } finally {
        await idempotencyConnection.end();
      }
      const unlinkedRetry = await request('POST', '/sales', salePayload, {
        'Idempotency-Key': saleIdempotencyKey
      });
      assert.equal(unlinkedRetry.status, 409, 'an unlinked key must not resolve to an unrelated recent sale');

      const stockConnection = await databaseConnection(appDb);
      try {
        const [[stock]] = await stockConnection.execute(
          'SELECT quantity FROM warehouse_stock WHERE warehouse_id = ? AND product_id = ?',
          [warehouseId, saleProductId]
        );
        assert.equal(stock.quantity, 4, 'duplicate item lines must be included in the stock decrement');
      } finally {
        await stockConnection.end();
      }

      const oversell = await request('POST', '/sales', {
        ...makeSale(customerId, warehouseId, saleProductId, 3, 10, 50),
        items: [
          { product_id: saleProductId, quantity: 3, unit_price: 10 },
          { product_id: saleProductId, quantity: 2, unit_price: 10 }
        ]
      });
      assert.equal(oversell.status, 400);

      const invalidPrice = await request('POST', '/sales', {
        ...makeSale(customerId, warehouseId, saleProductId, 1, -1, 0)
      });
      assert.equal(invalidPrice.status, 400);

      const priceTampering = await request('POST', '/sales', {
        ...makeSale(customerId, warehouseId, saleProductId, 1, 1, 1)
      });
      assert.equal(priceTampering.status, 409, 'client prices must match the locked database selling price');

      const taxSettings = await databaseConnection(appDb);
      try {
        await taxSettings.execute('UPDATE settings SET tax_rate = 10');
      } finally {
        await taxSettings.end();
      }
      const multiProductPayload = {
        ...makeSale(null, warehouseId, saleProductId, 1, 10, 22),
        items: [
          { product_id: saleProductId, quantity: 1, unit_price: 10 },
          { product_id: productIds[3], quantity: 1, unit_price: 10 }
        ],
        tax: 500
      };
      const multiProductSale = await request('POST', '/sales', multiProductPayload, {
        'Idempotency-Key': crypto.randomUUID()
      });
      assert.equal(multiProductSale.status, 201, multiProductSale.body.message);
      assert.equal(Number(multiProductSale.body.data.subtotal), 20);
      assert.equal(Number(multiProductSale.body.data.tax), 2, 'tax must come from business settings');
      assert.equal(Number(multiProductSale.body.data.total), 22);
      assert.equal(multiProductSale.body.data.items.length, 2);
      const relatedSaleRecords = await databaseConnection(appDb);
      try {
        const [[saleItems]] = await relatedSaleRecords.execute(
          'SELECT COUNT(*) AS total FROM sale_items WHERE sale_id = ?',
          [multiProductSale.body.data.id]
        );
        const [[invoiceCount]] = await relatedSaleRecords.execute(
          'SELECT COUNT(*) AS total FROM invoices WHERE sale_id = ?',
          [multiProductSale.body.data.id]
        );
        const [[paymentCount]] = await relatedSaleRecords.execute(
          "SELECT COUNT(*) AS total FROM payments WHERE reference_id = ? AND payment_type = 'Customer Sale'",
          [multiProductSale.body.data.id]
        );
        const [[movementCount]] = await relatedSaleRecords.execute(
          "SELECT COUNT(*) AS total FROM stock_movements WHERE reference_type = 'sale' AND reference_id = ?",
          [multiProductSale.body.data.id]
        );
        assert.deepEqual(
          [saleItems.total, invoiceCount.total, paymentCount.total, movementCount.total].map(Number),
          [2, 1, 1, 2]
        );
      } finally {
        await relatedSaleRecords.end();
      }
      const taxReset = await databaseConnection(appDb);
      try {
        await taxReset.execute('UPDATE settings SET tax_rate = 0');
      } finally {
        await taxReset.end();
      }

      const completedSaleHistory = await request('GET', '/sales');
      assert.equal(completedSaleHistory.status, 200);
      assert.ok(completedSaleHistory.body.data.sales.some(sale => sale.id === saleId));

      const concurrentPayload = makeSale(customerId, warehouseId, concurrentProductId, 3, 10, 30);
      const concurrentResults = await Promise.all([
        request('POST', '/sales', concurrentPayload),
        request('POST', '/sales', concurrentPayload)
      ]);
      assert.deepEqual(concurrentResults.map(result => result.status).sort(), [201, 400]);

      const returnKey = crypto.randomUUID();
      const returnPayload = {
        return_type: 'Sale Return',
        reference_id: saleId,
        warehouse_id: warehouseId,
        items: [{ product_id: saleProductId, quantity: 2 }],
        refund_amount: 20,
        reason: 'Isolated test return'
      };
      const duplicateReturns = await Promise.all([
        request('POST', '/returns', returnPayload, { 'Idempotency-Key': returnKey }),
        request('POST', '/returns', returnPayload, { 'Idempotency-Key': returnKey })
      ]);
      assert.deepEqual(duplicateReturns.map(result => result.status).sort(), [200, 201]);
      const returned = duplicateReturns.find(result => result.status === 201);
      const repeated = duplicateReturns.find(result => result.status === 200);
      assert.equal(repeated.body.data.id, returned.body.data.id);
      const returnedStock = await databaseConnection(appDb);
      try {
        const [[balance]] = await returnedStock.execute(
          'SELECT quantity FROM warehouse_stock WHERE warehouse_id = ? AND product_id = ?',
          [warehouseId, saleProductId]
        );
        assert.equal(Number(balance.quantity), 5, 'sale return restores returned stock exactly once');
      } finally {
        await returnedStock.end();
      }

      const concurrentReturns = await Promise.all([
        request('POST', '/returns', {
          ...returnPayload,
          items: [{ product_id: saleProductId, quantity: 3 }],
          refund_amount: 30
        }, { 'Idempotency-Key': crypto.randomUUID() }),
        request('POST', '/returns', {
          ...returnPayload,
          items: [{ product_id: saleProductId, quantity: 3 }],
          refund_amount: 30
        }, { 'Idempotency-Key': crypto.randomUUID() })
      ]);
      assert.deepEqual(concurrentReturns.map(result => result.status).sort(), [201, 400]);

      const excessReturn = await request('POST', '/returns', {
        ...returnPayload,
        items: [{ product_id: saleProductId, quantity: 2 }]
      }, { 'Idempotency-Key': crypto.randomUUID() });
      assert.equal(excessReturn.status, 400);
      const unrelatedReturn = await request('POST', '/returns', {
        ...returnPayload,
        items: [{ product_id: productIds[3], quantity: 1 }]
      }, { 'Idempotency-Key': crypto.randomUUID() });
      assert.equal(unrelatedReturn.status, 400);

      const creditSale = await request('POST', '/sales', makeSale(
        customerId, warehouseId, creditProductId, 1, 50, 10
      ));
      assert.equal(creditSale.status, 201, creditSale.body.message);
      const creditSaleId = creditSale.body.data.id;
      const financeConnection = await databaseConnection(appDb);
      let debtId;
      try {
        const [[debt]] = await financeConnection.execute(
          "SELECT id FROM debts WHERE reference_type = 'Sale' AND reference_id = ?",
          [creditSaleId]
        );
        debtId = debt.id;
      } finally {
        await financeConnection.end();
      }

      const wrongPartyPayment = await request('POST', '/payments', {
        payment_type: 'Customer Debt',
        party_type: 'Customer',
        party_id: customerId,
        reference_id: 999999,
        amount: 15,
        payment_method: 'Cash'
      });
      assert.equal(wrongPartyPayment.status, 400);

      const debtPayment = await request('POST', '/payments', {
        payment_type: 'Customer Debt',
        party_type: 'Customer',
        party_id: customerId,
        reference_id: debtId,
        amount: 15,
        payment_method: 'Cash'
      });
      assert.equal(debtPayment.status, 201, debtPayment.body.message);

      const verifyFinance = await databaseConnection(appDb);
      try {
        const [[sale]] = await verifyFinance.execute('SELECT paid_amount, remaining_amount FROM sales WHERE id = ?', [creditSaleId]);
        const [[invoice]] = await verifyFinance.execute('SELECT paid_amount, remaining_amount FROM invoices WHERE sale_id = ?', [creditSaleId]);
        const [[debt]] = await verifyFinance.execute('SELECT paid_amount, remaining_amount FROM debts WHERE id = ?', [debtId]);
        const [[customer]] = await verifyFinance.execute('SELECT balance FROM customers WHERE id = ?', [customerId]);
        assert.deepEqual(
          [sale.paid_amount, sale.remaining_amount, invoice.paid_amount, invoice.remaining_amount, debt.paid_amount, debt.remaining_amount, customer.balance].map(Number),
          [25, 25, 25, 25, 25, 25, 25]
        );
      } finally {
        await verifyFinance.end();
      }

      const updateCreditPrice = await databaseConnection(appDb);
      try {
        await updateCreditPrice.execute('UPDATE products SET selling_price = 30 WHERE id = ?', [creditProductId]);
      } finally {
        await updateCreditPrice.end();
      }
      const secondCreditSale = await request('POST', '/sales', makeSale(
        customerId, warehouseId, creditProductId, 1, 30, 0
      ));
      assert.equal(secondCreditSale.status, 201, secondCreditSale.body.message);
      const secondSaleId = secondCreditSale.body.data.id;
      const debtLookup = await databaseConnection(appDb);
      let secondDebtId;
      try {
        const [[debt]] = await debtLookup.execute(
          "SELECT id FROM debts WHERE reference_type = 'Sale' AND reference_id = ?",
          [secondSaleId]
        );
        secondDebtId = debt.id;
      } finally {
        await debtLookup.end();
      }
      const directDebtPayment = await request('POST', `/debts/${secondDebtId}/pay`, {
        amount: 5,
        payment_method: 'Cash'
      });
      assert.equal(directDebtPayment.status, 200, directDebtPayment.body.message);

      const verifyDirectPayment = await databaseConnection(appDb);
      try {
        const [[sale]] = await verifyDirectPayment.execute(
          'SELECT paid_amount, remaining_amount FROM sales WHERE id = ?',
          [secondSaleId]
        );
        const [[debt]] = await verifyDirectPayment.execute(
          'SELECT paid_amount, remaining_amount FROM debts WHERE id = ?',
          [secondDebtId]
        );
        const [[invoice]] = await verifyDirectPayment.execute(
          'SELECT paid_amount, remaining_amount FROM invoices WHERE sale_id = ?',
          [secondSaleId]
        );
        assert.deepEqual(
          [sale.paid_amount, sale.remaining_amount, debt.paid_amount, debt.remaining_amount, invoice.paid_amount, invoice.remaining_amount].map(Number),
          [5, 25, 5, 25, 5, 25]
        );
      } finally {
        await verifyDirectPayment.end();
      }
    });
  } finally {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
    if (appPool) {
      await appPool.end();
    }
    for (const database of databaseNames) {
      await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
    }
    await admin.end();
  }
});
