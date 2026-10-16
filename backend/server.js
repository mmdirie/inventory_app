const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// Validate critical environment variables
const requiredEnv = ['JWT_SECRET'];
for (const envVar of requiredEnv) {
  if (!process.env[envVar] || !process.env[envVar].trim()) {
    console.error(`[FATAL] Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

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

// Security: Disable X-Powered-By
app.disable('x-powered-by');

// Security Headers Middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// CORS Configuration - Avoid combining wildcard origin with credentials: true
const rawOrigin = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.trim() : '*';
const isWildcard = rawOrigin === '*';

if (isWildcard) {
  app.use(cors({
    origin: '*',
    credentials: false
  }));
} else {
  const allowedOrigins = rawOrigin.includes(',')
    ? rawOrigin.split(',').map(o => o.trim())
    : rawOrigin;
  app.use(cors({
    origin: allowedOrigins,
    credentials: true
  }));
}

// Body Parsing with payload size limits
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

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
