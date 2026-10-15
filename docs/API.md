# REST API Reference Documentation

All endpoints return JSON responses with standard payload wrappers:

```json
{
  "success": true,
  "data": { ... },
  "message": "Human readable confirmation"
}
```

In error scenarios:
```json
{
  "success": false,
  "message": "Specific error description"
}
```

Authentication is performed via HTTP Bearer Tokens in the `Authorization` header:
```
Authorization: Bearer <jwt_token>
```

---

## 1. Authentication (`/api/auth`)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `POST` | `/api/auth/login` | Public | Authenticates credentials and returns JWT token & user profile |
| `POST` | `/api/auth/logout` | Authenticated | Invalidates session |
| `GET` | `/api/auth/me` | Authenticated | Returns current authenticated user record |
| `PUT` | `/api/auth/profile` | Authenticated | Updates staff profile name and phone |
| `PUT` | `/api/auth/change-password` | Authenticated | Changes password with current password verification |

---

## 2. Dashboard Analytics (`/api/dashboard`)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `GET` | `/api/dashboard/stats` | `dashboard.view` | Returns aggregate counts, today's sales, revenue, low stock items, 7-day revenue trend |

---

## 3. Product Catalog (`/api/products`)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `GET` | `/api/products` | `products.view` | Query products with pagination, search, category, brand, warehouse, and low-stock filter; warehouse-filtered results include `warehouse_quantity` |
| `GET` | `/api/products/:id` | `products.view` | Get product details including warehouse stock breakdown |
| `POST` | `/api/products` | `products.create` | Create new product (validates unique SKU and barcode) |
| `PUT` | `/api/products/:id` | `products.edit` | Update product information |
| `DELETE`| `/api/products/:id` | `products.delete` | Soft delete / deactivate product |

---

## 4. Categories & Brands (`/api/categories`, `/api/brands`)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `GET` | `/api/categories` | `categories.view` | List product categories with product counts |
| `POST` | `/api/categories` | `categories.create` | Add new category |
| `PUT` | `/api/categories/:id`| `categories.edit` | Edit category name & description |
| `DELETE`| `/api/categories/:id`| `categories.delete`| Remove category |
| `GET` | `/api/brands` | `brands.view` | List registered brands |
| `POST` | `/api/brands` | `brands.create` | Create new brand |
| `PUT` | `/api/brands/:id` | `brands.edit` | Update brand details |
| `DELETE`| `/api/brands/:id` | `brands.delete` | Delete brand |

---

## 5. Facilities & Warehouses (`/api/warehouses`)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `GET` | `/api/warehouses` | `warehouses.view` | List all business warehouses and facilities |
| `GET` | `/api/warehouses/:id`| `warehouses.view` | Facility details with current stock inventory |
| `POST` | `/api/warehouses` | `warehouses.manage` | Add new warehouse facility |
| `PUT` | `/api/warehouses/:id`| `warehouses.manage` | Update facility details or change manager |

---

## 6. Suppliers & Customers (`/api/suppliers`, `/api/customers`)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `GET` | `/api/suppliers` | `suppliers.view` | List suppliers with balance and purchase counts |
| `POST` | `/api/suppliers` | `suppliers.manage` | Register new supplier |
| `PUT` | `/api/suppliers/:id` | `suppliers.manage` | Update supplier profile |
| `GET` | `/api/customers` | `customers.view` | List customers with credit limits and balances |
| `POST` | `/api/customers` | `customers.manage` | Create customer profile |
| `PUT` | `/api/customers/:id` | `customers.manage` | Edit customer contact and credit terms |

---

## 7. Purchasing (`/api/purchases`)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `GET` | `/api/purchases` | `purchases.view` | List purchase orders with payment statuses |
| `GET` | `/api/purchases/:id` | `purchases.view` | Purchase order line items and receiving facility |
| `POST` | `/api/purchases` | `purchases.create` | Execute atomic PO: adds inventory, creates supplier debt if unpaid |

---

