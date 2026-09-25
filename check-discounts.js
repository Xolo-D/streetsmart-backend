import Database from 'better-sqlite3';
const db = new Database('./db.sqlite');
console.log('=== Active discounts ===');
console.table(db.prepare(`
  SELECT d.id, d.supplier_id, d.product_id, p.name AS product_name,
         d.discount_percent, d.min_quantity, d.valid_until
  FROM discounts d
  LEFT JOIN products p ON p.id = d.product_id
`).all());
