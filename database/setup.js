const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config();

async function setupFreshDatabase() {
  const databaseName = process.env.DB_NAME || 'inventory_management';
  if (!/^[a-zA-Z0-9_]+$/.test(databaseName)) {
    throw new Error('DB_NAME may contain only letters, numbers, and underscores.');
  }

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true
  });

  try {
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await connection.changeUser({ database: databaseName });
    const [tables] = await connection.execute(`
      SELECT TABLE_NAME
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
    `);
    if (tables.length) {
      throw new Error(
        `Fresh setup refused: database "${databaseName}" already contains tables. ` +
        'Use npm run migrate for an existing database; setup does not reset or seed data.'
      );
    }

    await connection.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
    console.log(`Fresh schema created in "${databaseName}". No sample data was seeded.`);
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  setupFreshDatabase().catch(err => {
    console.error('Fresh database setup failed:', err.message);
    process.exitCode = 1;
  });
}

module.exports = setupFreshDatabase;
