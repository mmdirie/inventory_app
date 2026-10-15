const express = require('express');
const router = express.Router();
const salesController = require('../controllers/sales.controller');
const { authenticateToken } = require('../middleware/auth.middleware');
const { requirePermission } = require('../middleware/rbac.middleware');

router.get('/', authenticateToken, requirePermission('sales.view'), salesController.getAllSales);
router.get('/:id', authenticateToken, requirePermission('sales.view'), salesController.getSaleById);
router.post('/', authenticateToken, requirePermission('sales.create'), salesController.createSale);

module.exports = router;
