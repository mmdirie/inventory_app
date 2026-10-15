-- ========================================================
-- INVENTORY MANAGEMENT SYSTEM - SEED DATA
-- Sample accounts are disabled; use database/seed.js with unique SEED_*_PASSWORD values to bootstrap active users.
-- ========================================================

USE inventory_management;

-- 1. Permissions
INSERT INTO permissions (name, description) VALUES
('dashboard.view', 'View dashboard metrics and analytics'),
('products.view', 'View product catalog'),
('products.create', 'Create new products'),
('products.update', 'Edit product details'),
('products.delete', 'Deactivate or delete products'),
('categories.view', 'View product categories'),
('categories.manage', 'Manage product categories'),
('brands.view', 'View product brands'),
('brands.manage', 'Manage product brands'),
('warehouses.view', 'View warehouse facilities'),
('warehouses.manage', 'Manage warehouses and locations'),
('suppliers.view', 'View suppliers'),
('suppliers.manage', 'Manage suppliers and balances'),
('customers.view', 'View customer list'),
('customers.manage', 'Manage customers and credit limits'),
('purchases.view', 'View purchase orders'),
('purchases.create', 'Create new purchase orders and receive stock'),
('sales.view', 'View sales records'),
('sales.create', 'Create sales and operate POS terminal'),
('stock.view', 'View inventory and movements'),
('stock.adjust', 'Perform stock adjustments'),
('stock.transfer', 'Initiate and manage warehouse transfers'),
('returns.view', 'View customer and supplier returns'),
('returns.create', 'Process returns and inventory reversals'),
('expenses.view', 'View business expenses'),
('expenses.manage', 'Create and manage expenses'),
('payments.view', 'View financial payments'),
('payments.manage', 'Process customer and supplier payments'),
('invoices.view', 'View and print sales invoices'),
('debts.view', 'View customer and supplier outstanding debts'),
('debts.manage', 'Collect and settle debts'),
('reports.view', 'Access sales, inventory, and financial reports'),
('users.manage', 'Create, edit, and deactivate user accounts'),
('settings.manage', 'Update organization and business configuration')
ON DUPLICATE KEY UPDATE description=VALUES(description);

-- 2. Role Permissions (Admin full access)
INSERT IGNORE INTO role_permissions (role, permission)
SELECT 'Admin', name FROM permissions;

-- Manager
INSERT IGNORE INTO role_permissions (role, permission)
SELECT 'Manager', name FROM permissions 
WHERE name NOT LIKE 'users.%' AND name NOT LIKE 'settings.%';

-- Sales
INSERT IGNORE INTO role_permissions (role, permission) VALUES
('Sales', 'dashboard.view'),
('Sales', 'products.view'),
('Sales', 'customers.view'),
('Sales', 'customers.manage'),
('Sales', 'sales.view'),
('Sales', 'sales.create'),
('Sales', 'invoices.view'),
('Sales', 'returns.view'),
('Sales', 'returns.create'),
('Sales', 'debts.view');

-- Inventory
INSERT IGNORE INTO role_permissions (role, permission) VALUES
('Inventory', 'dashboard.view'),
('Inventory', 'products.view'),
('Inventory', 'products.create'),
('Inventory', 'products.update'),
('Inventory', 'categories.view'),
('Inventory', 'brands.view'),
('Inventory', 'warehouses.view'),
('Inventory', 'purchases.view'),
('Inventory', 'purchases.create'),
('Inventory', 'stock.view'),
('Inventory', 'stock.adjust'),
('Inventory', 'stock.transfer'),
('Inventory', 'suppliers.view'),
('Inventory', 'reports.view');

-- Accountant
INSERT IGNORE INTO role_permissions (role, permission) VALUES
('Accountant', 'dashboard.view'),
('Accountant', 'sales.view'),
('Accountant', 'purchases.view'),
('Accountant', 'expenses.view'),
('Accountant', 'expenses.manage'),
('Accountant', 'payments.view'),
('Accountant', 'payments.manage'),
('Accountant', 'invoices.view'),
('Accountant', 'debts.view'),
('Accountant', 'debts.manage'),
('Accountant', 'reports.view');

