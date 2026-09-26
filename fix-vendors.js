// fix-vendors.js — creates missing vendor records + populates products
import Database from 'better-sqlite3';
const db = new Database('./db.sqlite');

// 1. Create missing vendor records for vendor users
const users = db.prepare(
  "SELECT id, email, vendor_id, name, city, type FROM users WHERE role = 'vendor' AND vendor_id IS NOT NULL"
).all();

const insertVendor = db.prepare(`
  INSERT OR IGNORE INTO vendors (id, city, type, revenue, profit, units, transactions, products)
  VALUES (?, ?, ?, 0, 0, 0, 0, 0)
`);

let created = 0;
for (const u of users){
  const exists = db.prepare('SELECT id FROM vendors WHERE id = ?').get(u.vendor_id);
  if (!exists){
    insertVendor.run(u.vendor_id, u.city || 'Unknown', u.type || 'General Vendor');
    console.log('Created vendor:', u.vendor_id, 'for', u.email);
    created++;
  }
}
console.log('Vendors created:', created);
console.log('');

// 2. Populate vendor_products for every vendor without products
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
let populated = 0;
for (const v of vendors){
  const existing = db.prepare('SELECT COUNT(*) AS n FROM vendor_products WHERE vendor_id = ?').get(v.id);
  if (existing.n === 0){
    const cats = map[v.type] || ['Beverages'];
    const ph = cats.map(() => '?').join(',');
    const prods = db.prepare('SELECT id FROM products WHERE category IN (' + ph + ')').all(...cats);
    const insert = db.prepare(
      'INSERT OR IGNORE INTO vendor_products (vendor_id, product_id, current_stock, reorder_level) VALUES (?, ?, 0, 20)'
    );
    const tx = db.transaction(() => { prods.forEach(p => insert.run(v.id, p.id)); });
    tx();
    populated++;
  }
}
console.log('Vendors populated:', populated);
console.log('');

// 3. Verify
console.log('=== All V03xx vendors ===');
console.table(db.prepare("SELECT id, city, type FROM vendors WHERE id >= 'V0300' ORDER BY id").all());

console.log('');
console.log('=== Product counts for V03xx ===');
console.table(db.prepare(`
  SELECT v.id, v.type, COUNT(vp.product_id) AS products
  FROM vendors v
  LEFT JOIN vendor_products vp ON vp.vendor_id = v.id
  WHERE v.id >= 'V0300'
  GROUP BY v.id
  ORDER BY v.id
`).all());
