const express = require('express');
const router = express.Router();
const usersController = require('../controllers/users.controller');
const { authenticateToken } = require('../middleware/auth.middleware');
const { requirePermission } = require('../middleware/rbac.middleware');

router.get('/', authenticateToken, requirePermission('users.manage'), usersController.getAllUsers);
router.get('/audit-logs', authenticateToken, requirePermission('users.manage'), usersController.getAuditLogs);
router.get('/:id', authenticateToken, requirePermission('users.manage'), usersController.getUserById);
router.post('/', authenticateToken, requirePermission('users.manage'), usersController.createUser);
router.put('/:id', authenticateToken, requirePermission('users.manage'), usersController.updateUser);
router.put('/:id/status', authenticateToken, requirePermission('users.manage'), usersController.toggleUserStatus);

module.exports = router;