## 8. Sales & POS (`/api/sales`)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `GET` | `/api/sales` | `sales.view` | Sales order history and receipts |
| `GET` | `/api/sales/:id` | `sales.view` | Sale receipt breakdown with customer and cashier details |
| `POST` | `/api/sales` | `sales.create` | Process checkout atomically: locks stock rows, validates database prices and configured tax, deducts inventory, and creates payment/invoice records |

Sale creation requires an `Idempotency-Key` header containing 8–128 safe characters. Repeating the same key and request returns the original sale; reusing a key with a different request returns `409 Conflict`. The POS register generates and reuses this key automatically when retrying a submission.

---

## 9. Inventory Ledger (`/api/stock`, `/api/transfers`, `/api/adjustments`)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `GET` | `/api/stock/overview` | `stock.view` | Consolidated inventory counts by warehouse |
| `GET` | `/api/stock/movements`| `stock.view` | Double-entry stock audit log |
| `GET` | `/api/stock/low-stock`| `stock.view` | Products below minimum safety reorder thresholds |
| `GET` | `/api/transfers` | `stock.view` | Inter-warehouse stock transfers |
| `POST` | `/api/transfers` | `stock.manage` | Initiate inter-warehouse transfer |
| `PUT` | `/api/transfers/:id/status` | `stock.manage` | Approve or Complete transfer (moves stock atomically) |
| `GET` | `/api/adjustments` | `stock.view` | List stock audit count corrections |
| `POST` | `/api/adjustments` | `stock.manage` | Commit stock adjustment with reason |

---

## 10. Returns (`/api/returns`)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `GET` | `/api/returns` | `returns.view` | Query sales and purchase returns |
| `GET` | `/api/returns/:id` | `returns.view` | View itemized return details |
| `POST` | `/api/returns` | `returns.create` | Process return: reverses stock and updates customer/vendor debt |

---

## 11. Finance & Debts (`/api/expenses`, `/api/payments`, `/api/invoices`, `/api/debts`)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `GET` | `/api/expenses` | `expenses.view` | Operating expenses with category filters |
| `POST` | `/api/expenses` | `expenses.manage`| Record overhead expense |
| `DELETE`| `/api/expenses/:id` | `expenses.manage`| Delete expense entry |
| `GET` | `/api/payments` | `payments.view` | Unified payments ledger |
| `POST` | `/api/payments` | `payments.create`| Record manual customer/supplier payment |
| `GET` | `/api/invoices` | `invoices.view` | Search and list sales invoices |
| `GET` | `/api/invoices/:id` | `invoices.view` | Printable A4 invoice layout data with business settings |
| `GET` | `/api/debts` | `debts.view` | Customer receivables and supplier payables |
| `POST` | `/api/debts/:id/pay`| `debts.manage`| Settle or partially pay outstanding debt |

---

## 12. Reports & Analytics (`/api/reports`)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `GET` | `/api/reports/sales` | `reports.view` | Aggregated sales by date, month, product, customer, or staff |
| `GET` | `/api/reports/purchases`| `reports.view` | Procurement expenditure by date, supplier, or product |
| `GET` | `/api/reports/inventory`| `reports.view` | Real-time valuation (cost vs retail) and category distribution |
| `GET` | `/api/reports/financial`| `reports.view` | Profit and Loss (P&L) summary and working capital liquidity |

---

## 13. Users & System Settings (`/api/users`, `/api/settings`, `/api/barcode`)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `GET` | `/api/users` | `users.manage` | List organization staff accounts |
| `POST` | `/api/users` | `users.manage` | Provision new employee account with role |
| `PUT` | `/api/users/:id` | `users.manage` | Update user role and contact |
| `PUT` | `/api/users/:id/status`| `users.manage`| Toggle active/inactive account status |
| `GET` | `/api/users/audit-logs` | `users.manage`| Paginated administrative audit logs |
| `GET` | `/api/settings` | Public | Read organization business preferences |
| `PUT` | `/api/settings` | `settings.manage`| Update business name, tax rate, currency, invoice prefix |
| `GET` | `/api/barcode/lookup/:code` | `products.view`| Fast scan lookup by barcode or SKU |
| `GET` | `/api/barcode/generate-suggested`| `products.view`| Generates verified unique EAN-13 candidate |
