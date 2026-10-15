# 📦 Apex Inventory Management System

A professional, production-ready **single-business Inventory Management System (IMS)** built with **Node.js, Express.js, MySQL (XAMPP), and Vanilla JavaScript**.

Designed specifically for **one organization** — no SaaS, no multi-tenant isolation, no business switching. All data, branches, warehouses, inventory, and staff accounts belong to this single enterprise.

---

## 🚀 Key Modules & Capabilities

- 📊 **Executive Dashboard:** Live KPIs, 7-day revenue trend chart (Chart.js), critical low-stock alerts, and recent transactions.
- 🛒 **Point-of-Sale (POS) Terminal:** Fast barcode scanning, real-time cart calculations, split/partial payments, customer selection, credit limits, and printable thermal receipts.
- 📦 **Product Catalog:** SKU & barcode uniqueness validation, categories, brands, pricing tiers (retail vs wholesale), reorder limits, and stock distribution.
- 🏢 **Multi-Warehouse Support:** Support for multiple warehouses/stores inside the same business with per-warehouse stock counts.
- 🔄 **Stock Transfers & Adjustments:** Inter-warehouse transfer approval workflow (`Pending` -> `Approved` -> `Completed`) and cycle-count stock adjustments.
- ↩️ **Returns Management:** Customer sales returns (restocking inventory, refunding or reducing debts) and supplier purchase returns.
- 🚚 **Purchasing & Vendors:** Supplier POs with automated inventory receiving and accounts payable ledger.
- 🧾 **Invoices & Receipts:** Professional printable full-page A4 invoices with company letterhead, tax, discount, and balance tracking.
- 💳 **Payments & Debts:** Centralized tracking of customer credit receivables and supplier payables with partial settlement modals.
- 🏷️ **Barcode Manager:** Barcode scanning lookup, unique EAN-13 barcode generation, live SVG preview with JsBarcode, and batch sticker print sheet.
- 📈 **Reports Hub:** Tabbed analytics for Sales (by date/month/product/customer/staff), Purchasing, Inventory Valuation (cost vs retail value), and Financial P&L.
- 👥 **Users & RBAC:** Granular role-based access control (Admin, Manager, Sales, Inventory, Accountant) and audit logging of all sensitive actions.
- ⚙️ **Business Settings:** Configurable organization identity, tax rate, currency symbol & position, low-stock threshold, and invoice numbering prefix.

---

## 🛠️ Technology Stack

| Layer | Technologies |
|---|---|
| **Frontend** | HTML5, CSS3, Tailwind CSS (via CDN), Vanilla JavaScript, Fetch API, Font Awesome 6.4 |
| **Backend** | Node.js (v18+), Express.js (v4.21+) |
| **Database** | MySQL / MariaDB (XAMPP localhost:3306, InnoDB Engine) |
| **Auth** | JSON Web Tokens (JWT) + bcryptjs password hashing |
| **Libraries** | Chart.js (analytics), JsBarcode (barcode generator & scanner) |

---

## 🏁 Quick Start Guide

### 1. Requirements
- Node.js (v18+)
- XAMPP with MySQL running on `localhost:3306`

### 2. Configuration
Copy `.env.example` to `.env`:
```ini
PORT=5000
NODE_ENV=development

DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=inventory_management

JWT_SECRET=8f511fdde3cc6b205960fdc6089779ca68570eb46ef7e86b78ca5621bf5121a3
JWT_EXPIRES_IN=7d
CORS_ORIGIN=*
```

### 3. Database Migration & Seed
```bash
npm run setup
```

### 4. Start Server
```bash
npm start
```

Navigate to `http://localhost:5000` in your browser.

---

## 🔑 Demo Login Accounts

| Role | Email | Password |
|---|---|---|
| **Admin** | `admin@apexinventory.com` | `Admin@123` |
| **Manager** | `manager@apexinventory.com` | `Manager@123` |
| **Sales** | `sales@apexinventory.com` | `Sales@123` |
| **Inventory** | `inventory@apexinventory.com` | `Inventory@123` |
| **Accountant** | `accountant@apexinventory.com` | `Accountant@123` |

---

## 📚 Documentation

Detailed documentation is available in the `docs/` folder:
- [Installation Guide](docs/INSTALLATION.md)
- [Database Architecture & Data Dictionary](docs/DATABASE.md)
- [REST API Reference](docs/API.md)

---

## 📄 License
MIT License. Developed for enterprise inventory management.
