const express = require('express');
const router = express.Router();
const debtsController = require('../controllers/debts.controller');
const { authenticateToken } = require('../middleware/auth.middleware');
const { requirePermission } = require('../middleware/rbac.middleware');

router.get('/', authenticateToken, requirePermission('debts.view'), debtsController.getAllDebts);
router.post('/:id/pay', authenticateToken, requirePermission('debts.manage'), debtsController.payDebt);

module.exports = router;
