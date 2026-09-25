import Database from 'better-sqlite3';
const db = new Database('./db.sqlite');
console.log('=== SUP003 products from supplier_products ===');
console.table(db.prepare(`
  SELECT sp.product_id, p.name, sp.price, sp.moq, sp.lead_time
  FROM supplier_products sp
  JOIN products p ON p.id = sp.product_id
  WHERE sp.supplier_id = 'SUP003'
`).all());
console.log('\n=== SUP021 (new supplier) products ===');
console.table(db.prepare(`
  SELECT sp.product_id, p.name, sp.price
  FROM supplier_products sp
  JOIN products p ON p.id = sp.product_id
  WHERE sp.supplier_id = 'SUP021'
`).all());
console.log('\n=== Total products in catalog ===');
console.log(db.prepare('SELECT COUNT(*) AS n FROM products').get());
