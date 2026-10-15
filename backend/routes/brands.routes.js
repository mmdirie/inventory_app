const express = require('express');
const router = express.Router();
const brandsController = require('../controllers/brands.controller');
const { authenticateToken } = require('../middleware/auth.middleware');
const { requirePermission } = require('../middleware/rbac.middleware');

router.get('/', authenticateToken, requirePermission('brands.view'), brandsController.getAllBrands);
router.get('/:id', authenticateToken, requirePermission('brands.view'), brandsController.getBrandById);
router.post('/', authenticateToken, requirePermission('brands.manage'), brandsController.createBrand);
router.put('/:id', authenticateToken, requirePermission('brands.manage'), brandsController.updateBrand);
router.delete('/:id', authenticateToken, requirePermission('brands.manage'), brandsController.deleteBrand);

module.exports = router;
