// seed.js — imports data.json into SQLite
import fs from 'fs';
import db from './database.js';
import bcrypt from 'bcryptjs';

if (!fs.existsSync('./data.json')){
  console.error('❌ data.json not found. Run "node export-data.js" first.');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync('./data.json', 'utf8'));

console.log('\n→ Importing StreetSmart dataset…\n');

db.exec(`
  DELETE FROM orders;
  DELETE FROM products;
  DELETE FROM vendors;
  DELETE FROM suppliers;
  DELETE FROM categories;
  DELETE FROM cities;
  DELETE FROM monthly_sales;
`);

const insertCity = db.prepare('INSERT OR IGNORE INTO cities (name) VALUES (?)');
db.transaction(() => {
  (data.cities || []).forEach(c => insertCity.run(c.city));
})();

const insertCat = db.prepare('INSERT OR IGNORE INTO categories (name) VALUES (?)');
db.transaction(() => {
  (data.categories || []).forEach(c => insertCat.run(c.category));
})();

const insertSupplier = db.prepare(`
  INSERT OR REPLACE INTO suppliers
    (id, name, city, rating, on_time, quality, status, lead_time, category)
  VALUES (@id, @name, @city, @rating, @on_time, @quality, @status, @lead_time, @category)
`);
db.transaction(() => {
  (data.suppliers || []).forEach(s => insertSupplier.run(s));
})();

const supplierByName = {};
(data.suppliers || []).forEach(s => { supplierByName[s.name] = s.id; });

const insertProduct = db.prepare(`
  INSERT OR REPLACE INTO products
    (id, name, category, unit_price, current_stock, reorder_level, supplier_id, predicted_daily_demand)
  VALUES (@id, @name, @category, @unit_price, @current_stock, @reorder_level, @supplier_id, @predicted_daily_demand)
`);
db.transaction(() => {
  (data.reorder_all || []).forEach(r => {
    const demand = r.predicted_daily_demand || 0;
    const leadTime = r.lead_time || 3;
    const reorderLevel = Math.ceil(demand * leadTime * 0.5);

    insertProduct.run({
      id: r.id,
      name: r.name,
      category: r.category,
      unit_price: r.unit_price || 0,
      current_stock: r.current_stock || 0,
      reorder_level: reorderLevel,
      supplier_id: supplierByName[r.supplier] || null,
      predicted_daily_demand: demand
    });
  });
})();

const insertVendor = db.prepare(`
  INSERT OR REPLACE INTO vendors
    (id, city, type, revenue, profit, units, transactions, products)
  VALUES (@id, @city, @type, @revenue, @profit, @units, @transactions, @products)
`);
db.transaction(() => {
  (data.vendors || []).forEach(v => insertVendor.run(v));
})();

const insertSale = db.prepare('INSERT INTO monthly_sales (month, revenue, profit, units) VALUES (@month, @revenue, @profit, @units)');
db.transaction(() => {
  (data.monthly || []).forEach(m => insertSale.run(m));
})();

const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
if (userCount === 0){
  const hash = (p) => bcrypt.hashSync(p, 10);
  const insertUser = db.prepare(`
    INSERT INTO users (email, password_hash, role, name, supplier_id, vendor_id, approved)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `);

  insertUser.run('vendor@streetsmart.co.za',   hash('vendor123'),   'vendor',   'Demo Vendor',    null,     'V0071');
  insertUser.run('supplier@streetsmart.co.za', hash('supplier123'), 'supplier', 'KZN Beverages',  'SUP003', null);
  insertUser.run('admin@streetsmart.co.za',    hash('admin123'),    'admin',    'System Admin',   null,     null);

  console.log('✓ Created 3 default users (auto-approved)');
}

const counts = {
  cities: db.prepare('SELECT COUNT(*) AS n FROM cities').get().n,
  categories: db.prepare('SELECT COUNT(*) AS n FROM categories').get().n,
  suppliers: db.prepare('SELECT COUNT(*) AS n FROM suppliers').get().n,
  products: db.prepare('SELECT COUNT(*) AS n FROM products').get().n,
  vendors: db.prepare('SELECT COUNT(*) AS n FROM vendors').get().n,
  sales: db.prepare('SELECT COUNT(*) AS n FROM monthly_sales').get().n,
  users: db.prepare('SELECT COUNT(*) AS n FROM users').get().n
};

console.log('\n✓ Import complete:');
console.log(`   ${counts.cities} cities`);
console.log(`   ${counts.categories} categories`);
console.log(`   ${counts.suppliers} suppliers`);
console.log(`   ${counts.products} products`);
console.log(`   ${counts.vendors} vendors`);
console.log(`   ${counts.sales} monthly sales rows`);
console.log(`   ${counts.users} users\n`);