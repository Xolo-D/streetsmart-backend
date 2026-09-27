// add-vendor-product-columns.js
import db from './database.js';

const migrations = [
  { name: 'vendor_products.current_stock',  sql: "ALTER TABLE vendor_products ADD COLUMN current_stock INTEGER DEFAULT 0" },
  { name: 'vendor_products.reorder_level', sql: "ALTER TABLE vendor_products ADD COLUMN reorder_level INTEGER DEFAULT 20" }
];

for (const m of migrations) {
  try {
    db.exec(m.sql);
    console.log('[added]', m.name);
  } catch (e) {
    if (/duplicate column/i.test(e.message)) {
      console.log('[exists]', m.name);
    } else {
      console.error('[failed]', m.name, '-', e.message);
    }
  }
}

console.log('');
console.log('--- vendor_products schema ---');
console.table(db.prepare('PRAGMA table_info(vendor_products)').all());
