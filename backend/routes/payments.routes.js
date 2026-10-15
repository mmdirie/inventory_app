const express = require('express');
const router = express.Router();
const paymentsController = require('../controllers/payments.controller');
const { authenticateToken } = require('../middleware/auth.middleware');
const { requirePermission } = require('../middleware/rbac.middleware');

router.get('/', authenticateToken, requirePermission('payments.view'), paymentsController.getAllPayments);
router.post('/', authenticateToken, requirePermission('payments.manage'), paymentsController.createPayment);

module.exports = router;
