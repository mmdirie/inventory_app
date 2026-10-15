const express = require('express');
const router = express.Router();
const returnsController = require('../controllers/returns.controller');
const { authenticateToken } = require('../middleware/auth.middleware');
const { requirePermission } = require('../middleware/rbac.middleware');

router.get('/', authenticateToken, requirePermission('returns.view'), returnsController.getAllReturns);
router.get('/:id', authenticateToken, requirePermission('returns.view'), returnsController.getReturnById);
router.post('/', authenticateToken, requirePermission('returns.create'), returnsController.createReturn);

module.exports = router;
