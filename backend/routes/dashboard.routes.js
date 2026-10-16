const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboard.controller');
const { authenticateToken } = require('../middleware/auth.middleware');
const { requirePermission } = require('../middleware/rbac.middleware');

router.get('/stats', authenticateToken, requirePermission('dashboard.view'), dashboardController.getDashboardStats);

module.exports = router;
