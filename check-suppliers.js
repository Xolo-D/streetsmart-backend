import Database from 'better-sqlite3';
const db = new Database('./db.sqlite');
console.log('=== Suppliers table ===');
console.table(db.prepare('SELECT id, name, city, category, rating FROM suppliers ORDER BY id').all());
console.log('\n=== Products with supplier_id ===');
console.table(db.prepare('SELECT supplier_id, COUNT(*) AS product_count FROM products WHERE supplier_id IS NOT NULL GROUP BY supplier_id').all());
console.log('\n=== Supplier user accounts ===');
console.table(db.prepare("SELECT id, email, role, name, supplier_id FROM users WHERE role = 'supplier'").all());
