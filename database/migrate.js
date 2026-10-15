const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config();

const migrationsPath = path.join(__dirname, 'migrations');

async function openDatabase() {
  return mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'inventory_management',
    multipleStatements: true
  });
}

async function applyMigrations(connection) {
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(190) NOT NULL PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const [lockRows] = await connection.query("SELECT GET_LOCK('inventory_app_schema_migrations', 30) AS acquired");
  if (!lockRows[0] || Number(lockRows[0].acquired) !== 1) {
    throw new Error('Could not acquire the database migration lock.');
  }

  try {
    const migrationFiles = fs.readdirSync(migrationsPath)
      .filter(file => /^\d+_[a-z0-9_-]+\.js$/i.test(file))
      .sort();

    for (const file of migrationFiles) {
      const [applied] = await connection.execute('SELECT version FROM schema_migrations WHERE version = ?', [file]);
      if (applied.length) continue;

      const migration = require(path.join(migrationsPath, file));
      if (!migration || typeof migration.up !== 'function') {
        throw new Error(`Migration ${file} must export an up(connection) function.`);
      }

      console.log(`Applying ${file}...`);
      await migration.up(connection);
      await connection.execute('INSERT INTO schema_migrations (version) VALUES (?)', [file]);
    }
  } finally {
    await connection.query("SELECT RELEASE_LOCK('inventory_app_schema_migrations')");
  }
}

async function runMigration() {
  const dbName = process.env.DB_NAME || 'inventory_management';
  if (!/^[a-zA-Z0-9_]+$/.test(dbName)) {
    throw new Error('DB_NAME may contain only letters, numbers, and underscores.');
  }

  const admin = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || ''
  });
  try {
    await admin.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } finally {
    await admin.end();
  }

  const connection = await openDatabase();
  try {
    await applyMigrations(connection);
    console.log('Database migrations completed successfully.');
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  runMigration().catch(err => {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  });
}

module.exports = { runMigration, applyMigrations };
