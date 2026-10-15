async function nextDocumentNumber(connection, name, prefix, year = new Date().getFullYear()) {
  await connection.execute(`
    INSERT INTO document_sequences (sequence_name, sequence_year, last_value)
    VALUES (?, ?, 1)
    ON DUPLICATE KEY UPDATE last_value = LAST_INSERT_ID(last_value + 1)
  `, [name, year]);
  const [rows] = await connection.execute(
    'SELECT last_value FROM document_sequences WHERE sequence_name = ? AND sequence_year = ?',
    [name, year]
  );
  if (!rows.length) {
    throw new Error(`Could not allocate a ${name} document number.`);
  }
  return `${prefix}${year}-${String(rows[0].last_value).padStart(4, '0')}`;
}

module.exports = { nextDocumentNumber };
