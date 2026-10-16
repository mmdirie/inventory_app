async function up(connection) {
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS sale_idempotency (
      user_id INT NOT NULL,
      idempotency_key VARCHAR(128) NOT NULL,
      request_hash CHAR(64) NOT NULL,
      sale_id INT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, idempotency_key),
      INDEX idx_sale_idempotency_sale (sale_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.execute(`
    INSERT IGNORE INTO role_permissions (role, permission)
    SELECT 'Sales', name
    FROM permissions
    WHERE name IN ('categories.view', 'warehouses.view')
  `);
}

module.exports = { up };
