const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const { errorHandler } = require('./middleware/error.middleware');

// Routes
const authRoutes = require('./routes/auth.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const productsRoutes = require('./routes/products.routes');
const categoriesRoutes = require('./routes/categories.routes');
const brandsRoutes = require('./routes/brands.routes');
const warehousesRoutes = require('./routes/warehouses.routes');
const suppliersRoutes = require('./routes/suppliers.routes');
const customersRoutes = require('./routes/customers.routes');
const purchasesRoutes = require('./routes/purchases.routes');
const salesRoutes = require('./routes/sales.routes');
const stockRoutes = require('./routes/stock.routes');
const transfersRoutes = require('./routes/transfers.routes');
const adjustmentsRoutes = require('./routes/adjustments.routes');
const returnsRoutes = require('./routes/returns.routes');
const expensesRoutes = require('./routes/expenses.routes');
const paymentsRoutes = require('./routes/payments.routes');
const invoicesRoutes = require('./routes/invoices.routes');
const debtsRoutes = require('./routes/debts.routes');
const reportsRoutes = require('./routes/reports.routes');
const usersRoutes = require('./routes/users.routes');
const settingsRoutes = require('./routes/settings.routes');
const barcodeRoutes = require('./routes/barcode.routes');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend assets
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    system: 'Apex Inventory Management System',
    type: 'Single-Business Architecture'
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/brands', brandsRoutes);
app.use('/api/warehouses', warehousesRoutes);
app.use('/api/suppliers', suppliersRoutes);
app.use('/api/customers', customersRoutes);
app.use('/api/purchases', purchasesRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/stock', stockRoutes);
app.use('/api/transfers', transfersRoutes);
app.use('/api/adjustments', adjustmentsRoutes);
app.use('/api/returns', returnsRoutes);
app.use('/api/expenses', expensesRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/invoices', invoicesRoutes);
app.use('/api/debts', debtsRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/barcode', barcodeRoutes);

// Root route redirect to dashboard or login
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

// Fallback 404 for API endpoints
app.use('/api', (req, res) => {
  res.status(404).json({
    success: false,
    message: `API endpoint '${req.method} ${req.originalUrl}' not found.`
  });
});

// Centralized error handler
app.use(errorHandler);

// Start Server
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(` Inventory Management System Server Running`);
    console.log(` Local URL: http://localhost:${PORT}`);
    console.log(` Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(` Database: MySQL (XAMPP localhost:3306)`);
    console.log(`=======================================================`);
  });
}

module.exports = app;
