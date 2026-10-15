const express = require('express');
const router = express.Router();
const reportsController = require('../controllers/reports.controller');
const { authenticateToken } = require('../middleware/auth.middleware');
const { requirePermission } = require('../middleware/rbac.middleware');

router.get('/sales', authenticateToken, requirePermission('reports.view'), reportsController.getSalesReports);
router.get('/purchases', authenticateToken, requirePermission('reports.view'), reportsController.getPurchaseReports);
router.get('/inventory', authenticateToken, requirePermission('reports.view'), reportsController.getInventoryReports);
router.get('/financial', authenticateToken, requirePermission('reports.view'), reportsController.getFinancialReports);

module.exports = router;
