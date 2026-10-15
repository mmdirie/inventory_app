const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settings.controller');
const { authenticateToken } = require('../middleware/auth.middleware');
const { requirePermission } = require('../middleware/rbac.middleware');

router.get('/', authenticateToken, settingsController.getSettings);
router.put('/', authenticateToken, requirePermission('settings.manage'), settingsController.updateSettings);

module.exports = router;
