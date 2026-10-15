# Apex Inventory Management System Documentation

Welcome to the technical and operational documentation for the **Apex Inventory Management System**.

## Documentation Index

- [INSTALLATION.md](./INSTALLATION.md) — Step-by-step setup guide for Node.js, XAMPP MySQL, environment variables, database migrations, and running the server.
- [DATABASE.md](./DATABASE.md) — Detailed relational schema architecture, 28 normalized database tables, data types, indexes, and foreign key relationships.
- [API.md](./API.md) — Complete REST API reference covering all 22 controller endpoint routes with request/response schemas.

## Key Architecture Highlights

1. **Strictly Single-Business:** All data, sales, purchases, warehouses, and users belong to one organization.
2. **ACID Transactions:** Financial purchases, POS checkout, inter-warehouse stock transfers, adjustments, and returns use atomic MySQL database transactions with row-level locks (`FOR UPDATE`) to prevent inventory overselling and race conditions.
3. **Double-Entry Stock Audit:** Every positive or negative quantity alteration creates an immutable row in `stock_movements`.
4. **Pure Native Stack:** Built using vanilla JavaScript, HTML5, Tailwind CSS, Express.js, and MySQL without bloated front-end frameworks.
