const express = require('express');
const router = express.Router();
const barcodeController = require('../controllers/barcode.controller');
const { authenticateToken } = require('../middleware/auth.middleware');
const { requirePermission } = require('../middleware/rbac.middleware');

router.get('/lookup/:code', authenticateToken, requirePermission('products.view'), barcodeController.lookupBarcode);
router.get('/generate-suggested', authenticateToken, requirePermission('products.create'), barcodeController.generateSuggestedBarcode);

module.exports = router;