-- 3. Disabled sample users. Active bootstrap credentials must be supplied to database/seed.js.
INSERT INTO users (id, name, email, password_hash, role, phone, status) VALUES
(1, 'Alex Mercer (Admin)', 'admin@apexinventory.com', '$2b$10$b77ReUHdbOW/LPj.Q0sJpOog/VKOkAedAhUkbZy8ew4GmIz1E2YNq', 'Admin', '+1 (555) 100-0001', 'inactive'),
(2, 'Sarah Jenkins (Manager)', 'manager@apexinventory.com', '$2b$10$13DD3Bj/0f5JEaSgwQKM9uw8eTFIka9SHpXRUoWy8dnJ6FKoO6dpS', 'Manager', '+1 (555) 100-0002', 'inactive'),
(3, 'David Rossi (Sales Lead)', 'sales@apexinventory.com', '$2b$10$tDY6HgfP8c9.Z62KFCMyDO.JyEsOnLNbi7Qv.0KjiV35eZtjWm4f.', 'Sales', '+1 (555) 100-0003', 'inactive'),
(4, 'Elena Rostova (Inventory Lead)', 'inventory@apexinventory.com', '$2b$10$sa6/02mDshKJE8vioPMiF.XQRUMTrvUWJ3q5aWfXcLsMGqfAfTrW2', 'Inventory', '+1 (555) 100-0004', 'inactive'),
(5, 'Michael Chang (Lead Accountant)', 'accountant@apexinventory.com', '$2b$10$C.WAWdhtnWgimuSFH5Ekj.KnyDcU/kJlQDVVHQV4IG1JN.EJRjVS.', 'Accountant', '+1 (555) 100-0005', 'inactive')
ON DUPLICATE KEY UPDATE
  name=VALUES(name),
  password_hash=VALUES(password_hash),
  status=VALUES(status);

-- 4. Settings
INSERT INTO settings (id, business_name, business_logo, phone, email, address, currency, currency_symbol_position, tax_rate, invoice_prefix, purchase_prefix, invoice_number_format, date_format, timezone, low_stock_threshold, receipt_footer)
VALUES (1, 'Apex Commercial Supplies Ltd', '', '+1 (555) 234-5678', 'contact@apexsupplies.com', '742 Evergreen Commercial Plaza, Suite 400, Chicago, IL 60601', '$', 'before', 7.50, 'INV-', 'PO-', 'PREFIX-YEAR-SEQ', 'YYYY-MM-DD', 'America/Chicago', 8, 'Thank you for your business! Goods once sold can be returned within 14 days with original receipt.')
ON DUPLICATE KEY UPDATE business_name=VALUES(business_name);

-- 5. Warehouses
INSERT INTO warehouses (id, name, location, manager, phone, description, status, is_default) VALUES
(1, 'Main Central Distribution Center', '1000 Logistics Blvd, Chicago, IL', 'Elena Rostova', '+1 (555) 234-5680', 'Primary multi-story warehouse facility for bulk and pallet storage', 'active', 1),
(2, 'Downtown Retail & Express Hub', '450 State Street, Chicago, IL', 'Marcus Vance', '+1 (555) 234-5681', 'Express storefront stock and customer pickup distribution point', 'active', 0),
(3, 'West Suburb Storage Depot', '88 River Ridge Road, Aurora, IL', 'Rachel Adams', '+1 (555) 234-5682', 'Secondary overflow facility for seasonal items and large electronics', 'active', 0)
ON DUPLICATE KEY UPDATE name=VALUES(name);

