// backfill-products.js — assign starter catalog to vendors with no products
// Run once: node backfill-products.js
import Database from 'better-sqlite3';
const db = new Database('./db.sqlite');

const map = {
  'Food Vendor':      ['Street Foods', 'Fast Food'],
  'Drink Vendor':     ['Beverages'],
  'Snack Vendor':     ['Snacks'],
  'Sweet Vendor':     ['Street Sweets'],
  'Fruit Vendor':     ['Fresh Produce'],
  'Accessory Vendor': ['Street Accessories', 'Mobile Accessories'],
  'General Vendor':   ['Beverages', 'Snacks', 'Street Essentials', 'Personal Care']
};

const vendors = db.prepare('SELECT id, type FROM vendors').all();
let updated = 0;
let skipped = 0;

for (const v of vendors) {
  const existing = db.prepare('SELECT COUNT(*) AS n FROM vendor_products WHERE vendor_id = ?').get(v.id);
  if (existing.n === 0) {
    const cats = map[v.type] || ['Street Foods'];
    const ph = cats.map(() => '?').join(',');
    const prods = db.prepare(`SELECT id FROM products WHERE category IN (${ph})`).all(...cats);
    const insert = db.prepare('INSERT OR IGNORE INTO vendor_products (vendor_id, product_id) VALUES (?, ?)');
    const tx = db.transaction(() => {
      prods.forEach(p => insert.run(v.id, p.id));
    });
    tx();
    console.log(`${v.id} (${v.type}) -> ${prods.length} products`);
    updated++;
  } else {
    skipped++;
  }
}

console.log(`\nVendors updated: ${updated}`);
console.log(`Vendors already had products: ${skipped}`);
console.log(`Total vendor_products rows: ${db.prepare('SELECT COUNT(*) AS n FROM vendor_products').get().n}`);