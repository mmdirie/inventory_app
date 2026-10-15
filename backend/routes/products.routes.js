const express = require('express');
const router = express.Router();
const productsController = require('../controllers/products.controller');
const { authenticateToken } = require('../middleware/auth.middleware');
const { requirePermission } = require('../middleware/rbac.middleware');

router.get('/', authenticateToken, requirePermission('products.view'), productsController.getAllProducts);
router.get('/barcode/:barcode', authenticateToken, requirePermission('products.view'), productsController.getProductByBarcode);
router.get('/:id', authenticateToken, requirePermission('products.view'), productsController.getProductById);
router.post('/', authenticateToken, requirePermission('products.create'), productsController.createProduct);
router.put('/:id', authenticateToken, requirePermission('products.update'), productsController.updateProduct);
router.delete('/:id', authenticateToken, requirePermission('products.delete'), productsController.deleteProduct);

module.exports = router;
