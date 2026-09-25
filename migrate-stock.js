// migrate-stock.js — one-time migration
// Adds current_stock + reorder_level to vendor_products (if missing),
// then copies stock values from products table for existing vendors,
// and zeroes stock for NEW vendors (V0300+).
import Database from 'better-sqlite3';
const db = new Database('./db.sqlite');

console.log('Starting migration...\n');

// ---- 1. Add columns if missing ----
const cols = db.prepare("PRAGMA table_info(vendor_products)").all();
const hasStock = cols.some(c => c.name === 'current_stock');
const hasReorder = cols.some(c => c.name === 'reorder_level');

if (!hasStock){
  console.log('Adding current_stock column...');
  db.exec("ALTER TABLE vendor_products ADD COLUMN current_stock INTEGER DEFAULT 0");
}
if (!hasReorder){
  console.log('Adding reorder_level column...');
  db.exec("ALTER TABLE vendor_products ADD COLUMN reorder_level INTEGER DEFAULT 0");
}

if (hasStock && hasReorder){
  console.log('Columns already exist. Skipping schema change.');
}

// ---- 2. Copy stock for OLD vendors (id < V0300) ----
const oldVendors = db.prepare("SELECT id FROM vendors WHERE id < 'V0300'").all();
const copyStock = db.prepare(`
  UPDATE vendor_products
  SET current_stock = (SELECT current_stock FROM products WHERE products.id = vendor_products.product_id),
      reorder_level = (SELECT reorder_level FROM products WHERE products.id = vendor_products.product_id)
  WHERE vendor_id = ? AND product_id = ?
`);

let copied = 0;
const tx1 = db.transaction(() => {
  for (const v of oldVendors){
    const rows = db.prepare('SELECT product_id FROM vendor_products WHERE vendor_id = ?').all(v.id);
    for (const r of rows){
      copyStock.run(v.id, r.product_id);
      copied++;
    }
  }
});
tx1();
console.log(`Copied stock for ${copied} rows across ${oldVendors.length} demo vendors.`);

// ---- 3. Zero stock for NEW vendors (V0300+) ----
const newVendors = db.prepare("SELECT id FROM vendors WHERE id >= 'V0300'").all();
const zeroStock = db.prepare(`
  UPDATE vendor_products
  SET current_stock = 0, reorder_level = 20
  WHERE vendor_id = ?
`);

const tx2 = db.transaction(() => {
  for (const v of newVendors){
    zeroStock.run(v.id);
  }
});
tx2();
console.log(`Zeroed stock for ${newVendors.length} new vendor(s).`);

// ---- 4. Verify ----
console.log('\n--- Verification ---');
console.log('\nSample demo vendors (should have real stock):');
console.table(db.prepare(`
  SELECT vp.vendor_id, vp.product_id, p.name, vp.current_stock, vp.reorder_level
  FROM vendor_products vp
  JOIN products p ON p.id = vp.product_id
  WHERE vp.vendor_id IN ('V0001', 'V0071')
  LIMIT 6
`).all());

console.log('\nNew vendors (should all be 0):');
console.table(db.prepare(`
  SELECT vp.vendor_id, vp.product_id, p.name, vp.current_stock, vp.reorder_level
  FROM vendor_products vp
  JOIN products p ON p.id = vp.product_id
  WHERE vp.vendor_id >= 'V0300'
  ORDER BY vp.vendor_id
  LIMIT 12
`).all());

console.log('\nMigration complete.');