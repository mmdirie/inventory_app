const { query } = require('../config/db');

/**
 * Audit Logger utility: persists important business actions to audit_logs table
 */
async function logAction({ userId = null, userName = 'System', action, module, details = '', ip = '' }) {
  try {
    await query(
      'INSERT INTO audit_logs (user_id, user_name, action, module, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, userName, action, module, typeof details === 'object' ? JSON.stringify(details) : details, ip]
    );
  } catch (err) {
    console.error('Audit Log Error:', err.message);
  }
}

module.exports = {
  logAction
};
