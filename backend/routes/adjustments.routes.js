const express = require('express');
const router = express.Router();
const adjustmentsController = require('../controllers/adjustments.controller');
const { authenticateToken } = require('../middleware/auth.middleware');
const { requirePermission } = require('../middleware/rbac.middleware');

router.get('/', authenticateToken, requirePermission('stock.view'), adjustmentsController.getAllAdjustments);
router.post('/', authenticateToken, requirePermission('stock.adjust'), adjustmentsController.createAdjustment);

module.exports = router;
