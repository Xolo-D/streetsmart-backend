import Database from 'better-sqlite3';
const db = new Database('./db.sqlite');

const snapshot = () => ({
  vendors:   db.prepare('SELECT COUNT(*) AS n FROM vendors').get().n,
  suppliers: db.prepare('SELECT COUNT(*) AS n FROM suppliers').get().n,
  sales:     db.prepare('SELECT COUNT(*) AS n FROM sales_log').get().n,
  products:  db.prepare('SELECT COUNT(*) AS n FROM products').get().n,
  users:     db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
});

console.log('Before:', snapshot());

// Disable FK checks temporarily so we can delete in any order
db.pragma('foreign_keys = OFF');

// Delete children first, then parents
const tables = ['sales_log', 'discounts', 'vendor_products', 'orders', 'vendors', 'suppliers'];
for (const t of tables) {
  try {
    const r = db.prepare(`DELETE FROM ${t}`).run();
    console.log(`  cleared ${t}: ${r.changes} rows`);
  } catch (e) {
    console.log(`  skip ${t}: ${e.message}`);
  }
}

db.pragma('foreign_keys = ON');

console.log('After:', snapshot());
db.close();
process.exit(0);