-- 6. Categories
INSERT INTO categories (id, name, description, status) VALUES
(1, 'Computers & Laptops', 'High performance enterprise workstations, business notebooks, and servers', 'active'),
(2, 'Computer Accessories', 'Mice, mechanical keyboards, webcams, docks, and desktop peripherals', 'active'),
(3, 'Monitors & Displays', '4K UHD and ultra-wide productivity panels and color-accurate monitors', 'active'),
(4, 'Networking Equipment', 'Managed switches, Wi-Fi 6 enterprise routers, and patch cables', 'active'),
(5, 'Office Printing & Imaging', 'Laser multifunction printers, toner cartridges, and thermal barcode printers', 'active'),
(6, 'Office Ergonomics', 'High-end mesh executive chairs, standing desk risers, and monitor arms', 'active')
ON DUPLICATE KEY UPDATE name=VALUES(name);

-- 7. Brands
INSERT INTO brands (id, name, description, status) VALUES
(1, 'Dell Technologies', 'Global provider of enterprise hardware and workstations', 'active'),
(2, 'Logitech', 'Swiss manufacturer of professional workplace peripherals', 'active'),
(3, 'Cisco Systems', 'Worldwide leader in networking and security infrastructure', 'active'),
(4, 'HP Inc.', 'Personal systems, commercial laser printers, and imaging', 'active'),
(5, 'Apple', 'Premium enterprise laptops, tablets, and silicon computers', 'active'),
(6, 'Herman Miller', 'Industry-leading ergonomic architectural workplace seating', 'active')
ON DUPLICATE KEY UPDATE name=VALUES(name);

-- 8. Suppliers
INSERT INTO suppliers (id, name, company, phone, email, address, city, country, tax_number, balance, notes, status) VALUES
(1, 'TechDistro North America', 'TechDistro Global Corp', '+1 (555) 880-1122', 'orders@techdistro.com', '900 Global Logistics Way', 'Dallas', 'USA', 'US-TX-998812', 1450.00, 'Preferred partner for Dell and Cisco shipments. Net-30 payment terms.', 'active'),
(2, 'Peripheral Plus Wholesale', 'PPI Solutions LLC', '+1 (555) 880-3344', 'sales@peripheralplus.com', '1240 Bayview Industrial Blvd', 'San Jose', 'USA', 'US-CA-771120', 0.00, 'Primary distributor for Logitech accessories and cabling.', 'active'),
(3, 'Apex Imaging & Print Logistics', 'Apex Print Distributors Inc', '+1 (555) 880-5566', 'accounts@apexprint.com', '310 Printing Way', 'Atlanta', 'USA', 'US-GA-445566', 820.00, 'Reliable source for HP hardware and consumables. 2% discount on early settlement.', 'active')
ON DUPLICATE KEY UPDATE name=VALUES(name);

-- 9. Customers
INSERT INTO customers (id, name, phone, email, address, city, customer_type, credit_limit, balance, notes, status) VALUES
(1, 'Acme Global Technologies', '+1 (555) 441-0001', 'procurement@acmeglobal.com', '500 Tech Parkway, Suite 1200', 'Chicago', 'Corporate', 25000.00, 1850.00, 'Key corporate client. Requires detailed consolidated monthly invoices.', 'active'),
(2, 'Midwest Tech Retailers', '+1 (555) 441-0002', 'buying@midwesttech.com', '820 Commerce Road', 'Milwaukee', 'Wholesale', 10000.00, 620.00, 'Authorized reseller account with tiered wholesale pricing.', 'active'),
(3, 'Horizon Architecture Group', '+1 (555) 441-0003', 'studio@horizonarch.com', '150 Michigan Avenue', 'Chicago', 'Corporate', 15000.00, 0.00, 'Regular purchaser of 4K ultra-wide monitors and high-end design workstations.', 'active'),
(4, 'Walk-in Retail Customer', '+1 (555) 000-0000', 'walkin@apexsupplies.com', 'Counter Sales - Chicago Main', 'Chicago', 'Retail', 0.00, 0.00, 'Default customer record for direct over-the-counter POS cash transactions.', 'active')
ON DUPLICATE KEY UPDATE name=VALUES(name);
