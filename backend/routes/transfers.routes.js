const express = require('express');
const router = express.Router();
const transfersController = require('../controllers/transfers.controller');
const { authenticateToken } = require('../middleware/auth.middleware');
const { requirePermission } = require('../middleware/rbac.middleware');

router.get('/', authenticateToken, requirePermission('stock.view'), transfersController.getAllTransfers);
router.get('/:id', authenticateToken, requirePermission('stock.view'), transfersController.getTransferById);
router.post('/', authenticateToken, requirePermission('stock.transfer'), transfersController.createTransfer);
router.put('/:id/status', authenticateToken, requirePermission('stock.transfer'), transfersController.updateTransferStatus);

module.exports = router;
