const express = require('express');
const router = express.Router();
const warehousesController = require('../controllers/warehouses.controller');
const { authenticateToken } = require('../middleware/auth.middleware');
const { requirePermission } = require('../middleware/rbac.middleware');

router.get('/', authenticateToken, requirePermission('warehouses.view'), warehousesController.getAllWarehouses);
router.get('/:id', authenticateToken, requirePermission('warehouses.view'), warehousesController.getWarehouseById);
router.post('/', authenticateToken, requirePermission('warehouses.manage'), warehousesController.createWarehouse);
router.put('/:id', authenticateToken, requirePermission('warehouses.manage'), warehousesController.updateWarehouse);
router.delete('/:id', authenticateToken, requirePermission('warehouses.manage'), warehousesController.deleteWarehouse);

module.exports = router;
