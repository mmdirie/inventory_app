const express = require('express');
const router = express.Router();
const stockController = require('../controllers/stock.controller');
const { authenticateToken } = require('../middleware/auth.middleware');
const { requirePermission } = require('../middleware/rbac.middleware');

router.get('/', authenticateToken, requirePermission('stock.view'), stockController.getStockOverview);
router.get('/movements', authenticateToken, requirePermission('stock.view'), stockController.getStockMovements);
router.get('/low', authenticateToken, requirePermission('stock.view'), stockController.getLowStockAlerts);

module.exports = router;
