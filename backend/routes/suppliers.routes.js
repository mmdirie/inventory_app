const express = require('express');
const router = express.Router();
const suppliersController = require('../controllers/suppliers.controller');
const { authenticateToken } = require('../middleware/auth.middleware');
const { requirePermission } = require('../middleware/rbac.middleware');

router.get('/', authenticateToken, requirePermission('suppliers.view'), suppliersController.getAllSuppliers);
router.get('/:id', authenticateToken, requirePermission('suppliers.view'), suppliersController.getSupplierById);
router.post('/', authenticateToken, requirePermission('suppliers.manage'), suppliersController.createSupplier);
router.put('/:id', authenticateToken, requirePermission('suppliers.manage'), suppliersController.updateSupplier);
router.delete('/:id', authenticateToken, requirePermission('suppliers.manage'), suppliersController.deleteSupplier);

module.exports = router;
