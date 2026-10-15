const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
require('dotenv').config();

function getSeedPasswords() {
  const passwords = {
    admin: process.env.SEED_ADMIN_PASSWORD,
    manager: process.env.SEED_MANAGER_PASSWORD,
    sales: process.env.SEED_SALES_PASSWORD,
    inventory: process.env.SEED_INVENTORY_PASSWORD,
    accountant: process.env.SEED_ACCOUNTANT_PASSWORD
  };
  const entries = Object.entries(passwords);
  const invalid = entries.filter(([, password]) => !password || password.trim().length < 12);

  if (invalid.length > 0) {
    throw new Error(`Set unique seed passwords of at least 12 characters: ${invalid.map(([role]) => `SEED_${role.toUpperCase()}_PASSWORD`).join(', ')}`);
  }

  if (new Set(Object.values(passwords)).size !== entries.length) {
    throw new Error('Each seeded role must use a different password.');
  }

  return passwords;
}

async function runSeed() {
  const seedPasswords = getSeedPasswords();
  const seedHashes = {
    admin: await bcrypt.hash(seedPasswords.admin, 10),
    manager: await bcrypt.hash(seedPasswords.manager, 10),
    sales: await bcrypt.hash(seedPasswords.sales, 10),
    inventory: await bcrypt.hash(seedPasswords.inventory, 10),
    accountant: await bcrypt.hash(seedPasswords.accountant, 10)
  };

  console.log('--- Seeding Database with Realistic Production Data ---');

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'inventory_management',
    multipleStatements: true
  });

  try {
    // 1. Roles & Permissions
    console.log('Inserting Permissions & Role mappings...');
    const permissions = [
      ['dashboard.view', 'View dashboard metrics and analytics'],
      ['products.view', 'View product catalog'],
      ['products.create', 'Create new products'],
      ['products.update', 'Edit product details'],
      ['products.delete', 'Deactivate or delete products'],
      ['categories.view', 'View product categories'],
      ['categories.manage', 'Manage product categories'],
      ['brands.view', 'View product brands'],
      ['brands.manage', 'Manage product brands'],
      ['warehouses.view', 'View warehouse facilities'],
      ['warehouses.manage', 'Manage warehouses and locations'],
      ['suppliers.view', 'View suppliers'],
      ['suppliers.manage', 'Manage suppliers and balances'],
      ['customers.view', 'View customer list'],
      ['customers.manage', 'Manage customers and credit limits'],
      ['purchases.view', 'View purchase orders'],
      ['purchases.create', 'Create new purchase orders and receive stock'],
      ['sales.view', 'View sales records'],
      ['sales.create', 'Create sales and operate POS terminal'],
      ['stock.view', 'View inventory and movements'],
      ['stock.adjust', 'Perform stock adjustments'],
      ['stock.transfer', 'Initiate and manage warehouse transfers'],
      ['returns.view', 'View customer and supplier returns'],
      ['returns.create', 'Process returns and inventory reversals'],
      ['expenses.view', 'View business expenses'],
      ['expenses.manage', 'Create and manage expenses'],
      ['payments.view', 'View financial payments'],
      ['payments.manage', 'Process customer and supplier payments'],
      ['invoices.view', 'View and print sales invoices'],
      ['debts.view', 'View customer and supplier outstanding debts'],
      ['debts.manage', 'Collect and settle debts'],
      ['reports.view', 'Access sales, inventory, and financial reports'],
      ['users.manage', 'Create, edit, and deactivate user accounts'],
      ['settings.manage', 'Update organization and business configuration']
    ];

    await connection.query('DELETE FROM role_permissions');
    await connection.query('DELETE FROM permissions');

    for (const [name, desc] of permissions) {
      await connection.query('INSERT INTO permissions (name, description) VALUES (?, ?)', [name, desc]);
    }

    // Role permissions assignment
    // Admin gets all permissions
    for (const [name] of permissions) {
      await connection.query('INSERT INTO role_permissions (role, permission) VALUES (?, ?)', ['Admin', name]);
    }

    // Manager
    const managerPerms = permissions.map(p => p[0]).filter(p => !p.startsWith('users.') && !p.startsWith('settings.'));
    for (const p of managerPerms) {
      await connection.query('INSERT INTO role_permissions (role, permission) VALUES (?, ?)', ['Manager', p]);
    }

    // Sales
    const salesPerms = ['dashboard.view', 'products.view', 'customers.view', 'customers.manage', 'sales.view', 'sales.create', 'invoices.view', 'returns.view', 'returns.create', 'debts.view'];
    for (const p of salesPerms) {
      await connection.query('INSERT INTO role_permissions (role, permission) VALUES (?, ?)', ['Sales', p]);
    }

    // Inventory
    const invPerms = ['dashboard.view', 'products.view', 'products.create', 'products.update', 'categories.view', 'brands.view', 'warehouses.view', 'purchases.view', 'purchases.create', 'stock.view', 'stock.adjust', 'stock.transfer', 'suppliers.view', 'reports.view'];
    for (const p of invPerms) {
      await connection.query('INSERT INTO role_permissions (role, permission) VALUES (?, ?)', ['Inventory', p]);
    }

    // Accountant
    const acctPerms = ['dashboard.view', 'sales.view', 'purchases.view', 'expenses.view', 'expenses.manage', 'payments.view', 'payments.manage', 'invoices.view', 'debts.view', 'debts.manage', 'reports.view'];
    for (const p of acctPerms) {
      await connection.query('INSERT INTO role_permissions (role, permission) VALUES (?, ?)', ['Accountant', p]);
    }

    // 2. Users
    console.log('Inserting Seed Users with hashed passwords...');
    await connection.query('DELETE FROM users');
    
    const users = [
      ['Alex Mercer (Admin)', 'admin@apexinventory.com', seedHashes.admin, 'Admin', '+1 (555) 100-0001', 'active'],
      ['Sarah Jenkins (Manager)', 'manager@apexinventory.com', seedHashes.manager, 'Manager', '+1 (555) 100-0002', 'active'],
      ['David Rossi (Sales Lead)', 'sales@apexinventory.com', seedHashes.sales, 'Sales', '+1 (555) 100-0003', 'active'],
      ['Elena Rostova (Inventory Lead)', 'inventory@apexinventory.com', seedHashes.inventory, 'Inventory', '+1 (555) 100-0004', 'active'],
      ['Michael Chang (Lead Accountant)', 'accountant@apexinventory.com', seedHashes.accountant, 'Accountant', '+1 (555) 100-0005', 'active']
    ];

    for (const u of users) {
      await connection.query(
        'INSERT INTO users (name, email, password_hash, role, phone, status) VALUES (?, ?, ?, ?, ?, ?)',
        u
      );
    }

    // 3. Settings
    console.log('Configuring default Business Settings...');
    await connection.query('DELETE FROM settings');
    await connection.query(`
      INSERT INTO settings (id, business_name, business_logo, phone, email, address, currency, currency_symbol_position, tax_rate, invoice_prefix, purchase_prefix, invoice_number_format, date_format, timezone, low_stock_threshold, receipt_footer)
      VALUES (1, 'Apex Commercial Supplies Ltd', '', '+1 (555) 234-5678', 'contact@apexsupplies.com', '742 Evergreen Commercial Plaza, Suite 400, Chicago, IL 60601', '$', 'before', 7.50, 'INV-', 'PO-', 'PREFIX-YEAR-SEQ', 'YYYY-MM-DD', 'America/Chicago', 8, 'Thank you for your business! Goods once sold can be returned within 14 days with original receipt.')
    `);

    // 4. Warehouses
    console.log('Inserting Warehouses...');
    await connection.query('DELETE FROM warehouses');
    const warehouses = [
      ['Main Central Distribution Center', '1000 Logistics Blvd, Chicago, IL', 'Elena Rostova', '+1 (555) 234-5680', 'Primary multi-story warehouse facility for bulk and pallet storage', 'active', 1],
      ['Downtown Retail & Express Hub', '450 State Street, Chicago, IL', 'Marcus Vance', '+1 (555) 234-5681', 'Express storefront stock and customer pickup distribution point', 'active', 0],
      ['West Suburb Storage Depot', '88 River Ridge Road, Aurora, IL', 'Rachel Adams', '+1 (555) 234-5682', 'Secondary overflow facility for seasonal items and large electronics', 'active', 0]
    ];
    for (const w of warehouses) {
      await connection.query(
        'INSERT INTO warehouses (name, location, manager, phone, description, status, is_default) VALUES (?, ?, ?, ?, ?, ?, ?)',
        w
      );
    }

    // 5. Categories
    console.log('Inserting Categories...');
    await connection.query('DELETE FROM categories');
    const categories = [
      ['Computers & Laptops', 'High performance enterprise workstations, business notebooks, and servers', 'active'],
      ['Computer Accessories', 'Mice, mechanical keyboards, webcams, docks, and desktop peripherals', 'active'],
      ['Monitors & Displays', '4K UHD and ultra-wide productivity panels and color-accurate monitors', 'active'],
      ['Networking Equipment', 'Managed switches, Wi-Fi 6 enterprise routers, and patch cables', 'active'],
      ['Office Printing & Imaging', 'Laser multifunction printers, toner cartridges, and thermal barcode printers', 'active'],
      ['Office Ergonomics', 'High-end mesh executive chairs, standing desk risers, and monitor arms', 'active']
    ];
    for (const c of categories) {
      await connection.query('INSERT INTO categories (name, description, status) VALUES (?, ?, ?)', c);
    }

    // 6. Brands
    console.log('Inserting Brands...');
    await connection.query('DELETE FROM brands');
    const brands = [
      ['Dell Technologies', 'Global provider of enterprise hardware and workstations', 'active'],
      ['Logitech', 'Swiss manufacturer of professional workplace peripherals', 'active'],
      ['Cisco Systems', 'Worldwide leader in networking and security infrastructure', 'active'],
      ['HP Inc.', 'Personal systems, commercial laser printers, and imaging', 'active'],
      ['Apple', 'Premium enterprise laptops, tablets, and silicon computers', 'active'],
      ['Herman Miller', 'Industry-leading ergonomic architectural workplace seating', 'active']
    ];
    for (const b of brands) {
      await connection.query('INSERT INTO brands (name, description, status) VALUES (?, ?, ?)', b);
    }

    // 7. Suppliers
    console.log('Inserting Suppliers...');
    await connection.query('DELETE FROM suppliers');
    const suppliers = [
      ['TechDistro North America', 'TechDistro Global Corp', '+1 (555) 880-1122', 'orders@techdistro.com', '900 Global Logistics Way', 'Dallas', 'USA', 'US-TX-998812', 1450.00, 'Preferred partner for Dell and Cisco shipments. Net-30 payment terms.', 'active'],
      ['Peripheral Plus Wholesale', 'PPI Solutions LLC', '+1 (555) 880-3344', 'sales@peripheralplus.com', '1240 Bayview Industrial Blvd', 'San Jose', 'USA', 'US-CA-771120', 0.00, 'Primary distributor for Logitech accessories and cabling.', 'active'],
      ['Apex Imaging & Print Logistics', 'Apex Print Distributors Inc', '+1 (555) 880-5566', 'accounts@apexprint.com', '310 Printing Way', 'Atlanta', 'USA', 'US-GA-445566', 820.00, 'Reliable source for HP hardware and consumables. 2% discount on early settlement.', 'active']
    ];
    for (const s of suppliers) {
      await connection.query(
        'INSERT INTO suppliers (name, company, phone, email, address, city, country, tax_number, balance, notes, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        s
      );
    }

    // 8. Customers
    console.log('Inserting Customers...');
    await connection.query('DELETE FROM customers');
    const customers = [
      ['Acme Global Technologies', '+1 (555) 441-0001', 'procurement@acmeglobal.com', '500 Tech Parkway, Suite 1200', 'Chicago', 'Corporate', 25000.00, 1850.00, 'Key corporate client. Requires detailed consolidated monthly invoices.', 'active'],
      ['Midwest Tech Retailers', '+1 (555) 441-0002', 'buying@midwesttech.com', '820 Commerce Road', 'Milwaukee', 'Wholesale', 10000.00, 620.00, 'Authorized reseller account with tiered wholesale pricing.', 'active'],
      ['Horizon Architecture Group', '+1 (555) 441-0003', 'studio@horizonarch.com', '150 Michigan Avenue', 'Chicago', 'Corporate', 15000.00, 0.00, 'Regular purchaser of 4K ultra-wide monitors and high-end design workstations.', 'active'],
      ['Walk-in Retail Customer', '+1 (555) 000-0000', 'walkin@apexsupplies.com', 'Counter Sales - Chicago Main', 'Chicago', 'Retail', 0.00, 0.00, 'Default customer record for direct over-the-counter POS cash transactions.', 'active']
    ];
    for (const c of customers) {
      await connection.query(
        'INSERT INTO customers (name, phone, email, address, city, customer_type, credit_limit, balance, notes, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        c
      );
    }

    // 9. Products
    console.log('Inserting Products & Stock Levels...');
    await connection.query('DELETE FROM products');
    const products = [
      ['SKU-LAP-001', '890123450001', 'Dell Latitude 5540 15.6" Laptop (i7/32GB/1TB)', 'Enterprise laptop with Intel Core i7, 32GB DDR5 RAM, 1TB NVMe SSD, Windows 11 Pro', 1, 1, 1, 1, 750.00, 1099.00, 940.00, 5, 24, 'units', 'active'],
      ['SKU-LAP-002', '890123450002', 'Apple MacBook Air 15" M3 (16GB/512GB)', 'Starlight finish, Apple M3 chip, 16GB unified memory, 512GB fast storage', 1, 5, 1, 1, 980.00, 1349.00, 1199.00, 4, 12, 'units', 'active'],
      ['SKU-MOU-001', '890123450003', 'Logitech MX Master 3S Wireless Performance Mouse', 'Quiet clicks, 8K DPI any-surface sensor, MagSpeed electromagnetic scrolling', 2, 2, 2, 1, 58.00, 99.99, 82.00, 10, 45, 'pcs', 'active'],
      ['SKU-KEY-001', '890123450004', 'Logitech MX Mechanical Wireless Keyboard', 'Tactile quiet low-profile mechanical switches, smart backlighting, multi-device flow', 2, 2, 2, 1, 95.00, 169.99, 140.00, 8, 30, 'pcs', 'active'],
      ['SKU-MON-001', '890123450005', 'Dell UltraSharp U2723QE 27" 4K UHD IPS USB-C Monitor', 'IPS Black technology, 98% DCI-P3, 90W USB-C power delivery, RJ45 Ethernet hub', 3, 1, 1, 1, 380.00, 579.00, 499.00, 6, 16, 'units', 'active'],
      ['SKU-NET-001', '890123450006', 'Cisco Catalyst 1000 24-Port Gigabit Managed Switch', '24x 10/100/1000 Ethernet ports, 4x 1G SFP uplinks, fanless silent operation', 4, 3, 1, 1, 420.00, 689.00, 595.00, 5, 11, 'units', 'active'],
      ['SKU-PRN-001', '890123450007', 'HP LaserJet Pro MFP 4101fdw All-in-One Printer', 'High speed duplex printing, copying, scanning, 42 ppm, dual-band Wi-Fi', 5, 4, 3, 1, 310.00, 479.99, 415.00, 5, 3, 'units', 'active'], // LOW STOCK (3 <= 5)
      ['SKU-CHR-001', '890123450008', 'Herman Miller Aeron Ergonomic Chair (Size B)', 'PostureFit SL back support, fully adjustable arms, breathable Pellicle 8Z mesh', 6, 6, 1, 1, 790.00, 1250.00, 1050.00, 4, 2, 'units', 'active'], // LOW STOCK (2 <= 4)
      ['SKU-DCK-001', '890123450009', 'Dell Thunderbolt 4 Dock WD22TB4 130W', 'Modular dual Thunderbolt 4 ports, supports up to three 4K displays or one 8K display', 2, 1, 1, 1, 140.00, 239.00, 195.00, 8, 22, 'pcs', 'active'],
      ['SKU-CAB-001', '890123450010', 'Cat6 Snagless Gigabit Ethernet Cable 25ft (Blue)', 'Pure bare copper wire, 550MHz bandwidth, gold-plated RJ45 connectors', 4, 3, 2, 1, 4.50, 14.99, 9.50, 20, 120, 'pcs', 'active'],
      ['SKU-TNR-001', '890123450011', 'HP 148X High Yield Black Original LaserJet Toner', 'Produces approximately 9,500 sharp, professional pages for HP LaserJet Pro 4000 series', 5, 4, 3, 1, 95.00, 159.00, 135.00, 6, 4, 'pcs', 'active'], // LOW STOCK (4 <= 6)
      ['SKU-CAM-001', '890123450012', 'Logitech Brio 4K Ultra HD Pro Business Webcam', 'RightLight 3 HDR, dual noise-canceling microphones, Windows Hello facial recognition', 2, 2, 2, 1, 110.00, 199.99, 165.00, 8, 19, 'pcs', 'active']
    ];

    for (const p of products) {
      await connection.query(
        `INSERT INTO products 
         (sku, barcode, name, description, category_id, brand_id, supplier_id, default_warehouse_id, purchase_price, selling_price, wholesale_price, min_stock_level, current_stock, unit, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        p
      );
    }

    // 10. Distribute initial stock into warehouse_stock and record Opening Stock movement
    console.log('Seeding warehouse stock distributions & movement logs...');
    await connection.query('DELETE FROM warehouse_stock');
    await connection.query('DELETE FROM stock_movements');

    const [allProducts] = await connection.query('SELECT id, current_stock FROM products');
    for (const prod of allProducts) {
      // Allocate 70% in Warehouse 1 (Main), 20% in Warehouse 2 (Retail), 10% in Warehouse 3 (Depot)
      const q1 = Math.floor(prod.current_stock * 0.7);
      const q2 = Math.floor(prod.current_stock * 0.2);
      const q3 = prod.current_stock - (q1 + q2);

      await connection.query(
        'INSERT INTO warehouse_stock (warehouse_id, product_id, quantity) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?)',
        [1, prod.id, q1, 2, prod.id, q2, 3, prod.id, q3]
      );

      // Record opening movement
      await connection.query(
        'INSERT INTO stock_movements (product_id, warehouse_id, quantity, movement_type, reference_type, notes, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [prod.id, 1, prod.current_stock, 'Opening Stock', 'initialization', 'Initial inventory balance intake for fiscal period', 1]
      );
    }

    // 11. Sample Purchases
    console.log('Inserting Sample Purchases and Purchase Items...');
    await connection.query('DELETE FROM purchase_items');
    await connection.query('DELETE FROM purchases');

    // Purchase 1: PO-2026-001 (Partially Paid)
    const [p1Result] = await connection.query(`
      INSERT INTO purchases (invoice_number, supplier_id, warehouse_id, purchase_date, payment_status, subtotal, discount, tax, total, paid_amount, remaining_amount, notes, created_by)
      VALUES ('PO-2026-001', 1, 1, DATE_SUB(CURDATE(), INTERVAL 12 DAY), 'Partially Paid', 4500.00, 100.00, 330.00, 4730.00, 3280.00, 1450.00, 'Batch order for Dell workstations and Cisco switches', 1)
    `);
    const p1Id = p1Result.insertId;

    await connection.query(`
      INSERT INTO purchase_items (purchase_id, product_id, quantity, purchase_price, discount, tax, total)
      VALUES 
      (?, 1, 4, 750.00, 50.00, 221.25, 3171.25),
      (?, 6, 3, 420.00, 50.00, 108.75, 1558.75)
    `, [p1Id, p1Id]);

    // Record debt for supplier
    await connection.query(`
      INSERT INTO debts (debt_type, party_id, party_name, reference_type, reference_id, reference_number, total_amount, paid_amount, remaining_amount, due_date, status)
      VALUES ('Supplier', 1, 'TechDistro North America', 'Purchase', ?, 'PO-2026-001', 4730.00, 3280.00, 1450.00, DATE_ADD(CURDATE(), INTERVAL 18 DAY), 'Partially Paid')
    `, [p1Id]);

    // Record initial supplier payment made
    await connection.query(`
      INSERT INTO payments (reference_number, payment_type, party_type, party_id, party_name, reference_id, amount, payment_method, payment_date, notes, created_by)
      VALUES ('PAY-SUP-2026-001', 'Supplier Purchase', 'Supplier', 1, 'TechDistro North America', ?, 3280.00, 'Bank', DATE_SUB(CURDATE(), INTERVAL 12 DAY), 'Down payment for PO-2026-001 via wire transfer', 1)
    `, [p1Id]);

    // Purchase 2: PO-2026-002 (Fully Paid)
    const [p2Result] = await connection.query(`
      INSERT INTO purchases (invoice_number, supplier_id, warehouse_id, purchase_date, payment_status, subtotal, discount, tax, total, paid_amount, remaining_amount, notes, created_by)
      VALUES ('PO-2026-002', 2, 1, DATE_SUB(CURDATE(), INTERVAL 5 DAY), 'Paid', 2420.00, 50.00, 177.75, 2547.75, 2547.75, 0.00, 'Restock of Logitech accessories and cables', 4)
    `);
    const p2Id = p2Result.insertId;

    await connection.query(`
      INSERT INTO purchase_items (purchase_id, product_id, quantity, purchase_price, discount, tax, total)
      VALUES 
      (?, 3, 20, 58.00, 20.00, 85.50, 1225.50),
      (?, 4, 10, 95.00, 30.00, 69.00, 989.00),
      (?, 10, 30, 4.50, 0.00, 23.25, 333.25)
    `, [p2Id, p2Id, p2Id]);

    await connection.query(`
      INSERT INTO payments (reference_number, payment_type, party_type, party_id, party_name, reference_id, amount, payment_method, payment_date, notes, created_by)
      VALUES ('PAY-SUP-2026-002', 'Supplier Purchase', 'Supplier', 2, 'Peripheral Plus Wholesale', ?, 2547.75, 'Bank', DATE_SUB(CURDATE(), INTERVAL 5 DAY), 'Full settlement on delivery for PO-2026-002', 4)
    `, [p2Id]);

    // 12. Sample Sales & Invoices
    console.log('Inserting Sample Sales, Invoices, and Customer Debts...');
    await connection.query('DELETE FROM sale_items');
    await connection.query('DELETE FROM invoices');
    await connection.query('DELETE FROM sales');

    // Sale 1: INV-2026-001 (Acme Global, Partially Paid with credit/debt)
    const [s1Result] = await connection.query(`
      INSERT INTO sales (invoice_number, customer_id, warehouse_id, sale_date, payment_status, payment_method, subtotal, discount, tax, total, paid_amount, remaining_amount, notes, created_by)
      VALUES ('INV-2026-001', 1, 1, DATE_SUB(CURDATE(), INTERVAL 8 DAY), 'Partially Paid', 'Credit', 4377.00, 150.00, 317.03, 4544.03, 2694.03, 1850.00, 'Workstation expansion package for Engineering Wing', 3)
    `);
    const s1Id = s1Result.insertId;

    await connection.query(`
      INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, discount, tax, total)
      VALUES 
      (?, 1, 2, 1099.00, 50.00, 161.10, 2309.10),
      (?, 5, 2, 579.00, 50.00, 83.10, 1191.10),
      (?, 3, 4, 99.99, 20.00, 28.50, 408.46),
      (?, 4, 4, 169.99, 30.00, 48.75, 635.37)
    `, [s1Id, s1Id, s1Id, s1Id]);

    // Create Invoice
    await connection.query(`
      INSERT INTO invoices (invoice_number, sale_id, customer_id, invoice_date, due_date, subtotal, discount, tax, total, paid_amount, remaining_amount, status, notes)
      VALUES ('INV-2026-001', ?, 1, DATE_SUB(CURDATE(), INTERVAL 8 DAY), DATE_ADD(CURDATE(), INTERVAL 22 DAY), 4377.00, 150.00, 317.03, 4544.03, 2694.03, 1850.00, 'Partially Paid', 'Net-30 Enterprise Terms')
    `, [s1Id]);

    // Record Customer Debt
    await connection.query(`
      INSERT INTO debts (debt_type, party_id, party_name, reference_type, reference_id, reference_number, total_amount, paid_amount, remaining_amount, due_date, status)
      VALUES ('Customer', 1, 'Acme Global Technologies', 'Sale', ?, 'INV-2026-001', 4544.03, 2694.03, 1850.00, DATE_ADD(CURDATE(), INTERVAL 22 DAY), 'Partially Paid')
    `, [s1Id]);

    // Record Payment
    await connection.query(`
      INSERT INTO payments (reference_number, payment_type, party_type, party_id, party_name, reference_id, amount, payment_method, payment_date, notes, created_by)
      VALUES ('PAY-CUST-2026-001', 'Customer Sale', 'Customer', 1, 'Acme Global Technologies', ?, 2694.03, 'Bank', DATE_SUB(CURDATE(), INTERVAL 8 DAY), 'Initial milestone payment against invoice INV-2026-001', 3)
    `, [s1Id]);

    // Sale 2: INV-2026-002 (Midwest Tech Retailers, Partially Paid)
    const [s2Result] = await connection.query(`
      INSERT INTO sales (invoice_number, customer_id, warehouse_id, sale_date, payment_status, payment_method, subtotal, discount, tax, total, paid_amount, remaining_amount, notes, created_by)
      VALUES ('INV-2026-002', 2, 2, DATE_SUB(CURDATE(), INTERVAL 3 DAY), 'Partially Paid', 'Bank', 1980.00, 80.00, 142.50, 2042.50, 1422.50, 620.00, 'Wholesale dispatch to retail outlet', 3)
    `);
    const s2Id = s2Result.insertId;

    await connection.query(`
      INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, discount, tax, total)
      VALUES 
      (?, 3, 10, 82.00, 30.00, 59.25, 849.25),
      (?, 4, 5, 140.00, 25.00, 50.62, 725.62),
      (?, 10, 50, 9.50, 25.00, 33.75, 483.75)
    `, [s2Id, s2Id, s2Id]);

    await connection.query(`
      INSERT INTO invoices (invoice_number, sale_id, customer_id, invoice_date, due_date, subtotal, discount, tax, total, paid_amount, remaining_amount, status, notes)
      VALUES ('INV-2026-002', ?, 2, DATE_SUB(CURDATE(), INTERVAL 3 DAY), DATE_ADD(CURDATE(), INTERVAL 14 DAY), 1980.00, 80.00, 142.50, 2042.50, 1422.50, 620.00, 'Partially Paid', 'Wholesale Net-15')
    `, [s2Id]);

    await connection.query(`
      INSERT INTO debts (debt_type, party_id, party_name, reference_type, reference_id, reference_number, total_amount, paid_amount, remaining_amount, due_date, status)
      VALUES ('Customer', 2, 'Midwest Tech Retailers', 'Sale', ?, 'INV-2026-002', 2042.50, 1422.50, 620.00, DATE_ADD(CURDATE(), INTERVAL 14 DAY), 'Partially Paid')
    `, [s2Id]);

    await connection.query(`
      INSERT INTO payments (reference_number, payment_type, party_type, party_id, party_name, reference_id, amount, payment_method, payment_date, notes, created_by)
      VALUES ('PAY-CUST-2026-002', 'Customer Sale', 'Customer', 2, 'Midwest Tech Retailers', ?, 1422.50, 'Bank', DATE_SUB(CURDATE(), INTERVAL 3 DAY), 'Electronic payment on invoice INV-2026-002', 3)
    `, [s2Id]);

    // Sale 3: INV-2026-003 (Walk-in, Cash POS, 100% Paid today)
    const [s3Result] = await connection.query(`
      INSERT INTO sales (invoice_number, customer_id, warehouse_id, sale_date, payment_status, payment_method, subtotal, discount, tax, total, paid_amount, remaining_amount, notes, created_by)
      VALUES ('INV-2026-003', 4, 2, CURDATE(), 'Paid', 'Cash', 299.98, 0.00, 22.50, 322.48, 322.48, 0.00, 'Counter POS cash sale', 3)
    `);
    const s3Id = s3Result.insertId;

    await connection.query(`
      INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, discount, tax, total)
      VALUES 
      (?, 3, 1, 99.99, 0.00, 7.50, 107.49),
      (?, 12, 1, 199.99, 0.00, 15.00, 214.99)
    `, [s3Id, s3Id]);

    await connection.query(`
      INSERT INTO invoices (invoice_number, sale_id, customer_id, invoice_date, due_date, subtotal, discount, tax, total, paid_amount, remaining_amount, status, notes)
      VALUES ('INV-2026-003', ?, 4, CURDATE(), CURDATE(), 299.98, 0.00, 22.50, 322.48, 322.48, 0.00, 'Paid', 'Counter sale completed with receipt')
    `, [s3Id]);

    await connection.query(`
      INSERT INTO payments (reference_number, payment_type, party_type, party_id, party_name, reference_id, amount, payment_method, payment_date, notes, created_by)
      VALUES ('PAY-POS-2026-001', 'Customer Sale', 'Customer', 4, 'Walk-in Retail Customer', ?, 322.48, 'Cash', CURDATE(), 'Cash checkout receipt POS-01', 3)
    `, [s3Id]);

    // 13. Expenses
    console.log('Inserting Operating Expenses...');
    await connection.query('DELETE FROM expenses');
    const expenses = [
      ['Warehouse Utilities', 'Electricity and heating for Main Central Warehouse', 740.00, 'Bank', new Date(Date.now() - 6 * 86400000), 5, 'ComEd commercial billing'],
      ['High-Speed Internet', 'Dedicated 1Gbps Fiber Internet for Hub & POS', 185.00, 'Bank', new Date(Date.now() - 4 * 86400000), 5, 'AT&T Business Fiber'],
      ['Packaging & Pallets', 'Industrial bubble wrap, boxes, and shrink wrap', 320.00, 'Cash', new Date(Date.now() - 2 * 86400000), 4, 'Uline bulk packing supply'],
      ['Software Licenses', 'Warehouse thermal printer and label software', 95.00, 'Bank', new Date(), 5, 'Monthly SaaS subscription']
    ];
    for (const e of expenses) {
      await connection.query(
        'INSERT INTO expenses (category, description, amount, payment_method, expense_date, created_by, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
        e
      );
    }

    // 14. Stock Transfer (Sample)
    console.log('Inserting Sample Stock Transfer...');
    await connection.query('DELETE FROM stock_transfer_items');
    await connection.query('DELETE FROM stock_transfers');
    const [stResult] = await connection.query(`
      INSERT INTO stock_transfers (transfer_number, source_warehouse_id, destination_warehouse_id, transfer_date, status, notes, created_by)
      VALUES ('TRF-2026-001', 1, 2, DATE_SUB(CURDATE(), INTERVAL 2 DAY), 'Completed', 'Replenishment for Downtown Retail Hub', 4)
    `);
    const stId = stResult.insertId;
    await connection.query(`
      INSERT INTO stock_transfer_items (transfer_id, product_id, quantity)
      VALUES (?, 3, 5), (?, 4, 3)
    `, [stId, stId]);

    // 15. Stock Adjustment (Sample)
    console.log('Inserting Sample Stock Adjustment...');
    await connection.query('DELETE FROM stock_adjustments');
    await connection.query(`
      INSERT INTO stock_adjustments (adjustment_number, product_id, warehouse_id, adjustment_type, current_quantity, adjustment_quantity, new_quantity, reason, created_by, adjustment_date)
      VALUES ('ADJ-2026-001', 10, 1, 'Increase', 78, 4, 82, 'Found 4 unboxed cables during physical cycle audit', 4, DATE_SUB(CURDATE(), INTERVAL 1 DAY))
    `);

    // 16. Audit Log Initial Records
    console.log('Inserting Initial Audit Logs...');
    await connection.query('DELETE FROM audit_logs');
    const logs = [
      [1, 'Alex Mercer (Admin)', 'System Initialization', 'System', 'Seed and database setup executed successfully.', '127.0.0.1'],
      [1, 'Alex Mercer (Admin)', 'User Authentication', 'Auth', 'Admin logged into system console.', '127.0.0.1'],
      [4, 'Elena Rostova (Inventory Lead)', 'Stock Transfer Completed', 'Transfers', 'Transferred 8 units from Main to Downtown Hub (TRF-2026-001).', '127.0.0.1'],
      [3, 'David Rossi (Sales Lead)', 'POS Transaction', 'Sales', 'Completed cash sale INV-2026-003.', '127.0.0.1']
    ];
    for (const l of logs) {
      await connection.query(
        'INSERT INTO audit_logs (user_id, user_name, action, module, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
        l
      );
    }

    console.log('--- Database Seeding Completed Successfully! ---');
  } catch (err) {
    throw err;
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  runSeed()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Database seeding failed:', err.message);
      process.exitCode = 1;
    });
}

module.exports = runSeed;
