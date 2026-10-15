# Database Architecture & Data Dictionary

The **Apex Inventory Management System** uses a relational database schema designed for **one single business / enterprise organization** (strict single-tenant design).

The database engine is **MySQL / MariaDB** utilizing the **InnoDB** storage engine to support ACID transactions, row-level locking, and foreign key referential integrity.

---

## Entity Relationship Overview

The schema consists of 28 tables organized into 8 functional subsystems:

```
[Users & Roles]       [Catalog]             [Facilities]
 - users               - categories          - warehouses
 - permissions         - brands              - warehouse_stock
 - role_permissions    - products            - stock_movements
 - audit_logs

[Purchasing]           [Sales & POS]         [Finance]
 - suppliers           - customers           - invoices
 - purchases           - sales               - payments
 - purchase_items      - sale_items          - debts
                                             - expenses

[Operations]           [Configuration]
 - stock_transfers     - settings
 - stock_transfer_items
 - stock_adjustments
 - returns
 - return_items
```

---

## Data Dictionary

### 1. Security & Authentication

#### `users`
Stores system staff accounts with hashed credentials and role assignments.
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INT | PK, AI | Unique user identifier |
| `name` | VARCHAR(100) | NOT NULL | Full name of the employee |
| `email` | VARCHAR(150) | NOT NULL, UNIQUE | Authentication login email |
| `password_hash` | VARCHAR(255) | NOT NULL | bcrypt password hash (salt rounds: 10) |
| `role` | ENUM | NOT NULL | `'Admin'`, `'Manager'`, `'Sales'`, `'Inventory'`, `'Accountant'` |
| `phone` | VARCHAR(50) | NULL | Staff contact number |
| `status` | ENUM | NOT NULL | `'active'`, `'inactive'` |
| `last_login` | TIMESTAMP | NULL | Timestamp of latest successful session |
| `created_at` | TIMESTAMP | DEFAULT NOW | Account creation timestamp |
| `updated_at` | TIMESTAMP | ON UPDATE NOW | Modification timestamp |

#### `permissions` & `role_permissions`
Defines granular module permissions (e.g. `products.create`, `sales.manage`) and maps them to standard roles.

#### `audit_logs`
Immutable audit trail logging every state modification across the application with user attribution and IP address.

---

### 2. Product Catalog & Facilities

#### `products`
Master catalog table containing inventory definitions, pricing tiers, and reorder levels.
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INT | PK, AI | Product primary key |
| `sku` | VARCHAR(100) | NOT NULL, UNIQUE | Stock Keeping Unit |
| `barcode` | VARCHAR(100) | NOT NULL, UNIQUE | EAN-13 or Code-128 barcode string |
| `name` | VARCHAR(200) | NOT NULL | Product trade name |
| `category_id` | INT | FK -> `categories.id` | Associated product category |
| `brand_id` | INT | FK -> `brands.id` | Brand / manufacturer |
| `supplier_id` | INT | FK -> `suppliers.id` | Default primary vendor |
| `default_warehouse_id` | INT | FK -> `warehouses.id` | Primary fulfillment facility |
| `purchase_price` | DECIMAL(12,2)| NOT NULL | Unit procurement cost |
| `selling_price` | DECIMAL(12,2)| NOT NULL | Standard retail unit selling price |
| `wholesale_price` | DECIMAL(12,2)| NOT NULL | Bulk unit discount price |
| `min_stock_level` | INT | NOT NULL (def: 5) | Safety threshold for low-stock alerts |
| `current_stock` | INT | NOT NULL (def: 0) | Aggregate business-wide stock level |
| `unit` | VARCHAR(50) | NOT NULL (def: 'pcs')| Unit of measurement (pcs, kg, box, etc.)|
| `status` | ENUM | NOT NULL | `'active'`, `'inactive'` |

#### `warehouses` & `warehouse_stock`
- `warehouses`: Physical storage facilities and retail store branches.
- `warehouse_stock`: Composite table (`warehouse_id`, `product_id`) with UNIQUE constraint tracking exact unit count in each specific warehouse.

#### `stock_movements`
The double-entry inventory ledger recording every positive or negative unit change:
- Types: `Purchase`, `Sale`, `Transfer`, `Adjustment`, `Return`, `Opening Stock`
- Stores `product_id`, `warehouse_id`, `quantity` (+/-), `reference_type`, `reference_id`, and `user_id`.

---

### 3. Commercial Operations

#### `purchases` & `purchase_items`
Procurement orders from registered suppliers.
- Increasing stock atomically in the receiving warehouse.
- Recording unpaid balances as debts.

#### `sales` & `sale_items`
Point-of-Sale (POS) and wholesale invoices.
- Decreasing stock atomically via InnoDB `FOR UPDATE` row locks to prevent overselling.
- Generates linked `invoices` records.
- Records customer credit/receivables if unpaid.

#### `stock_transfers` & `stock_transfer_items`
Inter-warehouse inventory movements with workflow status: `Pending` -> `Approved` -> `Completed` -> `Cancelled`. Stock is only deducted from source and credited to destination when status reaches `Completed`.

#### `stock_adjustments`
Manual count adjustments (increase or decrease) with audit reason and auditor user ID.

#### `returns` & `return_items`
- **Sale Return:** Customer returns goods -> stock is added back to warehouse; refund is issued or customer debt reduced.
- **Purchase Return:** Defective goods returned to vendor -> stock deducted from warehouse; vendor debt reduced.

---

### 4. Financial Accounting & Debts

#### `invoices`
Formal tax invoices for each sale with itemized breakdown, tax computation, discount, paid amount, and outstanding balance.

#### `payments`
Unified transaction log for all liquidity movements:
- Customer sales receipts
- Customer debt repayments
- Supplier purchase settlements
- Operating expense disbursements

#### `debts`
Centralized debt ledger for customer receivables and supplier payables with tracking of due dates and overdue statuses.

#### `expenses`
Operational overhead expenses (Rent, Utilities, Salaries, Transport, etc.).

#### `settings`
Single-record organization settings: business name, address, tax rate, currency symbol & position, and invoice numbering format.
