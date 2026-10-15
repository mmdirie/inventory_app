async function up(connection) {
  await connection.execute(`
    ALTER TABLE payments
    MODIFY payment_type ENUM(
      'Customer Sale', 'Customer Debt', 'Supplier Purchase', 'Supplier Debt',
      'Customer Refund', 'Supplier Refund', 'Standalone', 'Expense'
    ) NOT NULL
  `);
  const [columns] = await connection.execute(`
    SELECT COLUMN_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'returns' AND COLUMN_NAME = 'request_key'
  `);
  if (!columns.length) {
    await connection.execute('ALTER TABLE `returns` ADD COLUMN request_key VARCHAR(100) DEFAULT NULL');
  }
  const [indexes] = await connection.execute(`
    SELECT INDEX_NAME FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'returns' AND INDEX_NAME = 'uq_returns_request_key'
  `);
  if (!indexes.length) {
    await connection.execute('ALTER TABLE `returns` ADD UNIQUE KEY uq_returns_request_key (request_key)');
  }
}

module.exports = { up };
