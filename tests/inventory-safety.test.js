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

function runDatabaseScript(script, database) {
  const result = spawnSync(process.execPath, [script], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, DB_NAME: database }
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
          '003_return_idempotency_and_refunds.js'
        ]);
        const [tables] = await connection.execute(
          "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales'"
        );
        assert.equal(tables.length, 1);
      } finally {
        await connection.end();
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
      server = app.listen(0);
      await once(server, 'listening');
      const port = server.address().port;
      const connection = await databaseConnection(appDb);
      let customerId;
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
          "INSERT INTO role_permissions (role, permission) VALUES ('Admin', 'sales.create'), ('Admin', 'returns.create'), ('Admin', 'payments.manage'), ('Admin', 'debts.manage')"
        );
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
             VALUES (?, ?, ?, 10, 5, ?, 'active')`,
            [sku, barcode, name, quantity]
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
        const response = await fetch(`http://127.0.0.1:${port}/api${route}`, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...headers
          },
          body: body === undefined ? undefined : JSON.stringify(body)
        });
        return { status: response.status, body: await response.json() };
      }

      const saleResponse = await request('POST', '/sales', {
        ...makeSale(customerId, warehouseId, saleProductId, 6, 10, 60),
        items: [
          { product_id: saleProductId, quantity: 3, unit_price: 10 },
          { product_id: saleProductId, quantity: 3, unit_price: 10 }
        ]
      });
      assert.equal(saleResponse.status, 201, saleResponse.body.message);
      const saleId = saleResponse.body.data.id;

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
