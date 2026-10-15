const express = require('express');
const router = express.Router();
const expensesController = require('../controllers/expenses.controller');
const { authenticateToken } = require('../middleware/auth.middleware');
const { requirePermission } = require('../middleware/rbac.middleware');

router.get('/', authenticateToken, requirePermission('expenses.view'), expensesController.getAllExpenses);
router.post('/', authenticateToken, requirePermission('expenses.manage'), expensesController.createExpense);
router.put('/:id', authenticateToken, requirePermission('expenses.manage'), expensesController.updateExpense);
router.delete('/:id', authenticateToken, requirePermission('expenses.manage'), expensesController.deleteExpense);

module.exports = router;
