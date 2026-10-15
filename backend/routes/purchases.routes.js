const express = require('express');
const router = express.Router();
const purchasesController = require('../controllers/purchases.controller');
const { authenticateToken } = require('../middleware/auth.middleware');
const { requirePermission } = require('../middleware/rbac.middleware');

router.get('/', authenticateToken, requirePermission('purchases.view'), purchasesController.getAllPurchases);
router.get('/:id', authenticateToken, requirePermission('purchases.view'), purchasesController.getPurchaseById);
router.post('/', authenticateToken, requirePermission('purchases.create'), purchasesController.createPurchase);

module.exports = router;
