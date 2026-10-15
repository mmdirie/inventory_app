const express = require('express');
const router = express.Router();
const customersController = require('../controllers/customers.controller');
const { authenticateToken } = require('../middleware/auth.middleware');
const { requirePermission } = require('../middleware/rbac.middleware');

router.get('/', authenticateToken, requirePermission('customers.view'), customersController.getAllCustomers);
router.get('/:id', authenticateToken, requirePermission('customers.view'), customersController.getCustomerById);
router.post('/', authenticateToken, requirePermission('customers.manage'), customersController.createCustomer);
router.put('/:id', authenticateToken, requirePermission('customers.manage'), customersController.updateCustomer);
router.delete('/:id', authenticateToken, requirePermission('customers.manage'), customersController.deleteCustomer);

module.exports = router;
