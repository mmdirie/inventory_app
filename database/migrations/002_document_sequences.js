async function up(connection) {
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS document_sequences (
      sequence_name VARCHAR(40) NOT NULL,
      sequence_year SMALLINT NOT NULL,
      last_value BIGINT UNSIGNED NOT NULL DEFAULT 0,
      PRIMARY KEY (sequence_name, sequence_year)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const documents = [
    ['sale', 'sales', 'invoice_number'],
    ['purchase', 'purchases', 'invoice_number'],
    ['return', 'returns', 'return_number'],
    ['payment', 'payments', 'reference_number'],
    ['refund-payment', 'payments', 'reference_number'],
    ['adjustment', 'stock_adjustments', 'adjustment_number'],
    ['transfer', 'stock_transfers', 'transfer_number']
  ];

  for (const [sequenceName, tableName, numberColumn] of documents) {
    const prefixFilter = sequenceName === 'refund-payment' ? "AND number_value LIKE 'PAY-REF-%'" : '';
    const [rows] = await connection.query(`
      SELECT sequence_year, MAX(sequence_value) AS max_value
      FROM (
        SELECT
          CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(\`${numberColumn}\`, '-', -2), '-', 1) AS UNSIGNED) AS sequence_year,
          CAST(SUBSTRING_INDEX(\`${numberColumn}\`, '-', -1) AS UNSIGNED) AS sequence_value,
          \`${numberColumn}\` AS number_value
        FROM \`${tableName}\`
        WHERE \`${numberColumn}\` REGEXP '-[0-9]{4}-[0-9]+$'
      ) AS existing_numbers
      WHERE sequence_year BETWEEN 1000 AND 9999
        AND sequence_value > 0
        ${prefixFilter}
      GROUP BY sequence_year
    `);

    for (const row of rows) {
      await connection.execute(`
        INSERT INTO document_sequences (sequence_name, sequence_year, last_value)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE last_value = GREATEST(last_value, VALUES(last_value))
      `, [sequenceName, row.sequence_year, row.max_value]);
    }
  }
}

module.exports = { up };
