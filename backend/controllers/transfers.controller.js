const { query, getTransactionConnection } = require('../config/db');
const { success, error } = require('../utils/response');
const { logAction } = require('../utils/logger');
const { validateRequired } = require('../validators/input.validator');

/**
 * GET /api/transfers
 */
async function getAllTransfers(req, res, next) {
  try {
    const { status, source_id, destination_id, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const params = [];
    const where = [];

    if (status) {
      where.push('st.status = ?');
      params.push(status);
    }

    if (source_id) {
      where.push('st.source_warehouse_id = ?');
      params.push(source_id);
    }

    if (destination_id) {
      where.push('st.destination_warehouse_id = ?');
      params.push(destination_id);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const [countRow] = await query(`SELECT COUNT(*) as total FROM stock_transfers st ${whereClause}`, params);
    const total = countRow.total;

    const dataSql = `
      SELECT 
        st.*,
        w1.name as source_warehouse_name,
        w2.name as destination_warehouse_name,
        u.name as created_by_name,
        (SELECT COUNT(*) FROM stock_transfer_items sti WHERE sti.transfer_id = st.id) as item_count,
        (SELECT COALESCE(SUM(quantity), 0) FROM stock_transfer_items sti WHERE sti.transfer_id = st.id) as total_units
      FROM stock_transfers st
      JOIN warehouses w1 ON st.source_warehouse_id = w1.id
      JOIN warehouses w2 ON st.destination_warehouse_id = w2.id
      LEFT JOIN users u ON st.created_by = u.id
      ${whereClause}
      ORDER BY st.id DESC
      LIMIT ? OFFSET ?
    `;

    const transfers = await query(dataSql, [...params, parseInt(limit, 10), parseInt(offset, 10)]);

    return success(res, {
      transfers,
      pagination: {
        total,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total_pages: Math.ceil(total / parseInt(limit, 10))
      }
    }, 'Stock transfers fetched');
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/transfers/:id
 */
async function getTransferById(req, res, next) {
  try {
    const { id } = req.params;
    const rows = await query(`
      SELECT 
        st.*,
        w1.name as source_warehouse_name,
        w2.name as destination_warehouse_name,
        u.name as created_by_name
      FROM stock_transfers st
      JOIN warehouses w1 ON st.source_warehouse_id = w1.id
      JOIN warehouses w2 ON st.destination_warehouse_id = w2.id
      LEFT JOIN users u ON st.created_by = u.id
      WHERE st.id = ?
    `, [id]);

    if (!rows || rows.length === 0) {
      return error(res, 'Stock transfer not found', 404);
    }

    const transfer = rows[0];

    const items = await query(`
      SELECT 
        sti.*,
        p.name as product_name,
        p.sku as product_sku,
        p.barcode as product_barcode,
        p.unit as product_unit
      FROM stock_transfer_items sti
      JOIN products p ON sti.product_id = p.id
      WHERE sti.transfer_id = ?
    `, [id]);

    transfer.items = items;
    return success(res, transfer, 'Transfer details');
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/transfers
 * Create transfer (Pending or Completed directly)
 */
async function createTransfer(req, res, next) {
  const conn = await getTransactionConnection();
  try {
    const {
      source_warehouse_id,
      destination_warehouse_id,
      transfer_date = new Date().toISOString().slice(0, 10),
      items,
      notes,
      auto_complete = false
    } = req.body;

    const missing = validateRequired(req.body, ['source_warehouse_id', 'destination_warehouse_id']);
    if (missing.length > 0) {
      await conn.rollback();
      return error(res, `Missing required fields: ${missing.join(', ')}`, 400);
    }

    if (source_warehouse_id == destination_warehouse_id) {
      await conn.rollback();
      return error(res, 'Source and destination warehouses cannot be the same', 400);
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      await conn.rollback();
      return error(res, 'At least one item is required for stock transfer', 400);
    }

    const year = new Date().getFullYear();
    const [countRow] = await conn.execute(
      "SELECT COUNT(*) as cnt FROM stock_transfers WHERE transfer_number LIKE ?",
      [`TRF-${year}-%`]
    );
    const transferNumber = `TRF-${year}-${String(countRow[0].cnt + 1).padStart(4, '0')}`;
    const initialStatus = auto_complete ? 'Completed' : 'Pending';
    const userId = req.user ? req.user.id : null;

    const [transferRes] = await conn.execute(`
      INSERT INTO stock_transfers (
        transfer_number, source_warehouse_id, destination_warehouse_id,
        transfer_date, status, notes, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      transferNumber,
      source_warehouse_id,
      destination_warehouse_id,
      transfer_date,
      initialStatus,
      notes || null,
      userId
    ]);

    const transferId = transferRes.insertId;

    for (const item of items) {
      const qty = parseInt(item.quantity, 10);
      if (!item.product_id || isNaN(qty) || qty <= 0) {
        await conn.rollback();
        return error(res, 'Invalid product or quantity for transfer item', 400);
      }

      await conn.execute(`
        INSERT INTO stock_transfer_items (transfer_id, product_id, quantity)
        VALUES (?, ?, ?)
      `, [transferId, item.product_id, qty]);

      // If auto-completing, apply movements and check stock
      if (auto_complete) {
        const [sourceStock] = await conn.execute(`
          SELECT quantity FROM warehouse_stock 
          WHERE warehouse_id = ? AND product_id = ?
          FOR UPDATE
        `, [source_warehouse_id, item.product_id]);

        const avail = sourceStock.length > 0 ? sourceStock[0].quantity : 0;
        if (avail < qty) {
          await conn.rollback();
          return error(res, `Insufficient stock at source warehouse for Product #${item.product_id}. Available: ${avail}, Requested: ${qty}`, 400);
        }

        // Deduct from source
        await conn.execute(`
          UPDATE warehouse_stock 
          SET quantity = quantity - ? 
          WHERE warehouse_id = ? AND product_id = ?
        `, [qty, source_warehouse_id, item.product_id]);

        // Add to destination
        await conn.execute(`
          INSERT INTO warehouse_stock (warehouse_id, product_id, quantity)
          VALUES (?, ?, ?)
          ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)
        `, [destination_warehouse_id, item.product_id, qty]);

        // Movements
        await conn.execute(`
          INSERT INTO stock_movements (product_id, warehouse_id, quantity, movement_type, reference_type, reference_id, notes, user_id)
          VALUES 
          (?, ?, ?, 'Transfer', 'transfer_out', ?, ?, ?),
          (?, ?, ?, 'Transfer', 'transfer_in', ?, ?, ?)
        `, [
          item.product_id, source_warehouse_id, -qty, transferId, `Transfer ${transferNumber} to Destination`, userId,
          item.product_id, destination_warehouse_id, qty, transferId, `Transfer ${transferNumber} from Source`, userId
        ]);
      }
    }

    await conn.commit();

    await logAction({
      userId,
      userName: req.user ? req.user.name : 'System',
      action: 'Create Stock Transfer',
      module: 'Transfers',
      details: `Created transfer ${transferNumber} (${initialStatus}) with ${items.length} items.`,
      ip: req.ip
    });

    const [created] = await query('SELECT * FROM stock_transfers WHERE id = ?', [transferId]);
    return success(res, created, 'Stock transfer created successfully', 201);
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
}

/**
 * PUT /api/transfers/:id/status
 * Update status ('Approved', 'Completed', 'Cancelled')
 */
async function updateTransferStatus(req, res, next) {
  const conn = await getTransactionConnection();
  try {
    const { id } = req.params;
    const { status } = req.body;

    const allowed = ['Approved', 'Completed', 'Cancelled'];
    if (!status || !allowed.includes(status)) {
      await conn.rollback();
      return error(res, `Invalid status. Must be one of: ${allowed.join(', ')}`, 400);
    }

    const [existing] = await conn.execute('SELECT * FROM stock_transfers WHERE id = ? FOR UPDATE', [id]);
    if (existing.length === 0) {
      await conn.rollback();
      return error(res, 'Stock transfer not found', 404);
    }

    const transfer = existing[0];
    if (transfer.status === 'Completed' || transfer.status === 'Cancelled') {
      await conn.rollback();
      return error(res, `Transfer is already marked as ${transfer.status} and cannot be altered`, 400);
    }

    const userId = req.user ? req.user.id : null;

    if (status === 'Completed') {
      // Execute the stock movements
      const [items] = await conn.execute('SELECT product_id, quantity FROM stock_transfer_items WHERE transfer_id = ?', [id]);

      for (const item of items) {
        const [sourceStock] = await conn.execute(`
          SELECT quantity FROM warehouse_stock 
          WHERE warehouse_id = ? AND product_id = ?
          FOR UPDATE
        `, [transfer.source_warehouse_id, item.product_id]);

        const avail = sourceStock.length > 0 ? sourceStock[0].quantity : 0;
        if (avail < item.quantity) {
          await conn.rollback();
          return error(res, `Insufficient stock at source warehouse for Product #${item.product_id}. Available: ${avail}, Required: ${item.quantity}`, 400);
        }

        // Deduct from source
        await conn.execute(`
          UPDATE warehouse_stock 
          SET quantity = quantity - ? 
          WHERE warehouse_id = ? AND product_id = ?
        `, [item.quantity, transfer.source_warehouse_id, item.product_id]);

        // Add to destination
        await conn.execute(`
          INSERT INTO warehouse_stock (warehouse_id, product_id, quantity)
          VALUES (?, ?, ?)
          ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)
        `, [transfer.destination_warehouse_id, item.product_id, item.quantity]);

        // Movements
        await conn.execute(`
          INSERT INTO stock_movements (product_id, warehouse_id, quantity, movement_type, reference_type, reference_id, notes, user_id)
          VALUES 
          (?, ?, ?, 'Transfer', 'transfer_out', ?, ?, ?),
          (?, ?, ?, 'Transfer', 'transfer_in', ?, ?, ?)
        `, [
          item.product_id, transfer.source_warehouse_id, -item.quantity, transfer.id, `Transfer ${transfer.transfer_number} to Destination`, userId,
          item.product_id, transfer.destination_warehouse_id, item.quantity, transfer.id, `Transfer ${transfer.transfer_number} from Source`, userId
        ]);
      }
    }

    await conn.execute('UPDATE stock_transfers SET status = ? WHERE id = ?', [status, id]);
    await conn.commit();

    await logAction({
      userId,
      userName: req.user ? req.user.name : 'System',
      action: 'Update Transfer Status',
      module: 'Transfers',
      details: `Transfer ${transfer.transfer_number} status updated to ${status}.`,
      ip: req.ip
    });

    const [updated] = await query('SELECT * FROM stock_transfers WHERE id = ?', [id]);
    return success(res, updated, `Transfer marked as ${status}`);
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
}

module.exports = {
  getAllTransfers,
  getTransferById,
  createTransfer,
  updateTransferStatus
};
