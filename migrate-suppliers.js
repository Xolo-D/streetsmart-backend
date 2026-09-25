// migrate-suppliers.js — copy existing products.supplier_id data into supplier_products
import Database from 'better-sqlite3';
const db = new Database('./db.sqlite');

console.log('Starting supplier migration...\n');

// Ensure table exists
db.exec(`
  CREATE TABLE IF NOT EXISTS supplier_products (
    supplier_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    price REAL DEFAULT 0,
    moq INTEGER DEFAULT 20,
    lead_time INTEGER DEFAULT 3,
    active INTEGER DEFAULT 1,
    added_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (supplier_id, product_id)
  );
`);

// Get all products with a supplier_id set
const products = db.prepare(`
  SELECT p.id, p.supplier_id, p.unit_price, s.lead_time
  FROM products p
  LEFT JOIN suppliers s ON s.id = p.supplier_id
  WHERE p.supplier_id IS NOT NULL
`).all();

console.log(`Found ${products.length} products with a supplier.\n`);

const insert = db.prepare(`
  INSERT OR IGNORE INTO supplier_products (supplier_id, product_id, price, moq, lead_time)
  VALUES (?, ?, ?, ?, ?)
`);

const tx = db.transaction(() => {
  for (const p of products){
    insert.run(p.supplier_id, p.id, p.unit_price || 0, 20, p.lead_time || 3);
  }
});
tx();

console.log(`Migrated ${products.length} supplier-product links.\n`);

// Verify
console.log('=== Products per supplier in supplier_products ===');
console.table(db.prepare(`
  SELECT supplier_id, COUNT(*) AS product_count
  FROM supplier_products
  GROUP BY supplier_id
  ORDER BY supplier_id
`).all());

console.log('\n=== Sample rows ===');
console.table(db.prepare(`
  SELECT sp.supplier_id, sp.product_id, p.name, sp.price, sp.moq, sp.lead_time
  FROM supplier_products sp
  JOIN products p ON p.id = sp.product_id
  LIMIT 8
`).all());

console.log('\nMigration complete.');
