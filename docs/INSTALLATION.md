# Installation and Setup Guide

This guide details how to install, configure, and run the **Apex Inventory Management System** on a local development environment or production server.

---

## 1. Prerequisites

Ensure you have the following installed on your machine:

1. **Node.js** (v18.0.0 or higher recommended, tested on Node v20/v24)
   - Download from: [https://nodejs.org](https://nodejs.org)
   - Verify installation:
     ```bash
     node -v
     npm -v
     ```

2. **MySQL / MariaDB via XAMPP** (or standalone MySQL 8.0+)
   - Download XAMPP from: [https://www.apachefriends.org](https://www.apachefriends.org)
   - Start the **MySQL** service from the XAMPP Control Panel.
   - Default credentials:
     - **Host:** `localhost`
     - **Port:** `3306`
     - **Username:** `root`
     - **Password:** *(empty)*

---

## 2. Clone / Extract the Repository

```bash
cd c:\Users\HP\Desktop\inventory
```

---

## 3. Environment Configuration

Create a `.env` file in the root directory (or copy from `.env.example`):

```bash
cp .env.example .env
```

Configure your `.env` variables:

```ini
# Server Configuration
PORT=5000
NODE_ENV=development

# Database Configuration (XAMPP MySQL)
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=inventory_management

# Authentication (JWT)
JWT_SECRET=8f511fdde3cc6b205960fdc6089779ca68570eb46ef7e86b78ca5621bf5121a3
JWT_EXPIRES_IN=7d

# CORS Configuration
CORS_ORIGIN=*
```

---

## 4. Install Dependencies

Install the required Node.js packages:

```bash
npm install
```

The core dependencies include:
- `express` (Web server and REST API framework)
- `mysql2` (High-performance MySQL client with Promise and Transaction support)
- `bcryptjs` (Secure password hashing)
- `jsonwebtoken` (JWT bearer token generation and verification)
- `cors` (Cross-Origin Resource Sharing middleware)
- `dotenv` (Environment variable loader)

---

## 5. Database Setup & Seeding

Run the migration script to create all 28 tables and foreign key constraints:

```bash
npm run migrate
```

Seed the database with sample business records, categories, warehouses, products, and role-based staff accounts:

```bash
npm run seed
```

Alternatively, run both setup steps in one command:

```bash
npm run setup
```

---

## 6. Start the Application

Start the Express backend server:

```bash
npm start
```

You should see the console banner:
```
=======================================================
 Inventory Management System Server Running
 Local URL: http://localhost:5000
 Environment: development
 Database: MySQL (XAMPP localhost:3306)
=======================================================
```

---

## 7. Accessing the Application

Open your browser and navigate to:
```
http://localhost:5000
```

The system will redirect you to the **Enterprise Login** page (`/login.html`).

### Demo Accounts

| Role | Email | Password |
|---|---|---|
| **Admin** | `admin@apexinventory.com` | `Admin@123` |
| **Manager** | `manager@apexinventory.com` | `Manager@123` |
| **Sales / Cashier** | `sales@apexinventory.com` | `Sales@123` |
| **Inventory Auditor**| `inventory@apexinventory.com` | `Inventory@123` |
| **Accountant** | `accountant@apexinventory.com` | `Accountant@123` |

Quick-login pill buttons are available on the login page for instant testing.
