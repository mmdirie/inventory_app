const express = require('express');
const router = express.Router();
const categoriesController = require('../controllers/categories.controller');
const { authenticateToken } = require('../middleware/auth.middleware');
const { requirePermission } = require('../middleware/rbac.middleware');

router.get('/', authenticateToken, requirePermission('categories.view'), categoriesController.getAllCategories);
router.get('/:id', authenticateToken, requirePermission('categories.view'), categoriesController.getCategoryById);
router.post('/', authenticateToken, requirePermission('categories.manage'), categoriesController.createCategory);
router.put('/:id', authenticateToken, requirePermission('categories.manage'), categoriesController.updateCategory);
router.delete('/:id', authenticateToken, requirePermission('categories.manage'), categoriesController.deleteCategory);

module.exports = router;
