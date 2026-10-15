const express = require('express');
const router = express.Router();
const invoicesController = require('../controllers/invoices.controller');
const { authenticateToken } = require('../middleware/auth.middleware');
const { requirePermission } = require('../middleware/rbac.middleware');

router.get('/', authenticateToken, requirePermission('invoices.view'), invoicesController.getAllInvoices);
router.get('/:id', authenticateToken, requirePermission('invoices.view'), invoicesController.getInvoiceById);

module.exports = router;
